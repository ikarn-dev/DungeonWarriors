"use client";

import { Keypair, type VersionedTransaction } from "@solana/web3.js";
import { useRef, useState } from "react";
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
import { RunGameDialog, RunReady } from "./RunScreen";
import RunStage from "./RunStage";

type Market = (typeof MARKETS)[number]["market"];
type Offer = Extract<
  z.infer<typeof runEntrySchema>["entry"],
  { status: "ready" }
>;
type Flight = { prepared: SponsoredPlayTransaction; signature?: GameSignature };
type Permission = {
  key: Keypair;
  nonce: string;
  expires: number;
  remaining: bigint;
};
type Launch = {
  nonce: string;
  market: Market;
  reserve: Extract<GameIntent["action"], { kind: "reserveRun" }>;
  sponsor: PlaySponsor;
  step: number;
  flight: Flight | null;
};
const messages = [
  "Reserving your wager and connecting to MagicBlock…",
  "Starting the run…",
];
const button =
  "min-h-11 rounded-md border border-current px-4 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50";
const field =
  "min-h-11 rounded-md border border-[#cbd3be] bg-white px-3 text-[#173b32]";
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

function currentPermission(value: Permission | null) {
  return value &&
    value.expires > Math.floor(Date.now() / 1000) &&
    value.remaining > 0n
    ? value
    : null;
}

async function confirmFlight(flight: Flight, signal: AbortSignal) {
  flight.signature ??= await submitSponsoredPlay(flight.prepared, signal);
  return confirmGameAction(flight.signature, signal);
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
  const [allowance, setAllowance] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [offer, setOffer] = useState<Offer | null>(null);
  const [permission, setPermission] = useState<Permission | null>(null);
  const authorization = useRef<{
    permission: Permission;
    flight: Flight;
  } | null>(null);
  const launch = useRef<Launch | null>(null);
  const recovery = useRef<Flight | null>(null);
  const [runningNonce, setRunningNonce] = useState<string | null>(null);
  const permitted = currentPermission(permission);
  const cat = state.cats.find((owned) => owned.id === state.selected);
  const recovered =
    state.nextRunNonce !== state.settledRuns
      ? (BigInt(state.nextRunNonce) - 1n).toString()
      : null;
  const viewer = runningNonce ?? (launch.current === null ? recovered : null);
  const available = BigInt(offer?.available ?? state.available);
  const stake = positiveAmount(amount);
  const limit = positiveAmount(allowance);
  const cap =
    stake !== null && offer
      ? quotedGross(stake, BigInt(offer.houseHeadroom), offer.maxMultiplierBps)
      : null;
  const allowed =
    stake !== null &&
    cap !== null &&
    cap > stake &&
    stake <= available &&
    permitted !== null &&
    stake <= permitted.remaining;

  function positiveAmount(value: string) {
    try {
      return parseUsdc(value);
    } catch {
      return null;
    }
  }

  async function enable(signal: AbortSignal) {
    if (!sign) return;
    try {
      if (authorization.current === null) {
        if (limit === null || limit > BigInt(state.available)) return;
        setNotice("Approve your play allowance in Phantom…");
        const next = await readOffer(signal);
        if (!next.playSponsor || limit > BigInt(next.available))
          throw new WebApiError("RUN_SCOPE_MISMATCH");
        const key = Keypair.generate();
        const inputKey = key.publicKey.toBase58();
        const rent = z
          .object({ token: u64Input, authorization: u64Input })
          .parse(
            await webApi(
              "/api/chain/state",
              { kind: "playSessionRent", nonce: next.sessionNonce, inputKey },
              signal,
            ),
          );
        const expires = next.clockSeconds + PLAY_SESSION_SECONDS;
        const intent = {
          operation: "game",
          sponsored: false,
          playSponsor: next.playSponsor,
          action: {
            kind: "authorizeSession",
            nonce: next.sessionNonce,
            inputKey,
            expiresAtSeconds: expires,
            allowance: limit.toString(),
            rent,
          },
        } satisfies GameIntent;
        authorization.current = {
          permission: {
            key,
            nonce: next.sessionNonce,
            expires,
            remaining: limit,
          },
          flight: {
            prepared: await prepareSponsoredPlay(
              wallet,
              intent,
              signal,
              key,
              sign,
            ),
          },
        };
      }
      setNotice("Confirming your play allowance…");
      const status = await confirmFlight(authorization.current.flight, signal);
      if (status === "pending") {
        setNotice("Check the pending play approval to continue.");
        return;
      }
      if (status === "failed") {
        authorization.current = null;
        throw new WebApiError("TRANSACTION_FAILED");
      }
      setPermission(authorization.current.permission);
      authorization.current = null;
      setNotice(null);
    } catch (error) {
      if (knownFailure(error)) authorization.current = null;
      if (!signal.aborted) setNotice(shownError(error));
    }
  }

  function openGame() {
    dialog.current?.showModal();
    setOpen(true);
    setNotice(null);
    void work(async (signal) => {
      try {
        setOffer(await readOffer(signal));
      } catch (error) {
        if (!signal.aborted) setNotice(shownError(error));
      }
    });
  }

  async function start(signal: AbortSignal) {
    const play = launch.current ? permission : permitted;
    if (!play || !cat) return;
    if (
      launch.current &&
      launch.current.step > 0 &&
      play.expires <= Math.floor(Date.now() / 1000)
    ) {
      setRunningNonce(launch.current.nonce);
      setNotice(null);
      return;
    }
    try {
      if (launch.current === null) {
        if (!allowed || stake === null || cap === null || !offer) return;
        if (
          matchMedia("(orientation: portrait) and (pointer: coarse)").matches
        ) {
          setNotice("Rotate your device to landscape to start.");
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
        setNotice("Checking the run terms…");
        const next = await readOffer(signal);
        setOffer(next);
        if (
          !next.playSponsor ||
          next.nonce !== offer.nonce ||
          stake > BigInt(next.available)
        ) {
          await refresh(signal);
          setNotice("Your account changed. Review the updated terms.");
          return;
        }
        if (
          quotedGross(
            stake,
            BigInt(next.houseHeadroom),
            next.maxMultiplierBps,
          ) < cap
        ) {
          setNotice("The vault payout cap changed. Review it before starting.");
          return;
        }
        if (
          play.expires - next.clockSeconds <=
          RULES_V1.activationTimeoutSeconds
        ) {
          setPermission(null);
          setNotice(
            "Your play allowance is expiring. Enable a new allowance in the lobby.",
          );
          return;
        }
        const binding = await readRunMedia(definingCatalogVersion, signal);
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
        launch.current = {
          nonce: next.nonce,
          market,
          sponsor: next.playSponsor,
          step: 0,
          flight: null,
          reserve: {
            kind: "reserveRun",
            nonce: next.nonce,
            sessionNonce: play.nonce,
            inputKey: play.key.publicKey.toBase58(),
            expiresAtSeconds: play.expires,
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
      while (setup.step < messages.length) {
        signal.throwIfAborted();
        setNotice(messages[setup.step] ?? null);
        if (!setup.flight) {
          let action: GameIntent["action"] = setup.reserve;
          if (setup.step > 0) {
            const run = await readRunIdentity(wallet, setup.nonce, signal);
            if (
              run.inputKey !== play.key.publicKey.toBase58() ||
              !run.delegationInitiated
            )
              throw new WebApiError("RUN_SCOPE_MISMATCH");
            if (
              BigInt(run.activationDeadlineSeconds) <=
              BigInt(Math.floor(Date.now() / 1000))
            ) {
              setRunningNonce(setup.nonce);
              setNotice(null);
              return;
            }
            const identity = {
              nonce: setup.nonce,
              delegationEpoch: run.delegationEpoch,
              inputKey: run.inputKey,
            };
            action = { kind: "activateRun", ...identity, market: setup.market };
          }
          const intent = {
            operation: "game",
            sponsored: false,
            playSponsor: setup.sponsor,
            action,
          } as const;
          setup.flight = {
            prepared: await prepareSponsoredPlay(
              wallet,
              intent,
              signal,
              play.key,
            ),
          };
        }
        const status = await confirmFlight(setup.flight, signal);
        if (status === "pending") {
          setNotice(
            "The transaction is pending. Continue this run to check it.",
          );
          return;
        }
        setup.flight = null;
        if (status === "failed") throw new WebApiError("TRANSACTION_FAILED");
        if (setup.step === 0) {
          setPermission({
            ...play,
            remaining: play.remaining - BigInt(setup.reserve.stake),
          });
        }
        setup.step++;
      }
      setRunningNonce(setup.nonce);
      setNotice(null);
      await refresh(signal);
    } catch (error) {
      const setup = launch.current;
      if (setup && (knownFailure(error) || setup.flight === null)) {
        setup.flight = null;
        if (setup.step === 0) launch.current = null;
      }
      if (!signal.aborted)
        setNotice(
          setup?.step === 1
            ? "MagicBlock could not start this run yet. Continue to retry the same run."
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
      {!permitted && viewer === null && !launch.current && (
        <>
          <label className="grid gap-1 text-sm">
            Play allowance (Devnet USDC)
            <input
              className={field}
              inputMode="decimal"
              value={allowance}
              onChange={(event) => setAllowance(event.target.value)}
              disabled={blocked || authorization.current !== null}
            />
          </label>
          <p className="text-sm">
            Approve the total you can wager for the next 30 minutes. PURRPS
            covers run fees.
          </p>
          <button
            type="button"
            data-primary
            className={button}
            disabled={
              blocked ||
              !sign ||
              (authorization.current === null &&
                (limit === null ||
                  limit > BigInt(state.available) ||
                  !state.allowReservations))
            }
            onClick={() => void work(enable)}
          >
            {authorization.current
              ? "Check play approval"
              : "Enable sponsored play"}
          </button>
        </>
      )}
      {(permitted || viewer !== null || launch.current !== null) && (
        <button
          type="button"
          data-primary
          className={button}
          disabled={blocked}
          onClick={openGame}
        >
          {viewer || launch.current ? "Open run" : "Run"}
        </button>
      )}
      {!open && notice && <output className="text-sm">{notice}</output>}
      <RunGameDialog
        dialog={dialog}
        shown={open || runningNonce !== null}
        busy={blocked}
        title={cat ? CAT_NAMES[cat.id] : "PURRPS"}
        inRun={viewer !== null}
        onClose={() => setOpen(false)}
        onBack={close}
      >
        {viewer !== null ? (
          <RunStage
            key={viewer}
            wallet={wallet}
            nonce={viewer}
            playKey={runningNonce ? permission?.key : undefined}
            runSettled={() => {
              launch.current = null;
              recovery.current = null;
              setRunningNonce(null);
              close();
              void work(refresh);
            }}
            submitAction={
              offer?.playSponsor
                ? async (action, onSignature, signal) => {
                    if (!offer.playSponsor)
                      throw new WebApiError("SPONSOR_BUDGET_UNAVAILABLE");
                    try {
                      recovery.current ??= {
                        prepared: await prepareSponsoredPlay(
                          wallet,
                          {
                            operation: "game",
                            sponsored: false,
                            playSponsor: offer.playSponsor,
                            action,
                          },
                          signal,
                          action.kind === "resumeRun"
                            ? permission?.key
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
        ) : (
          <RunReady
            market={market}
            setMarket={setMarket}
            amount={amount}
            setAmount={setAmount}
            remaining={permitted?.remaining}
            cap={
              launch.current?.reserve.maxGross === undefined
                ? cap
                : BigInt(launch.current.reserve.maxGross)
            }
            stake={stake}
            busy={blocked}
            continuing={launch.current !== null}
            allowed={allowed}
            onStart={() => void work(start)}
          />
        )}
        {notice && (
          <output className="text-sm" aria-live="polite">
            {notice}
          </output>
        )}
      </RunGameDialog>
    </section>
  );
}
