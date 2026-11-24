import { z } from "zod";
import { publicKeySchema } from "../solana/addresses";
import { u64Input } from "../solana/program";
import { playerActions } from "./custody-client";

const positive = u64Input.refine((n) => n !== "0");
const version = z.number().int().min(1).max(0xffffffff);
const marketSchema = z.enum(["BTC", "ETH", "SOL"]);
// New reservations in the current program start at delegation epoch 1.
export const initialDelegationEpoch = "1";
const catSchema = z.enum(["collector", "acrobat", "guardian", "sprinter"]);
const nonce = { nonce: u64Input };
const identity = { ...nonce, delegationEpoch: positive };
export const completionOfferSchema = z.strictObject({
  sponsor: publicKeySchema,
  lamports: positive,
  floor: u64Input,
  attempts: z.number().int().min(1).max(65_535),
});
export type CompletionOffer = z.infer<typeof completionOfferSchema>;
export const playSponsorSchema = completionOfferSchema.pick({
  sponsor: true,
  floor: true,
});
export type PlaySponsor = z.infer<typeof playSponsorSchema>;
export const sessionTokenSpace = 8 + 3 * 32 + 8;
const action = z.discriminatedUnion("kind", [
  ...playerActions,
  z.strictObject({
    kind: z.literal("authorizeSession"),
    ...nonce,
    inputKey: publicKeySchema,
    expiresAtSeconds: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    allowance: u64Input,
    rent: z
      .strictObject({ token: u64Input, authorization: u64Input })
      .optional(),
  }),
  z.strictObject({ kind: z.literal("revokeSession"), ...nonce }),
  z.strictObject({
    kind: z.literal("reserveRun"),
    ...nonce,
    sessionNonce: u64Input,
    inputKey: publicKeySchema,
    inventoryVersion: u64Input,
    rulesVersion: version,
    catalogVersion: version,
    definingCatalogVersion: version,
    cat: catSchema,
    market: marketSchema,
    stake: u64Input,
    maxGross: u64Input.optional(),
    completionFunding: completionOfferSchema.optional(),
    expiresAtSeconds: z
      .number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER)
      .optional(),
  }),
  z.strictObject({
    kind: z.literal("delegateRun"),
    ...identity,
    completionSponsor: publicKeySchema.optional(),
    inputKey: publicKeySchema.optional(),
  }),
  z.strictObject({
    kind: z.literal("activateRun"),
    ...identity,
    inputKey: publicKeySchema,
    market: marketSchema,
  }),
  z.strictObject({ kind: z.literal("expireDelegatedActivation"), ...nonce }),
  z.strictObject({ kind: z.literal("revokeRunInputKey"), ...nonce }),
  z.strictObject({ kind: z.literal("abortUndelegatedReservation"), ...nonce }),
  z.strictObject({
    kind: z.literal("suspendOrResumeRun"),
    ...nonce,
    market: marketSchema,
  }),
  z.strictObject({
    kind: z.literal("resumeRun"),
    ...nonce,
    market: marketSchema,
    inputKey: publicKeySchema,
    suspendedAt: positive.refine(
      (value) => BigInt(value) <= 0x7fffffffffffffffn,
    ),
  }),
  z.strictObject({
    kind: z.literal("requestCompletion"),
    ...nonce,
    market: marketSchema,
    hasCrank: z.boolean().optional(),
    expectedAttempt: z.number().int().min(0).max(65_535).optional(),
  }),
  z.strictObject({
    kind: z.literal("settleReturnedRun"),
    ...nonce,
    market: marketSchema,
  }),
]);
export const gameIntentSchema = z.strictObject({
  operation: z.literal("game"),
  sponsored: z.literal(false),
  playSponsor: playSponsorSchema.optional(),
  action,
});
export type GameIntent = z.infer<typeof gameIntentSchema>;
