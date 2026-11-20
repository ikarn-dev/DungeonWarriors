"use client";

import { Keypair, type VersionedTransaction } from "@solana/web3.js";
import { useRef, useState } from "react";
import { verifyManifestBinding } from "../lib/game/assets";
import { displayUsdc, parseUsdc } from "../lib/game/custody-client";
import { maxGrossReservation } from "../lib/game/economy";
import { CAT_NAMES, type LobbyState } from "../lib/game/lobby-state";
import {
  confirmGameAction,
  type GameSignature,
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
  actions: GameIntent["action"][];
  step: number;
  pending: GameSignature | null;
};

const messages = [
  "Authorize play in your wallet.",
  "Approve the Devnet wager and reserve the run.",
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
  const launch = useRef<Launch | null>(null);
  const cat = state.cats.find((owned) => owned.id === state.selected);
  const definingCatalogVersion = cat
    ? state.definingCatalogs[cat.id]
    : undefined;
  const running = launch.current?.step === messages.length;
  let stake: bigint | null = null;
  let gross: bigint | null = null;
  try {
    const exact = parseUsdc(amount);
    gross = maxGrossReservation(exact);
    stake = exact;
  } catch {
    /* Invalid amounts cannot start a run. */
  }
  const canStart =
    state.allowReservations &&
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
      if (stake > BigInt(entry.maxStake)) {
        setNotice(
          entry.maxStake === "0"
            ? "The house has no available collateral for a new wager."
            : `The current run limit is ${displayUsdc(entry.maxStake)} USDC.`,
        );
        return;
      }
      const binding = state.assetBinding;
      if (
        binding === null ||
        definingCatalogVersion !== 1 ||
        state.catalogVersion !== 1
      )
        throw new WebApiError("UNSUPPORTED_RUN");
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
      const expiresAtSeconds = entry.clockSeconds + 1800;
      launch.current = {
        key,
        nonce: entry.nonce,
        step: 0,
        pending: null,
        actions: [
          {
            kind: "authorizeSession",
            nonce: entry.sessionNonce,
            inputKey,
            expiresAtSeconds,
            allowance: stakeAmount,
          },
          {
            kind: "reserveRun",
            nonce: entry.nonce,
            sessionNonce: entry.sessionNonce,
            inputKey,
            inventoryVersion: state.inventoryVersion.toString(),
            rulesVersion: state.rulesVersion,
            catalogVersion: state.catalogVersion,
            definingCatalogVersion,
            cat: cat.id,
            market,
            stake: stakeAmount,
          },
          { kind: "delegateRun", nonce: entry.nonce, delegationEpoch: "1" },
          {
            kind: "activateRun",
            nonce: entry.nonce,
            delegationEpoch: "1",
            inputKey,
            market,
          },
        ],
      };
    }
    const setup = launch.current;
    try {
      for (
        let action = setup.actions[setup.step];
        action;
        action = setup.actions[setup.step]
      ) {
        signal.throwIfAborted();
        setNotice(
          setup.pending
            ? "Checking the original transaction…"
            : (messages[setup.step] ?? null),
        );
        const submitted =
          setup.pending ??
          (await sendGameAction(
            wallet,
            sign,
            action,
            setup.key,
            (value) => {
              setup.pending = value;
            },
            signal,
          ));
        setNotice("Waiting for confirmation…");
        const status = await confirmGameAction(submitted, signal);
        if (status === "pending") {
          setNotice(
            "Confirmation is pending. Continue setup to check the original signature.",
          );
          return;
        }
        setup.pending = null;
        if (status === "failed") throw new WebApiError("TRANSACTION_FAILED");
        setup.step++;
        if (setup.step === 3) setWatching(true);
      }
      setWatching(true);
      setNotice(null);
      await refresh(signal);
    } catch (error) {
      if (!signal.aborted) {
        if (setup.step === 0 && setup.pending === null) launch.current = null;
        setNotice(
          setup.pending === null
            ? "Setup stopped. Check your wallet and continue when ready."
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
              if (selected) setMarket(selected.market);
            }}
          >
            {MARKETS.map(({ market }) => (
              <option key={market} value={market}>
                {market}/USD
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Wager (Devnet USDC)
          <input
            className="min-h-11 rounded-md border border-[#cbd3be] px-3"
            inputMode="decimal"
            value={amount}
            autoComplete="off"
            maxLength={21}
            onChange={(event) => setAmount(event.target.value)}
          />
        </label>
      </fieldset>
      <p className="text-sm">
        Available in PURRPS: {displayUsdc(state.available)} USDC
        {gross !== null &&
          ` · Maximum gross payout: ${displayUsdc(gross.toString())} USDC`}
      </p>
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
      {!running && (
        <button
          type="button"
          data-primary
          className={button}
          disabled={disabled}
          onClick={() => void work(start)}
        >
          {isContinuation ? "Continue setup" : "Start Run"}
        </button>
      )}
      {notice && (
        <output className="text-sm" aria-live="polite">
          {notice}
        </output>
      )}
      {watching && launch.current ? (
        <RunStage
          wallet={wallet}
          nonce={launch.current.nonce}
          playKey={launch.current.key}
          close={() => setWatching(false)}
          runSettled={() => {
            launch.current = null;
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
