"use client";

import { type ReactNode, type RefObject, useId } from "react";
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
  onClose,
  onBack,
  children,
}: {
  dialog: RefObject<HTMLDialogElement | null>;
  shown: boolean;
  busy: boolean;
  title: string;
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
      className="run-dialog"
    >
      {shown && (
        <section className="run-dialog-layout">
          <h2 className="sr-only">{title}</h2>
          <button
            type="button"
            className="pixel-button run-lobby"
            disabled={busy}
            onClick={onBack}
          >
            <span className="pixel-icon" data-icon="back" aria-hidden="true" />
            Lobby
          </button>
          {children}
        </section>
      )}
    </dialog>
  );
}

export function RunBet({
  market,
  setMarket,
  amount,
  setAmount,
  cap,
  stake,
  available,
  busy,
  continuing,
  allowed,
  loading,
  quoteError,
  onStart,
  onRetryQuote,
}: {
  market: Market;
  setMarket: (value: Market) => void;
  amount: string;
  setAmount: (value: string) => void;
  cap: bigint | null;
  stake: bigint | null;
  available: bigint;
  busy: boolean;
  continuing: boolean;
  allowed: boolean;
  loading: boolean;
  quoteError: string | undefined;
  onStart: () => void;
  onRetryQuote: () => void;
}) {
  const hint = useId();
  const invalid = amount !== "" && (stake === null || stake > available);
  let detail: ReactNode = null;
  if (!continuing) {
    if (quoteError) detail = quoteError;
    else if (loading) detail = "Checking run availability…";
    else if (amount !== "" && stake === null)
      detail = "Enter a positive USDC amount.";
    else if (stake !== null && stake > available)
      detail = (
        <>
          Available in PURRPS{" "}
          <span className="font-mono tabular-nums">
            {displayUsdc(available.toString())} USDC
          </span>
        </>
      );
    else if (cap !== null && stake !== null)
      detail =
        cap > stake ? (
          <>
            Maximum payout{" "}
            <span className="font-mono tabular-nums">
              {displayUsdc(cap.toString())} USDC
            </span>
          </>
        ) : (
          "The vault cannot back a profit at this amount."
        );
  }
  return (
    <form
      className="grid gap-3"
      aria-label="Bet and run"
      onSubmit={(event) => {
        event.preventDefault();
        if (busy) return;
        if (continuing || allowed) onStart();
        else if (quoteError) onRetryQuote();
      }}
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
          Bet (Devnet USDC)
          <input
            className={`${field} font-mono tabular-nums`}
            value={amount}
            inputMode="decimal"
            autoComplete="off"
            aria-invalid={invalid}
            aria-describedby={detail ? hint : undefined}
            onChange={(event) => setAmount(event.target.value)}
          />
        </label>
      </fieldset>
      {detail && (
        <p id={hint} className="text-sm" aria-live="polite">
          {detail}
        </p>
      )}
      <button
        type="submit"
        data-primary
        className={button}
        disabled={busy || (!continuing && !allowed && !quoteError)}
      >
        {busy && continuing
          ? "Starting run…"
          : continuing
            ? "Continue run"
            : quoteError
              ? "Retry"
              : "Bet and run"}
      </button>
    </form>
  );
}
