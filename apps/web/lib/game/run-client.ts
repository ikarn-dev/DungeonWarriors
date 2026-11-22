import { type Keypair, VersionedTransaction } from "@solana/web3.js";
import { z } from "zod";
import { publicKeySchema } from "../solana/addresses";
import {
  completionOfferSchema,
  type GameIntent,
  playSponsorSchema,
  validatePreparedGame,
} from "./run-transactions";
import { decodeBase64, encodeBase64, WebApiError, webApi } from "./web-api";

export const PLAY_SESSION_SECONDS = 30 * 60;

export const runEntrySchema = z.object({
  commitment: z.literal("finalized"),
  entry: z.discriminatedUnion("status", [
    z.object({ status: z.literal("closed") }),
    z.object({ status: z.literal("budgetUnavailable") }),
    z.object({
      status: z.literal("ready"),
      maxStake: z.string().regex(/^\d{1,20}$/),
      available: z.string().regex(/^\d{1,20}$/),
      houseHeadroom: z.string().regex(/^\d{1,20}$/),
      maxMultiplierBps: z.number().int().min(10_000),
      nonce: z.string().regex(/^\d{1,20}$/),
      sessionNonce: z.string().regex(/^\d{1,20}$/),
      clockSeconds: z
        .number()
        .int()
        .positive()
        .max(Number.MAX_SAFE_INTEGER - 1800),
      completionSponsor: publicKeySchema.optional(),
      completionFunding: completionOfferSchema.optional(),
      playSponsor: playSponsorSchema.optional(),
    }),
  ]),
});

const preparedSchema = z.object({
  transaction: z.string().max(1800),
  blockhash: z.string().max(44),
  operationId: z.string().max(100),
  lastValidBlockHeight: z
    .number()
    .int()
    .nonnegative()
    .max(Number.MAX_SAFE_INTEGER),
  network: z.enum(["base", "er"]),
});
export type GameSignature = {
  signature: string;
  network: "base" | "er";
  lastValidBlockHeight: number;
};
export type SponsoredPlayTransaction = {
  intent: GameIntent;
  transaction: string;
  network: GameSignature["network"];
  lastValidBlockHeight: number;
};
export async function prepareSponsoredPlay(
  wallet: string,
  intent: GameIntent,
  signal: AbortSignal,
  key?: Keypair,
  sign?: (tx: VersionedTransaction) => Promise<VersionedTransaction>,
): Promise<SponsoredPlayTransaction> {
  // Live run state also carries the retry limit. Only send the fields the
  // transaction API accepts on both prepare and submit.
  const sponsor = intent.playSponsor;
  const request = sponsor
    ? {
        ...intent,
        playSponsor: { sponsor: sponsor.sponsor, floor: sponsor.floor },
      }
    : intent;
  const prepared = preparedSchema.parse(
    await webApi("/api/tx/prepare", request, signal),
  );
  let tx = VersionedTransaction.deserialize(decodeBase64(prepared.transaction));
  validatePreparedGame(tx, wallet, request, prepared);
  if (sign) tx = await sign(tx);
  signal.throwIfAborted();
  if (key) tx.sign([key]);
  return {
    intent: request,
    transaction: encodeBase64(tx.serialize()),
    network: prepared.network,
    lastValidBlockHeight: prepared.lastValidBlockHeight,
  };
}

export async function submitSponsoredPlay(
  pending: SponsoredPlayTransaction,
  signal: AbortSignal,
): Promise<GameSignature> {
  const result = z
    .object({
      signature: z.string().min(64).max(88),
      network: z.enum(["base", "er"]),
    })
    .parse(
      await webApi(
        "/api/tx/submit",
        { intent: pending.intent, transaction: pending.transaction },
        signal,
      ),
    );
  if (result.network !== pending.network)
    throw new WebApiError("UNEXPECTED_TRANSACTION");
  return { ...result, lastValidBlockHeight: pending.lastValidBlockHeight };
}
export async function confirmGameAction(
  pending: GameSignature,
  signal: AbortSignal,
  checks = 6,
  commitment = pending.network === "er" ? "confirmed" : "finalized",
) {
  for (let attempt = 0; attempt < checks; attempt++) {
    signal.throwIfAborted();
    const { status, resolution } = await webApi<{
      status: { confirmationStatus: string; err: unknown } | null;
      resolution: string;
    }>("/api/tx/status", pending, signal);
    if (resolution === "expired") return "failed";
    if (
      status?.confirmationStatus === "finalized" ||
      (commitment === "confirmed" && status?.confirmationStatus === "confirmed")
    ) {
      return status.err === null ? "confirmed" : "failed";
    }
    if (attempt < checks - 1) {
      const delay = Math.min(3200, 800 * 2 ** attempt);
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
    }
  }
  return "pending";
}
