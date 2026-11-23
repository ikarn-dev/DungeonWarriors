"use client";

import { type ReactNode, type RefObject, useId } from "react";
import { displayUsdc } from "../lib/game/custody-client";
import { MARKETS } from "../lib/solana/addresses";

type Market = (typeof MARKETS)[number]["market"];

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
  const input = useId();
  const invalid = amount !== "" && (stake === null || stake > available);
  let detail: ReactNode = null;
  if (!continuing) {
    if (quoteError) detail = quoteError;
    else if (loading) detail = null;
    else if (amount !== "" && stake === null)
      detail = "Enter a positive USDC amount.";
    else if (stake !== null && stake > available) detail = "Over your balance";
    else if (cap !== null && stake !== null)
      detail =
        cap > stake ? (
          <>
            Max payout{" "}
            <span className="lobby-figure">
              {displayUsdc(cap.toString())} USDC
            </span>
          </>
        ) : (
          "The vault cannot back a profit at this amount."
        );
  }
  return (
    <form
      className="bet-card"
      aria-label="Bet and run"
      onSubmit={(event) => {
        event.preventDefault();
        if (busy) return;
        if (continuing || allowed) onStart();
        else if (quoteError) onRetryQuote();
      }}
    >
      <div className="bet-row">
        <span className="bet-label" aria-hidden="true">
          Market
        </span>
        <fieldset className="bet-markets" disabled={busy || continuing}>
          <legend className="sr-only">Market</legend>
          {MARKETS.map((item) => (
            <button
              key={item.market}
              type="button"
              className="pixel-button"
              data-shape="round"
              data-tone={market === item.market ? "gold" : undefined}
              aria-pressed={market === item.market}
              onClick={() => setMarket(item.market)}
            >
              {item.market}
              <span>/USD</span>
            </button>
          ))}
        </fieldset>
      </div>
      <div className="bet-row">
        <label className="bet-label" htmlFor={input}>
          Bet
        </label>
        <div>
          <div className="bet-amount" data-invalid={invalid || undefined}>
            <input
              id={input}
              value={amount}
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.00"
              disabled={busy || continuing}
              aria-invalid={invalid}
              aria-describedby={hint}
              onChange={(event) => setAmount(event.target.value)}
            />
            <span aria-hidden="true">USDC</span>
          </div>
          <p id={hint} className="bet-note" aria-live="polite">
            <span>
              Available{" "}
              <span className="lobby-figure">
                {displayUsdc(available.toString())} USDC
              </span>
            </span>
            <span>{detail}</span>
          </p>
        </div>
      </div>
      <button
        type="submit"
        className="pixel-button bet-submit"
        data-shape="round"
        data-tone="gold"
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
