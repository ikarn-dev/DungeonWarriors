"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { displayUsdc, parseUsdc } from "../lib/game/custody-client";
import { webApi } from "../lib/game/web-api";
import { publicKeySchema } from "../lib/solana/addresses";
import RunStage from "./RunStage";

const decimal = z.string().regex(/^(0|[1-9][0-9]{0,19})$/);
const finalized = z.object({ commitment: z.literal("finalized") });
const balances = finalized.extend({
  balances: z
    .object({
      availableBaseUnits: decimal,
      lockedStakeBaseUnits: decimal,
      purchaseEscrowBaseUnits: decimal,
    })
    .nullable(),
});
const pendingEntry = z.object({ nonce: decimal, status: z.literal("pending") });
const finishedEntry = z.object({
  nonce: decimal,
  status: z.enum(["settled", "refunded"]),
  outcome: z.enum(["win", "loss", "technicalRefund"]),
  market: z.enum(["BTC", "ETH", "SOL"]),
  score: decimal,
  stakeBaseUnits: decimal,
  grossPayoutBaseUnits: decimal,
  refundBaseUnits: decimal,
});
const history = finalized.extend({
  history: z.object({
    nextFromNonce: decimal.nullable(),
    entries: z.array(z.union([pendingEntry, finishedEntry])).max(8),
  }),
});
const board = finalized.extend({
  leaderboard: z
    .array(
      z.object({
        rank: z.number().int().min(1).max(20),
        wallet: publicKeySchema,
        score: decimal,
      }),
    )
    .max(20),
});
const button =
  "min-h-11 rounded-md border px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50";
const sectionTitle = "text-lg font-semibold";
const count = (value: string) =>
  new Intl.NumberFormat("en-US").format(BigInt(value));
const labels = ["Available in PURRPS", "Wagers in play", "Pending purchases"];

export default function AccountPanel({
  wallet,
  blocked,
  transfer,
}: {
  wallet: string;
  blocked: boolean;
  transfer: (kind: "deposit" | "withdraw", amount: string) => Promise<void>;
}) {
  const [view, setView] = useState<null | {
    balances: z.infer<typeof balances>["balances"];
    history: z.infer<typeof history>["history"];
    leaderboard: z.infer<typeof board>["leaderboard"];
  }>(null);
  const [amount, setAmount] = useState("");
  const [watchedRun, setWatchedRun] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  async function read(fromNonce?: string) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setError(null);
    setWorking(true);
    const state = (data: unknown) =>
      webApi<unknown>("/api/chain/state", data, controller.signal);
    try {
      if (fromNonce === undefined) {
        const [credits, runs, ranking] = await Promise.all([
          state({ kind: "balances" }),
          state({ kind: "history" }),
          state({ kind: "leaderboard" }),
        ]);
        if (!controller.signal.aborted)
          setView({
            balances: balances.parse(credits).balances,
            history: history.parse(runs).history,
            leaderboard: board.parse(ranking).leaderboard,
          });
      } else {
        const next = history.parse(
          await state({ kind: "history", fromNonce }),
        ).history;
        if (!controller.signal.aborted)
          setView((previous) =>
            previous === null ? null : { ...previous, history: next },
          );
      }
    } catch {
      if (!controller.signal.aborted)
        setError("Account data is unavailable. Try refreshing.");
    } finally {
      if (!controller.signal.aborted) setWorking(false);
    }
  }

  async function move(kind: "deposit" | "withdraw") {
    let baseUnits: bigint;
    try {
      baseUnits = parseUsdc(amount);
    } catch {
      setError("Enter a positive USDC amount with up to six decimals.");
      return;
    }
    if (
      kind === "withdraw" &&
      baseUnits > BigInt(view?.balances?.availableBaseUnits ?? "0")
    ) {
      setError("Withdrawal exceeds your finalized available balance.");
      return;
    }
    setError(null);
    await transfer(kind, baseUnits.toString());
    await read();
  }

  const credit = view?.balances;
  return (
    <section
      className="flex flex-col gap-4 border-t border-[#cbd3be] pt-4"
      aria-label="Player account"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className={sectionTitle}>Account</h2>
        <button
          type="button"
          className={button}
          disabled={working || blocked}
          onClick={() => void read()}
        >
          {view === null ? "Load account" : "Refresh account data"}
        </button>
      </div>
      {working && (
        <output className="text-sm">Reading finalized Devnet state…</output>
      )}
      {error !== null && (
        <p role="alert" className="text-sm">
          {error}
        </p>
      )}
      {view && (
        <>
          <dl className="grid gap-2">
            {[
              credit?.availableBaseUnits,
              credit?.lockedStakeBaseUnits,
              credit?.purchaseEscrowBaseUnits,
            ].map((value, i) => (
              <div
                key={labels[i]}
                className="flex flex-wrap items-baseline justify-between gap-2 text-sm"
              >
                <dt>{labels[i]}</dt>
                <dd className="font-mono tabular-nums">
                  {value === undefined ? "—" : `${displayUsdc(value)} USDC`}
                </dd>
              </div>
            ))}
          </dl>
          {credit && (
            <div className="grid gap-2">
              <label htmlFor="custody-amount" className="text-sm font-medium">
                Amount (Devnet USDC)
              </label>
              <input
                id="custody-amount"
                className="min-h-11 rounded-md border border-[#cbd3be] bg-transparent px-3 font-mono tabular-nums"
                inputMode="decimal"
                maxLength={21}
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                disabled={working || blocked}
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  data-primary
                  className={button}
                  disabled={!amount || working || blocked}
                  onClick={() => void move("deposit")}
                >
                  Deposit
                </button>
                <button
                  type="button"
                  className={button}
                  disabled={!amount || working || blocked}
                  onClick={() => void move("withdraw")}
                >
                  Withdraw
                </button>
              </div>
            </div>
          )}
          <div className="grid gap-2">
            <h3 className={sectionTitle}>Run history</h3>
            {view.history.entries.length === 0 ? (
              <p className="text-sm">No runs yet.</p>
            ) : (
              <ul className="divide-y divide-[#cbd3be]">
                {view.history.entries.map((entry) => (
                  <li key={entry.nonce} className="py-2 text-sm">
                    {entry.status === "pending" ? (
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span>Run {count(entry.nonce)} · In progress</span>
                        <button
                          type="button"
                          className={button}
                          onClick={() => setWatchedRun(entry.nonce)}
                        >
                          View run
                        </button>
                      </div>
                    ) : (
                      <details>
                        <summary className="min-h-11 cursor-pointer py-2">
                          {entry.market} ·{" "}
                          {entry.outcome === "technicalRefund"
                            ? "Refunded"
                            : entry.outcome === "win"
                              ? "Cash-out"
                              : "Loss"}{" "}
                          ·{" "}
                          <span className="font-mono tabular-nums">
                            {count(entry.score)}
                          </span>
                        </summary>
                        <p className="font-mono tabular-nums">
                          Stake {displayUsdc(entry.stakeBaseUnits)} USDC
                          <br />
                          Payout {displayUsdc(entry.grossPayoutBaseUnits)} USDC
                          <br />
                          Refund {displayUsdc(entry.refundBaseUnits)} USDC
                        </p>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {view.history.nextFromNonce !== null && (
              <button
                type="button"
                className={button}
                disabled={working || blocked}
                onClick={() =>
                  void read(view.history.nextFromNonce ?? undefined)
                }
              >
                Older runs
              </button>
            )}
          </div>
          {watchedRun !== null && (
            <RunStage
              key={watchedRun}
              nonce={watchedRun}
              wallet={wallet}
              close={() => setWatchedRun(null)}
              runSettled={() => {
                setWatchedRun(null);
                void read();
              }}
            />
          )}
          <div className="grid gap-2">
            <h3 className={sectionTitle}>Leaderboard</h3>
            {view.leaderboard.length === 0 ? (
              <p className="text-sm">
                The first finalized score will appear here.
              </p>
            ) : (
              <ol className="divide-y divide-[#cbd3be]">
                {view.leaderboard.map((row) => (
                  <li
                    key={row.wallet}
                    className="grid grid-cols-[2rem_minmax(0,1fr)_auto] gap-2 py-2 font-mono text-sm tabular-nums"
                  >
                    <span>{row.rank}</span>
                    <span title={row.wallet}>
                      {row.wallet === wallet
                        ? "You"
                        : `${row.wallet.slice(0, 4)}…${row.wallet.slice(-4)}`}
                    </span>
                    <span>{count(row.score)}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </>
      )}
    </section>
  );
}
