import { z } from "zod";
import { publicKeySchema } from "../solana/addresses";
import { u64Input } from "../solana/program";
import { dungeonRulesSchema, PHYSICS } from "./rules";
import { inputsSchema } from "./simulation";

export const catSchema = z.enum([
  "collector",
  "acrobat",
  "guardian",
  "sprinter",
]);
export const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const identity = { nonce: u64Input };
const client = { ...identity, client: z.uuid() };
const room = z.number().int().min(0).max(4);
export const dungeonRequestSchema = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("history"), fromNonce: u64Input.optional() })
    .strict(),
  z.object({ kind: z.literal("leaderboard") }).strict(),
  z
    .object({
      kind: z.literal("offer"),
      stake: u64Input.refine((v) => BigInt(v) > 0n),
      cat: catSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("quote"),
      stake: u64Input.refine((v) => BigInt(v) > 0n),
      cat: catSchema,
      maxRooms: z.number().int().min(1).max(5),
      maxGross: u64Input,
      rulesHash: hashSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("submit"),
      ...identity,
      transaction: z.string().min(1).max(2400),
    })
    .strict(),
  z
    .object({
      kind: z.literal("status"),
      nonce: u64Input.optional(),
      client: z.uuid().optional(),
    })
    .strict(),
  z.object({ kind: z.literal("start"), ...client, room }).strict(),
  z
    .object({
      kind: z.literal("enter"),
      ...client,
      room,
      gate: z.number().int().min(0).max(2),
      through: z.number().int().min(0).max(PHYSICS.maxRoomTicks),
      inputs: inputsSchema,
    })
    .strict(),
  z.object({ kind: z.literal("cashout"), ...client }).strict(),
  z.object({ kind: z.literal("exit"), ...client }).strict(),
]);
export type DungeonRequest = z.infer<typeof dungeonRequestSchema>;
export const preparationSchema = z
  .object({
    transaction: z.string().min(1).max(2400),
    lastValidBlockHeight: z.number().int().positive(),
    sponsor: publicKeySchema,
    maxPayerDebit: u64Input,
  })
  .strict();
export const dungeonViewSchema = z
  .object({
    nonce: u64Input,
    owner: publicKeySchema,
    cat: catSchema,
    rules: dungeonRulesSchema,
    rulesHash: hashSchema,
    commitment: hashSchema,
    stake: u64Input,
    maxGross: u64Input,
    maxRooms: z.number().int().min(1).max(5),
    cleared: z.number().int().min(0).max(5),
    gates: z.array(z.number().int().min(0).max(2)).max(5),
    phase: z.enum([
      "preparing",
      "ready",
      "playing",
      "intermission",
      "won",
      "lost",
      "refunded",
      "cancelled",
    ]),
    settled: z.boolean(),
    payout: u64Input,
    serverNow: z.number().int().nonnegative(),
    room: z
      .object({
        index: room,
        // Public per-room generation seed; independent of the gate secret.
        seed: hashSchema,
        startedAt: z.number().int().positive(),
      })
      .strict()
      .nullable(),
    preparation: preparationSchema.nullable(),
    proof: z
      .object({ randomness: hashSchema, secret: hashSchema })
      .strict()
      .nullable(),
  })
  .strict();
export type DungeonView = z.infer<typeof dungeonViewSchema>;
export type DungeonPreparation = z.infer<typeof preparationSchema>;

export const dungeonOfferSchema = dungeonViewSchema
  .pick({
    owner: true,
    cat: true,
    rules: true,
    rulesHash: true,
    stake: true,
    maxGross: true,
    maxRooms: true,
  })
  .extend({ available: u64Input })
  .strict();
export type DungeonOffer = z.infer<typeof dungeonOfferSchema>;
