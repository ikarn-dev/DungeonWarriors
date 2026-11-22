"use client";

import type { ReactNode, RefObject } from "react";
import { displayUsdc } from "../lib/game/custody-client";
import { MARKETS } from "../lib/solana/addresses";

type Market = (typeof MARKETS)[number]["market"];
const button =
  "min-h-11 rounded-md border border-current px-4 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50";
const field =
  "min-h-11 rounded-md border border-[#cbd3be] bg-white px-3 text-[#173b32]";

export function RunGameDialog({
  dialog,
  shown,
  busy,
  title,
  inRun,
  onClose,
  onBack,
  children,
}: {
  dialog: RefObject<HTMLDialogElement | null>;
  shown: boolean;
  busy: boolean;
  title: string;
  inRun: boolean;
  onClose: () => void;
  onBack: () => void;
  children: ReactNode;
}) {
  return (
    <dialog
      ref={dialog}
      aria-label="PURRPS game"
      onClose={onClose}
      onCancel={(event) => {
        if (busy) event.preventDefault();
      }}
      className={
        inRun
          ? "run-dialog"
          : "m-0 h-dvh max-h-none w-full max-w-none bg-[#f4f0e3] text-[#173b32] backdrop:bg-[#173b32]/70"
      }
    >
      {shown && (
        <section
          className={
            inRun
              ? "run-dialog-layout"
              : "mx-auto grid min-h-full max-w-6xl content-center gap-5 px-4 py-5 sm:px-8"
          }
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-2xl font-semibold">{title}</h2>
            <button
              type="button"
              className={inRun ? "run-control" : button}
              disabled={busy}
              onClick={onBack}
            >
              {inRun ? "← Lobby" : "Back to lobby"}
            </button>
          </div>
          {children}
        </section>
      )}
    </dialog>
  );
}

export function RunReady({
  market,
  setMarket,
  amount,
  setAmount,
  remaining,
  cap,
  stake,
  busy,
  continuing,
  allowed,
  onStart,
}: {
  market: Market;
  setMarket: (value: Market) => void;
  amount: string;
  setAmount: (value: string) => void;
  remaining: bigint | undefined;
  cap: bigint | null;
  stake: bigint | null;
  busy: boolean;
  continuing: boolean;
  allowed: boolean;
  onStart: () => void;
}) {
  return (
    <section
      className="grid gap-4 rounded-xl border border-[#cbd3be] bg-[#fffaf0] p-5 sm:p-7"
      aria-label="Run setup"
    >
      <fieldset
        className="grid gap-4 sm:grid-cols-2"
        disabled={busy || continuing}
      >
        <label className="grid gap-1 text-sm">
          Market
          <select
            className={field}
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
            className={field}
            value={amount}
            inputMode="decimal"
            onChange={(event) => setAmount(event.target.value)}
          />
        </label>
      </fieldset>
      {remaining !== undefined && !continuing && (
        <p className="text-sm">
          Play allowance remaining {displayUsdc(remaining.toString())} USDC
        </p>
      )}
      {cap !== null && stake !== null && (
        <p className="text-sm">
          {cap > stake
            ? `Maximum gross payout ${displayUsdc(cap.toString())} USDC`
            : "The vault cannot back a profit at this wager."}
        </p>
      )}
      <button
        type="button"
        data-primary
        className={button}
        disabled={busy || (!continuing && !allowed)}
        onClick={onStart}
      >
        {continuing ? "Continue run" : "Start"}
      </button>
      {remaining === undefined && !continuing && (
        <p className="text-sm">Return to the lobby to enable sponsored play.</p>
      )}
    </section>
  );
}
