import "server-only";
import { z } from "zod";
import { deviceIntents } from "../game/device-intents";
import { u64Input } from "../solana/program";
import { gameIntentSchema } from "./game-transactions";

export const intentSchema = z.discriminatedUnion("operation", [
  gameIntentSchema,
  ...deviceIntents,
  z
    .object({ operation: z.literal("createPlayer"), sponsored: z.boolean() })
    .strict(),
  z
    .object({
      operation: z.literal("claimStarter"),
      nonce: u64Input,
      inventoryVersion: u64Input,
      catalogVersion: z.number().int().min(1).max(0xffffffff),
      sponsored: z.literal(true),
    })
    .strict(),
  z
    .object({
      operation: z.literal("selectCat"),
      inventoryVersion: u64Input,
      cat: z.enum(["collector", "acrobat", "guardian", "sprinter"]),
      sponsored: z.literal(false),
    })
    .strict(),
  z
    .object({
      operation: z.literal("owner"),
      instruction: z.enum([
        "deposit",
        "withdraw",
        "authorizeSession",
        "revokeSession",
        "reserveRun",
        "selectCat",
      ]),
      sponsored: z.literal(false),
    })
    .strict(),
]);
export const submitInput = z
  .object({ intent: intentSchema, transaction: z.string().min(1).max(1800) })
  .strict();
export type Intent = z.infer<typeof intentSchema>;
