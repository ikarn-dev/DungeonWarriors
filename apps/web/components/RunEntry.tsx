"use client";

import { Keypair, type VersionedTransaction } from "@solana/web3.js";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { verifyManifestBinding } from "../lib/game/assets";
import { parseUsdc } from "../lib/game/custody-client";
import { quotedGross } from "../lib/game/economy";
import { CAT_NAMES, type LobbyState } from "../lib/game/lobby-state";
import { RULES_V1 } from "../lib/game/rules";
import {
  confirmGameAction,
  type GameSignature,
  PLAY_SESSION_SECONDS,
  prepareSponsoredPlay,
  readRunIdentity,
  readRunMedia,
  runEntrySchema,
  type SponsoredPlayTransaction,
  submitSponsoredPlay,
} from "../lib/game/run-client";
import type { GameIntent, PlaySponsor } from "../lib/game/run-transactions";
import {
  readWebJson,
  WebApiError,
  webApi,
  webErrorMessage,
} from "../lib/game/web-api";
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
  step: "authorize" | "reserve" | "activate";
  flight: Flight | null;
};
const button =
  "min-h-11 rounded-md border border-current px-4 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50";
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
  return confirmGameAction(flight.signature, signal, 18);
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
  const [market, setMarket] = useState<Market>("SOL");
  const [amount, setAmount] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [terms, setTerms] = useState<{ offer?: Offer; error?: string }>();
  const [quoteRequest, setQuoteRequest] = useState(0);
  const launch = useRef<Launch | null>(null);
  const recovery = useRef<Flight | null>(null);
  const [runningNonce, setRunningNonce] = useState<string | null>(null);
  const cat = state.cats.find((owned) => owned.id === state.selected);
  const recovered =
    state.nextRunNonce !== state.settledRuns
      ? (BigInt(state.nextRunNonce) - 1n).toString()
      : null;
  const viewer = runningNonce ?? (launch.current === null ? recovered : null);
  const offer = terms?.offer;
  const sponsor = launch.current?.sponsor ?? offer?.playSponsor;
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
        const [binding, rent] = await Promise.all([
          readRunMedia(definingCatalogVersion, signal),
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
        const assets = await fetch(
          `/game-assets/v${binding.version}/manifest.json`,
          { signal },
        );
        if (!assets.ok) throw new WebApiError("ASSETS_NOT_READY");
        await Promise.all([
          readWebJson(assets).then((manifest) =>
            verifyManifestBinding(manifest, binding),
          ),
          import("phaser"),
        ]);
        signal.throwIfAborted();
        const expiresAtSeconds = next.clockSeconds + PLAY_SESSION_SECONDS;
        launch.current = {
          key,
          sponsor: next.playSponsor,
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
      for (;;) {
        signal.throwIfAborted();
        const { step, reserve } = setup;
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
            const run = await readRunIdentity(wallet, reserve.nonce, signal);
            if (run.inputKey !== reserve.inputKey || !run.delegationInitiated)
              throw new WebApiError("RUN_SCOPE_MISMATCH");
            if (BigInt(run.activationDeadlineSeconds) <= BigInt(now)) {
              setRunningNonce(reserve.nonce);
              setOpen(true);
              setNotice(null);
              return;
            }
            action = {
              kind: "activateRun",
              nonce: reserve.nonce,
              delegationEpoch: run.delegationEpoch,
              inputKey: run.inputKey,
              market: reserve.market,
            };
          }
          setNotice(
            step === "authorize"
              ? "Approve your bet in your wallet."
              : "Starting your run…",
          );
          setup.flight = {
            prepared: await prepareSponsoredPlay(
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
            ),
          };
        }
        const status = await confirmFlight(setup.flight, signal);
        if (status === "pending") {
          setNotice("Still confirming. Continue to check the same bet.");
          return;
        }
        setup.flight = null;
        if (status === "failed") throw new WebApiError("TRANSACTION_FAILED");
        if (step === "activate") {
          setRunningNonce(reserve.nonce);
          setOpen(true);
          setNotice(null);
          await refresh(signal);
          return;
        }
        setup.step = step === "authorize" ? "reserve" : "activate";
      }
    } catch (error) {
      const setup = launch.current;
      if (
        setup &&
        (setup.flight === null ||
          (!setup.flight.signature && knownFailure(error)))
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

  function close() {
    dialog.current?.close();
    setOpen(false);
  }

  return (
    <section
      className="grid gap-3 border-t border-[#cbd3be] pt-4"
      aria-label="Play"
    >
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
        <button
          type="button"
          className={button}
          disabled={blocked}
          onClick={() => setOpen(true)}
        >
          Open run
        </button>
      )}
      {!open && notice && <output className="text-sm">{notice}</output>}
      <RunGameDialog
        dialog={dialog}
        shown={open || runningNonce !== null}
        busy={blocked}
        title={cat ? CAT_NAMES[cat.id] : "PURRPS"}
        onClose={() => setOpen(false)}
        onBack={close}
      >
        {viewer !== null && (
          <RunStage
            key={viewer}
            wallet={wallet}
            nonce={viewer}
            playKey={runningNonce ? launch.current?.key : undefined}
            runSettled={() => {
              launch.current = null;
              recovery.current = null;
              setRunningNonce(null);
              setAmount("");
              close();
              void work(refresh);
            }}
            submitAction={
              sponsor
                ? async (action, onSignature, signal) => {
                    try {
                      recovery.current ??= {
                        prepared: await prepareSponsoredPlay(
                          wallet,
                          {
                            operation: "game",
                            sponsored: false,
                            playSponsor: sponsor,
                            action,
                          },
                          signal,
                          action.kind === "resumeRun"
                            ? launch.current?.key
                            : undefined,
                        ),
                      };
                      const pending = await submitSponsoredPlay(
                        recovery.current.prepared,
                        signal,
                      );
                      recovery.current = null;
                      onSignature(pending);
                      return pending;
                    } catch (error) {
                      if (knownFailure(error)) recovery.current = null;
                      throw error;
                    }
                  }
                : undefined
            }
          />
        )}
      </RunGameDialog>
    </section>
  );
}
