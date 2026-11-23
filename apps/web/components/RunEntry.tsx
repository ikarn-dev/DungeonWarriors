"use client";

import { Keypair, type VersionedTransaction } from "@solana/web3.js";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { lobbyMusic } from "../lib/audio/lobby-music";
import { parseUsdc } from "../lib/game/custody-client";
import { quotedGross } from "../lib/game/economy";
import { CAT_NAMES, type LobbyState } from "../lib/game/lobby-state";
import { RULES_V1 } from "../lib/game/rules";
import { loadRunArtwork, type RunArtwork } from "../lib/game/run-artwork";
import {
  confirmGameAction,
  type GameSignature,
  PLAY_SESSION_SECONDS,
  prepareSponsoredPlay,
  runEntrySchema,
  type SponsoredPlayTransaction,
  submitSponsoredPlay,
} from "../lib/game/run-client";
import {
  type GameIntent,
  initialDelegationEpoch,
  type PlaySponsor,
} from "../lib/game/run-transactions";
import { WebApiError, webApi, webErrorMessage } from "../lib/game/web-api";
import type { MARKETS } from "../lib/solana/addresses";
import { u64Input } from "../lib/solana/program";
import { RunBet, RunGameDialog } from "./RunScreen";
import RunStage from "./RunStage";

type Market = (typeof MARKETS)[number]["market"];
type Offer = Extract<
  z.infer<typeof runEntrySchema>["entry"],
  { status: "ready" }
>;
type Flight = { prepared: SponsoredPlayTransaction; signature?: GameSignature };
type Launch = {
  key: Keypair;
  rent: { token: string; authorization: string };
  reserve: Extract<GameIntent["action"], { kind: "reserveRun" }> & {
    expiresAtSeconds: number;
  };
  sponsor: PlaySponsor;
  artwork: RunArtwork;
  step: "authorize" | "reserve" | "activate" | "active";
  flight: Flight | null;
  approval?: GameSignature;
};
const rejected = new Set([
  "INVALID_SIGNATURE",
  "INVALID_REQUEST",
  "TRANSACTION_REJECTED",
  "BLOCKHASH_EXPIRED",
  "RUN_SCOPE_MISMATCH",
  "RUN_BUDGET_CHANGED",
  "SIMULATION_REJECTED",
  "SPONSOR_BUDGET_UNAVAILABLE",
  "SPONSOR_LIMITED",
]);
const knownFailure = (error: unknown) =>
  error instanceof WebApiError && rejected.has(error.code);
const shownError = (error: unknown) =>
  error instanceof WebApiError
    ? webErrorMessage(error.code)
    : "The request could not finish. Try again.";

async function readOffer(signal: AbortSignal) {
  const { entry } = runEntrySchema.parse(
    await webApi("/api/chain/state", { kind: "runEntry" }, signal),
  );
  if (entry.status === "closed") throw new WebApiError("ADMISSION_CLOSED");
  if (entry.status !== "ready" || !entry.playSponsor)
    throw new WebApiError("SPONSOR_BUDGET_UNAVAILABLE");
  return entry;
}

function positiveAmount(value: string) {
  try {
    return parseUsdc(value);
  } catch {
    return null;
  }
}

async function confirmFlight(flight: Flight, signal: AbortSignal) {
  flight.signature ??= await submitSponsoredPlay(flight.prepared, signal);
  return confirmGameAction(
    flight.signature,
    signal,
    18,
    flight.prepared.intent.action.kind === "authorizeSession"
      ? "confirmed"
      : undefined,
  );
}

export default function RunEntry({
  wallet,
  state,
  sign,
  blocked,
  work,
  refresh,
}: {
  wallet: string;
  state: LobbyState;
  sign:
    | ((tx: VersionedTransaction) => Promise<VersionedTransaction>)
    | undefined;
  blocked: boolean;
  work: (fn: (signal: AbortSignal) => Promise<void>) => Promise<void>;
  refresh: (signal: AbortSignal) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [market, setMarket] = useState<Market>("BTC");
  const [amount, setAmount] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [terms, setTerms] = useState<{ offer?: Offer; error?: string }>();
  const [quoteRequest, setQuoteRequest] = useState(0);
  const launch = useRef<Launch | null>(null);
  const warm = useRef<{ cat: string; artwork: Promise<RunArtwork> } | null>(
    null,
  );
  const [runningNonce, setRunningNonce] = useState<string | null>(null);
  const [resolvedNonce, setResolvedNonce] = useState<string | null>(null);
  const cat = state.cats.find((owned) => owned.id === state.selected);
  const selectedCat = cat?.id;
  const { assetBinding } = state;
  const mediaVersion = assetBinding?.version;
  const mediaHash = assetBinding?.contentHash;
  const recovered =
    state.nextRunNonce !== state.settledRuns
      ? (BigInt(state.nextRunNonce) - 1n).toString()
      : null;
  const viewer =
    runningNonce ??
    (launch.current === null && recovered !== resolvedNonce ? recovered : null);
  const offer = terms?.offer;
  const available = BigInt(offer?.available ?? state.available);
  const stake = positiveAmount(amount);
  const cap =
    stake !== null && offer
      ? quotedGross(stake, BigInt(offer.houseHeadroom), offer.maxMultiplierBps)
      : null;
  const allowed = !!(
    sign &&
    cat &&
    stake !== null &&
    cap !== null &&
    cap > stake &&
    stake <= available
  );
  const starting = viewer !== null && launch.current?.step === "activate";

  // Runs render with the current catalog's media, whatever catalog defined the cat.
  useEffect(() => {
    if (!selectedCat || !mediaVersion || !mediaHash) return;
    const controller = new AbortController();
    const artwork = loadRunArtwork(
      { version: mediaVersion, contentHash: mediaHash },
      controller.signal,
      selectedCat,
    );
    warm.current = { cat: selectedCat, artwork };
    void artwork.catch(() => {
      if (warm.current?.artwork === artwork) warm.current = null;
    });
    return () => controller.abort();
  }, [mediaVersion, mediaHash, selectedCat]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Wallet, finalized refreshes and manual retries invalidate the displayed quote.
  useEffect(() => {
    const controller = new AbortController();
    void readOffer(controller.signal).then(
      (offer) => {
        if (!controller.signal.aborted) setTerms({ offer });
      },
      (error) => {
        if (!controller.signal.aborted) setTerms({ error: shownError(error) });
      },
    );
    return () => controller.abort();
  }, [wallet, state.slot, quoteRequest]);

  useEffect(() => {
    if (open && dialog.current && !dialog.current.open)
      dialog.current.showModal();
  }, [open]);
  // The game screen plays effects only; the background loop waits until it closes.
  useEffect(() => {
    lobbyMusic.hold("run", open);
    return () => lobbyMusic.hold("run", false);
  }, [open]);

  async function start(signal: AbortSignal) {
    if (!sign || !cat) return;
    setNotice(null);
    try {
      if (launch.current === null) {
        if (!allowed || stake === null || cap === null || !offer) return;
        if (
          matchMedia("(orientation: portrait) and (pointer: coarse)").matches
        ) {
          setNotice("Rotate to landscape to start.");
          return;
        }
        const definingCatalogVersion = state.definingCatalogs[cat.id];
        if (
          !definingCatalogVersion ||
          !assetBinding ||
          state.inventoryVersion === null ||
          state.rulesVersion === null ||
          state.catalogVersion === null
        )
          throw new WebApiError("ASSETS_NOT_READY");

        setNotice("Checking your bet…");
        const next = await readOffer(signal);
        if (
          !next.playSponsor ||
          next.nonce !== offer.nonce ||
          next.nonce !== state.nextRunNonce ||
          stake > BigInt(next.available)
        ) {
          setTerms({ offer: next });
          await refresh(signal);
          setNotice("Your account changed. Review the updated bet.");
          return;
        }
        const updatedCap = quotedGross(
          stake,
          BigInt(next.houseHeadroom),
          next.maxMultiplierBps,
        );
        if (updatedCap < cap) {
          setTerms({ offer: next });
          setNotice("The maximum payout changed. Review the updated bet.");
          return;
        }
        const key = Keypair.generate();
        const inputKey = key.publicKey.toBase58();
        const preloaded = warm.current;
        const [artwork, rent] = await Promise.all([
          preloaded && preloaded.cat === cat.id
            ? preloaded.artwork
            : loadRunArtwork(assetBinding, signal, cat.id),
          webApi(
            "/api/chain/state",
            {
              kind: "playSessionRent",
              nonce: next.sessionNonce,
              inputKey,
            },
            signal,
          ).then((value) =>
            z.object({ token: u64Input, authorization: u64Input }).parse(value),
          ),
        ]);
        signal.throwIfAborted();
        const expiresAtSeconds = next.clockSeconds + PLAY_SESSION_SECONDS;
        launch.current = {
          key,
          sponsor: next.playSponsor,
          artwork,
          step: "authorize",
          flight: null,
          rent,
          reserve: {
            kind: "reserveRun",
            nonce: next.nonce,
            sessionNonce: next.sessionNonce,
            inputKey,
            expiresAtSeconds,
            inventoryVersion: state.inventoryVersion.toString(),
            rulesVersion: state.rulesVersion,
            catalogVersion: state.catalogVersion,
            definingCatalogVersion,
            cat: cat.id,
            market,
            stake: stake.toString(),
            maxGross: cap.toString(),
            ...(next.completionFunding && {
              completionFunding: next.completionFunding,
            }),
          },
        };
      }
      const setup = launch.current;
      let delegationWaits = 0;
      let checkedFinalApproval = false;
      let refreshedBlockhash = false;
      for (;;) {
        signal.throwIfAborted();
        const { step, reserve } = setup;
        if (step === "active") return;
        if (setup.flight === null) {
          const now = Math.floor(Date.now() / 1000);
          if (
            step === "reserve" &&
            reserve.expiresAtSeconds - now <= RULES_V1.activationTimeoutSeconds
          ) {
            launch.current = null;
            setNotice("Approval expired. Start the bet again.");
            return;
          }
          let action: GameIntent["action"] =
            step === "authorize"
              ? {
                  kind: "authorizeSession",
                  nonce: reserve.sessionNonce,
                  inputKey: reserve.inputKey,
                  expiresAtSeconds: reserve.expiresAtSeconds,
                  allowance: reserve.stake,
                  rent: setup.rent,
                }
              : reserve;
          if (step === "activate") {
            action = {
              kind: "activateRun",
              nonce: reserve.nonce,
              delegationEpoch: initialDelegationEpoch,
              inputKey: reserve.inputKey,
              market: reserve.market,
            };
          }
          setNotice(
            step === "authorize"
              ? "Approve your bet in your wallet."
              : "Starting your run…",
          );
          try {
            const prepared = await prepareSponsoredPlay(
              wallet,
              {
                operation: "game",
                sponsored: false,
                playSponsor: setup.sponsor,
                action,
              },
              signal,
              setup.key,
              step === "authorize" ? sign : undefined,
            );
            setup.flight = { prepared };
          } catch (error) {
            if (
              error instanceof WebApiError &&
              error.code === "BLOCKHASH_EXPIRED"
            ) {
              if (!refreshedBlockhash) {
                refreshedBlockhash = true;
                continue;
              }
              setNotice(
                "Network approval expired. Continue to retry this bet.",
              );
              return;
            }
            if (
              error instanceof WebApiError &&
              error.code === "RUN_DELEGATION_PENDING" &&
              step === "activate" &&
              delegationWaits < 6
            ) {
              setNotice("Waiting for MagicBlock to receive the run…");
              await new Promise<void>((resolve) =>
                setTimeout(
                  resolve,
                  Math.min(3200, 800 * 2 ** delegationWaits++),
                ),
              );
              continue;
            }
            if (
              error instanceof WebApiError &&
              error.code === "SIMULATION_REJECTED" &&
              step === "reserve" &&
              setup.approval &&
              !checkedFinalApproval
            ) {
              checkedFinalApproval = true;
              const approval = await confirmGameAction(
                setup.approval,
                signal,
                6,
              );
              if (approval === "confirmed") continue;
              if (approval === "pending") {
                setNotice("Still confirming your bet. Continue to check it.");
                return;
              }
            }
            throw error;
          }
        }
        const status = await confirmFlight(setup.flight, signal);
        if (status === "pending") {
          setNotice("Still confirming. Continue to check the same bet.");
          return;
        }
        const signature = setup.flight.signature;
        setup.flight = null;
        if (status === "expired") {
          if (step !== "authorize" && !refreshedBlockhash) {
            refreshedBlockhash = true;
            continue;
          }
          setNotice(
            step === "authorize"
              ? "Wallet approval expired. Continue to approve the same bet."
              : "The transaction expired. Continue to retry the same run.",
          );
          return;
        }
        if (status === "failed") {
          if (step !== "activate") launch.current = null;
          throw new WebApiError("TRANSACTION_FAILED");
        }
        if (step === "activate") {
          setup.step = "active";
          setNotice(null);
          await refresh(signal);
          return;
        }
        setup.step = step === "authorize" ? "reserve" : "activate";
        if (step === "authorize" && signature) setup.approval = signature;
        if (step === "reserve") {
          setRunningNonce(reserve.nonce);
          setOpen(true);
        }
      }
    } catch (error) {
      const setup = launch.current;
      if (setup?.step === "active") return;
      if (
        setup &&
        !setup.flight?.signature &&
        (knownFailure(error) ||
          (setup.step === "authorize" && setup.flight === null))
      ) {
        setup.flight = null;
        if (setup.step !== "activate") launch.current = null;
      }
      if (!signal.aborted)
        setNotice(
          setup?.step === "activate"
            ? "Continue to start your existing run."
            : shownError(error),
        );
    }
  }

  function clearRun() {
    launch.current = null;
    setRunningNonce(null);
    setAmount("");
  }

  function close() {
    dialog.current?.close();
  }

  function onClose() {
    setOpen(false);
    if (runningNonce !== null && runningNonce === resolvedNonce) {
      clearRun();
      void work(refresh);
    }
  }

  return (
    <section className="lobby-stack" aria-label="Play">
      {viewer === null ? (
        <RunBet
          market={market}
          setMarket={setMarket}
          amount={amount}
          setAmount={setAmount}
          cap={cap}
          stake={stake}
          available={available}
          busy={blocked}
          continuing={launch.current !== null}
          allowed={allowed}
          loading={!terms}
          quoteError={terms?.error}
          onStart={() => void work(start)}
          onRetryQuote={() => {
            setTerms(undefined);
            setQuoteRequest((request) => request + 1);
          }}
        />
      ) : (
        <div className="lobby-banner">
          <p>Run #{viewer} is still in progress.</p>
          <button
            type="button"
            className="pixel-button"
            data-tone="gold"
            disabled={blocked}
            onClick={() => setOpen(true)}
          >
            Continue run
          </button>
        </div>
      )}
      {!open && notice && <output className="text-sm">{notice}</output>}
      <RunGameDialog
        dialog={dialog}
        shown={viewer !== null || open}
        busy={blocked}
        title={cat ? CAT_NAMES[cat.id] : "PURRPS"}
        onClose={onClose}
        onBack={close}
      >
        {viewer !== null && (
          <RunStage
            key={viewer}
            wallet={wallet}
            nonce={viewer}
            playKey={runningNonce ? launch.current?.key : undefined}
            artwork={launch.current?.artwork}
            activating={starting}
            autoDeliver
            present={open}
            media={assetBinding}
            onFinalized={() => {
              setResolvedNonce(viewer);
              if (dialog.current?.open) {
                setRunningNonce(viewer);
              } else clearRun();
              void work(refresh);
            }}
            runSettled={() => {
              clearRun();
              close();
              void work(refresh);
            }}
          />
        )}
        {starting && (notice || !blocked) && (
          <div className="run-dialog-notice pixel-panel">
            {notice && <output>{notice}</output>}
            {!blocked && (
              <button
                type="button"
                className="pixel-button"
                data-tone="green"
                onClick={() => void work(start)}
              >
                Continue run
              </button>
            )}
          </div>
        )}
      </RunGameDialog>
    </section>
  );
}
