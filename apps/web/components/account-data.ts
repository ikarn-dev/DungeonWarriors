import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { decodeCapsuleDraw } from "../lib/game/lobby-state";
import { webApi } from "../lib/game/web-api";
import { publicKeySchema } from "../lib/solana/addresses";

// Finalized account reads shared by the Wallet, History and Leaderboard
// sections. Amounts, scores and nonces arrive as exact decimal strings.
const decimal = z.string().regex(/^(0|[1-9][0-9]{0,19})$/);
const finalized = z.object({ commitment: z.literal("finalized") });
const creditsSchema = finalized.extend({
  balances: z
    .object({
      availableBaseUnits: decimal,
      lockedStakeBaseUnits: decimal,
      purchaseEscrowBaseUnits: decimal,
    })
    .nullable(),
});
const fundsSchema = finalized.extend({
  walletFunds: z.strictObject({ solLamports: decimal, usdcBaseUnits: decimal }),
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
const historySchema = finalized.extend({
  history: z.object({
    nextFromNonce: decimal.nullable(),
    entries: z.array(z.union([pendingEntry, finishedEntry])).max(8),
  }),
});
const boardSchema = finalized.extend({
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

export type HistoryEntry = z.infer<
  typeof historySchema
>["history"]["entries"][number];
export type HistoryPage = z.infer<typeof historySchema>["history"];

const read = (body: unknown, signal: AbortSignal) =>
  webApi<unknown>("/api/chain/state", body, signal);

export async function readWallet(signal: AbortSignal) {
  const [credits, funds] = await Promise.all([
    read({ kind: "balances" }, signal).then(
      (value) => creditsSchema.parse(value).balances,
    ),
    read({ kind: "walletFunds" }, signal).then(
      (value) => fundsSchema.parse(value).walletFunds,
    ),
  ]);
  return { credits, funds };
}
export async function readHistory(
  signal: AbortSignal,
  fromNonce?: string,
): Promise<HistoryPage> {
  return historySchema.parse(
    await read(
      fromNonce === undefined
        ? { kind: "history" }
        : { kind: "history", fromNonce },
      signal,
    ),
  ).history;
}
export async function readLeaderboard(signal: AbortSignal) {
  return boardSchema.parse(await read({ kind: "leaderboard" }, signal))
    .leaderboard;
}

// Reads whenever the lobby revision changes and keeps the last good value
// visible during refreshes, so screens never flash an empty or loading state.
// `load` must be stable, for example a module-level reader.
export function useFinalized<T>(
  revision: number | undefined,
  load: (signal: AbortSignal) => Promise<T>,
) {
  const [value, setValue] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);
  const current = useRef<AbortController | null>(null);
  const run = useCallback(() => {
    current.current?.abort();
    const controller = new AbortController();
    current.current = controller;
    load(controller.signal).then(
      (next) => {
        if (controller.signal.aborted) return;
        setValue(next);
        setFailed(false);
      },
      () => {
        if (!controller.signal.aborted) setFailed(true);
      },
    );
  }, [load]);
  useEffect(() => {
    if (revision === undefined) return;
    run();
    return () => current.current?.abort();
  }, [revision, run]);
  return { value, failed, retry: run };
}

// Tie the displayed reward to the finalized owner and nonce even across a reconnect.
export function useCapsuleReceipt(
  address: string | null,
  nonce: bigint | null,
  slot: number | undefined,
) {
  const load = useCallback(
    async (signal: AbortSignal) => {
      if (address === null || nonce === null) return null;
      const value = await read(
        { kind: "draw", nonce: nonce.toString() },
        AbortSignal.any([signal, AbortSignal.timeout(8000)]),
      );
      return {
        address,
        nonce,
        receipt: decodeCapsuleDraw(value, address, nonce),
      };
    },
    [address, nonce],
  );
  const draw = useFinalized(slot, load);
  return {
    receipt:
      draw.value?.address === address && draw.value.nonce === nonce
        ? draw.value.receipt
        : null,
    retryDraw: draw.failed && nonce !== null ? draw.retry : undefined,
  };
}
