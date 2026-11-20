"use client";

import { Keypair, type VersionedTransaction } from "@solana/web3.js";
import { useRef, useState } from "react";
import { verifyManifestBinding } from "../lib/game/assets";
import { displayUsdc, parseUsdc } from "../lib/game/custody-client";
import { quotedGross } from "../lib/game/economy";
import { CAT_NAMES, type LobbyState } from "../lib/game/lobby-state";
import {
  confirmGameAction,
  type GameSignature,
  PLAY_SESSION_SECONDS,
  readRunIdentity,
  readRunMedia,
  runEntrySchema,
  sendGameAction,
} from "../lib/game/run-client";
import type { GameIntent } from "../lib/game/run-transactions";
import { readWebJson, WebApiError, webApi } from "../lib/game/web-api";
import { MARKETS } from "../lib/solana/addresses";
import RunStage from "./RunStage";

type Market = (typeof MARKETS)[number]["market"];
type Launch = {
  nonce: string;
  key: Keypair;
  market: Market;
  reserve: Extract<GameIntent["action"], { kind: "reserveRun" }>;
  step: number;
  pending: GameSignature | null;
};

const messages = [
  "Approve play authorization and reserve the run.",
  "Approve delegation to MagicBlock.",
  "Approve activation on MagicBlock.",
];
const button =
  "min-h-11 rounded-md border border-current px-4 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50";

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
  const [market, setMarket] = useState<Market>("SOL");
  const [amount, setAmount] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [watching, setWatching] = useState(false);
  const [practice, setPractice] = useState(false);
  const [quote, setQuote] = useState<{
    stake: bigint;
    gross: bigint;
    market: Market;
  } | null>(null);
  const launch = useRef<Launch | null>(null);
  const recovered =
    state.nextRunNonce !== state.settledRuns
      ? (BigInt(state.nextRunNonce) - 1n).toString()
      : null;
  const viewer =
    (watching ? launch.current?.nonce : null) ??
    (launch.current === null ? recovered : null);
  const cat = state.cats.find((owned) => owned.id === state.selected);
  const definingCatalogVersion = cat
    ? state.definingCatalogs[cat.id]
    : undefined;
  const running = launch.current?.step === messages.length;
  let stake: bigint | null = null;
  try {
    stake = practice ? 0n : parseUsdc(amount);
  } catch {
    /* Invalid amounts cannot start a run. */
  }
  const canStart =
    state.allowReservations &&
    recovered === null &&
    sign !== undefined &&
    cat !== undefined &&
    stake !== null &&
    stake <= BigInt(state.available);
  const isContinuation = launch.current !== null;
  const disabled =
    blocked || sign === undefined || (!isContinuation && !canStart);

  async function start(signal: AbortSignal) {
    if (sign === undefined) return;
    if (launch.current === null) {
      if (
        !canStart ||
        stake === null ||
        cat === undefined ||
        definingCatalogVersion === undefined ||
        state.inventoryVersion === null ||
        state.catalogVersion === null ||
        state.rulesVersion === null
      )
        return;
      if (matchMedia("(orientation: portrait) and (pointer: coarse)").matches) {
        setNotice("Rotate your device to landscape to start a run.");
        return;
      }
      setNotice("Checking Devnet run availability…");
      const { entry } = runEntrySchema.parse(
        await webApi("/api/chain/state", { kind: "runEntry" }, signal),
      );
      if (entry.status !== "ready") {
        setNotice(
          entry.status === "closed"
            ? "Runs are currently closed on Devnet."
            : "This run is waiting for its completion budget.",
        );
        return;
      }
      if (
        stake > BigInt(entry.available) ||
        entry.nonce !== state.nextRunNonce
      ) {
        setQuote(null);
        await refresh(signal);
        setNotice(
          "Your account changed. Review the current balance and run status.",
        );
        return;
      }
      const cap = quotedGross(
        stake,
        BigInt(entry.houseHeadroom),
        entry.maxMultiplierBps,
      );
      if (stake > 0n && cap <= stake) {
        setQuote(null);
        setNotice(
          "The vault cannot back a profit for this wager. You can choose a practice run.",
        );
        return;
      }
      if (
        quote?.stake !== stake ||
        quote.market !== market ||
        quote.gross > cap
      ) {
        setQuote({ stake, gross: cap, market });
        setNotice(
          quote ? "The available payout changed. Review the new terms." : null,
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
      const key = Keypair.generate();
      const inputKey = key.publicKey.toBase58();
      const stakeAmount = stake.toString();
      const expiresAtSeconds = entry.clockSeconds + PLAY_SESSION_SECONDS;
      launch.current = {
        key,
        market,
        nonce: entry.nonce,
        step: 0,
        pending: null,
        reserve: {
          kind: "reserveRun",
          nonce: entry.nonce,
          sessionNonce: entry.sessionNonce,
          inputKey,
          expiresAtSeconds,
          inventoryVersion: state.inventoryVersion.toString(),
          rulesVersion: state.rulesVersion,
          catalogVersion: state.catalogVersion,
          definingCatalogVersion,
          cat: cat.id,
          market,
          stake: stakeAmount,
          maxGross: quote.gross.toString(),
        },
      };
    }
    const setup = launch.current;
    try {
      while (setup.step < messages.length) {
        signal.throwIfAborted();
        let action: GameIntent["action"] | undefined =
          setup.step === 0 ? setup.reserve : undefined;
        if (setup.step >= 1 && !setup.pending) {
          const reservation = await readRunIdentity(
            wallet,
            setup.nonce,
            signal,
          );
          if (reservation.inputKey !== setup.key.publicKey.toBase58())
            throw new WebApiError("RUN_SCOPE_MISMATCH");
          if (setup.step === 1 && reservation.delegationInitiated) {
            setup.step++;
            setWatching(true);
            continue;
          }
          const identity = {
            nonce: setup.nonce,
            delegationEpoch: reservation.delegationEpoch,
          };
          action =
            setup.step === 1
              ? { kind: "delegateRun", ...identity }
              : {
                  kind: "activateRun",
                  ...identity,
                  inputKey: reservation.inputKey,
                  market: setup.market,
                };
        }
        setNotice(
          setup.pending
            ? "Checking the original transaction…"
            : (messages[setup.step] ?? null),
        );
        const submitted =
          setup.pending ??
          (action &&
            (await sendGameAction(
              wallet,
              sign,
              action,
              setup.key,
              (value) => {
                setup.pending = value;
              },
              signal,
            )));
        if (!submitted) throw new WebApiError("RUN_SCOPE_MISMATCH");
        setNotice("Waiting for confirmation…");
        const status = await confirmGameAction(submitted, signal);
        if (status === "pending") {
          setNotice(
            "Confirmation is pending. Continue setup to check the original signature.",
          );
          return;
        }
        setup.pending = null;
        if (status === "failed") {
          if (setup.step === 0) {
            launch.current = null;
            setQuote(null);
            await refresh(signal);
          }
          throw new WebApiError("TRANSACTION_FAILED");
        }
        setup.step++;
        if (setup.step === 2) setWatching(true);
      }
      setWatching(true);
      setNotice(null);
      await refresh(signal);
    } catch (error) {
      if (!signal.aborted) {
        if (setup.step === 0 && setup.pending === null) {
          launch.current = null;
          setQuote(null);
        }
        if (setup.step >= 1) setWatching(true);
        setNotice(
          setup.pending === null
            ? setup.step === 0
              ? "The wager was not reserved. Review the updated run terms to retry."
              : "Setup stopped. Continue the existing run when ready."
            : "Check the original transaction before continuing setup.",
        );
      }
      throw error;
    }
  }

  return (
    <section
      className="grid gap-3 border-t border-[#cbd3be] pt-4"
      aria-label="Start a run"
    >
      <h2 className="text-lg font-semibold">Start a run</h2>
      <p className="text-sm">
        {cat
          ? `${CAT_NAMES[cat.id]} · Level ${cat.level}`
          : "Select a cat to run."}
      </p>
      {viewer === null && (
        <fieldset
          className="grid gap-3"
          disabled={blocked || isContinuation || !state.allowReservations}
        >
          <label className="grid gap-1 text-sm">
            Market
            <select
              className="min-h-11 rounded-md border px-3"
              value={market}
              onChange={(event) => {
                const selected = MARKETS.find(
                  (item) => item.market === event.target.value,
                );
                if (selected) {
                  setMarket(selected.market);
                  setQuote(null);
                }
              }}
            >
              {MARKETS.map(({ market }) => (
                <option key={market} value={market}>
                  {market}/USD
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={practice}
              onChange={(event) => {
                setPractice(event.target.checked);
                setQuote(null);
              }}
            />
            Practice without a wager
          </label>
          {!practice && (
            <label className="grid gap-1 text-sm">
              Wager (Devnet USDC)
              <input
                className="min-h-11 rounded-md border border-[#cbd3be] px-3"
                inputMode="decimal"
                value={amount}
                autoComplete="off"
                maxLength={21}
                onChange={(event) => {
                  setAmount(event.target.value);
                  setQuote(null);
                }}
              />
            </label>
          )}
        </fieldset>
      )}
      <p className="text-sm">
        Available in PURRPS: {displayUsdc(state.available)} USDC
      </p>
      {BigInt(state.nextRunNonce) - BigInt(state.settledRuns) > 1n && (
        <p className="text-sm">
          Earlier runs are still open. Open their pending entries in Run history
          to recover them before starting again.
        </p>
      )}
      {viewer === null && quote && (
        <output className="text-sm">
          {quote.stake === 0n
            ? "Practice uses the real game with 0 USDC at risk and no payout."
            : `Wager ${displayUsdc(quote.stake.toString())} USDC. Maximum gross payout ${displayUsdc(quote.gross.toString())} USDC. Earned checkpoint payouts stop at this cap.`}
        </output>
      )}
      {state.allowReservations && amount.length > 0 && stake === null && (
        <p className="text-sm">
          Enter a positive wager with up to six decimals.
        </p>
      )}
      {state.allowReservations &&
        stake !== null &&
        stake > BigInt(state.available) && (
          <p className="text-sm">
            The wager exceeds your available PURRPS credit.
          </p>
        )}
      {!state.allowReservations && (
        <p className="text-sm">Runs are currently closed on Devnet.</p>
      )}
      {state.allowReservations && !isContinuation && (
        <p className="text-sm">
          Play authorization lasts 30 minutes and covers this wager.
        </p>
      )}
      {!running && (recovered === null || isContinuation) && (
        <button
          type="button"
          data-primary
          className={button}
          disabled={disabled}
          onClick={() => void work(start)}
        >
          {isContinuation
            ? "Continue existing setup"
            : quote
              ? "Approve run terms"
              : "Review run"}
        </button>
      )}
      {notice && (
        <output className="text-sm" aria-live="polite">
          {notice}
        </output>
      )}
      {viewer !== null ? (
        <RunStage
          key={viewer}
          wallet={wallet}
          nonce={viewer}
          playKey={launch.current?.key}
          close={recovered !== null ? undefined : () => setWatching(false)}
          runSettled={() => {
            launch.current = null;
            setQuote(null);
            setWatching(false);
            void work(refresh);
          }}
          submitAction={
            sign === undefined
              ? undefined
              : (action, onSignature, signal) =>
                  sendGameAction(
                    wallet,
                    sign,
                    action,
                    null,
                    onSignature,
                    signal,
                  )
          }
        />
      ) : (
        running && (
          <button
            type="button"
            className={button}
            onClick={() => setWatching(true)}
          >
            Open run
          </button>
        )
      )}
    </section>
  );
}
