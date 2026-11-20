import { utils } from "@anchor-lang/core";
import { type Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { z } from "zod";
import { publicKeySchema } from "../solana/addresses";
import { decodeEscrowAccount, runAddresses } from "./run-accounts";
import {
  completionOfferSchema,
  type GameIntent,
  gameNetwork,
  validatePreparedGame,
} from "./run-transactions";
import { decodeBase64, encodeBase64, WebApiError, webApi } from "./web-api";

export const PLAY_SESSION_SECONDS = 30 * 60;

export async function readRunIdentity(
  wallet: string,
  nonce: string,
  signal: AbortSignal,
) {
  const identity = { owner: wallet, nonce: BigInt(nonce) };
  const address = runAddresses(identity).escrow[0];
  const response = await webApi<{
    accounts?: Array<{
      address: string;
      account: {
        owner: string;
        data: string;
        executable: boolean;
      } | null;
    }>;
  }>("/api/chain/state", { kind: "run", nonce }, signal);
  const escrow = response.accounts?.find(
    (row) => row.address === address.toBase58(),
  )?.account;
  if (!escrow) throw new WebApiError("RUN_NOT_FOUND");
  return decodeEscrowAccount(identity, address, {
    owner: new PublicKey(escrow.owner),
    data: utils.bytes.base64.decode(escrow.data),
    executable: escrow.executable,
  });
}

export async function readRunMedia(catalog: number, signal: AbortSignal) {
  const value = await webApi(
    "/api/chain/state",
    { kind: "catalogMedia", version: catalog },
    signal,
  );
  return z
    .object({
      media: z.object({
        version: z.number().int().positive(),
        contentHash: z.string().regex(/^[0-9a-f]{64}$/),
      }),
    })
    .parse(value).media;
}

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
export type RunActionSubmitter = (
  action: GameIntent["action"],
  onSignature: (value: GameSignature | null) => void,
  signal: AbortSignal,
) => Promise<GameSignature>;

export async function sendGameAction(
  wallet: string,
  sign: (tx: VersionedTransaction) => Promise<VersionedTransaction>,
  action: GameIntent["action"],
  playKey: Keypair | null,
  onSignature: (value: GameSignature | null) => void,
  signal: AbortSignal,
) {
  const intent = { operation: "game", sponsored: false, action } as const;
  const prepared = preparedSchema.parse(
    await webApi("/api/tx/prepare", intent, signal),
  );
  const tx = VersionedTransaction.deserialize(
    decodeBase64(prepared.transaction),
  );
  validatePreparedGame(tx, wallet, intent, prepared);
  const signed = await sign(tx);
  signal.throwIfAborted();
  if (
    action.kind === "authorizeSession" ||
    action.kind === "activateRun" ||
    (action.kind === "reserveRun" && action.expiresAtSeconds !== undefined)
  ) {
    if (!playKey || playKey.publicKey.toBase58() !== action.inputKey)
      throw new WebApiError("INVALID_PLAY_KEY");
    signed.sign([playKey]);
  }
  const signature = signed.signatures[0];
  if (!signature?.some((byte) => byte !== 0))
    throw new WebApiError("INVALID_SIGNATURE");
  const pending = {
    signature: utils.bytes.bs58.encode(signature),
    network: gameNetwork(action),
    lastValidBlockHeight: prepared.lastValidBlockHeight,
  };
  onSignature(pending);
  try {
    const result = await webApi<{ signature: string; network: string }>(
      "/api/tx/submit",
      { intent, transaction: encodeBase64(signed.serialize()) },
      signal,
    );
    if (
      result.signature !== pending.signature ||
      result.network !== pending.network
    )
      throw new Error("Unexpected submission response");
  } catch (error) {
    // A provider/network failure may arrive after submission. Keep the original signature.
    if (
      error instanceof WebApiError &&
      [
        "TRANSACTION_REJECTED",
        "INVALID_SIGNATURE",
        "BLOCKHASH_EXPIRED",
        "SIMULATION_REJECTED",
        "RUN_SCOPE_MISMATCH",
        "RATE_LIMITED",
        "AUTH_REQUIRED",
        "SPONSOR_BUDGET_UNAVAILABLE",
        "SPONSOR_LIMITED",
        "SPONSOR_NOT_CONFIGURED",
        "INVALID_RUN_SPONSOR",
      ].includes(error.code)
    )
      onSignature(null);
    throw error;
  }
  return pending;
}

export async function confirmGameAction(
  pending: GameSignature,
  signal: AbortSignal,
) {
  for (let attempt = 0; attempt < 6; attempt++) {
    signal.throwIfAborted();
    const { status, resolution } = await webApi<{
      status: { confirmationStatus: string; err: unknown } | null;
      resolution: string;
    }>("/api/tx/status", pending, signal);
    if (resolution === "expired") return "failed";
    if (
      status?.confirmationStatus === "finalized" ||
      (pending.network === "er" && status?.confirmationStatus === "confirmed")
    ) {
      return status.err === null ? "confirmed" : "failed";
    }
    if (attempt < 5)
      await new Promise<void>((resolve) => setTimeout(resolve, 3200));
  }
  return "pending";
}
