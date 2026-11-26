import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  dungeonViewSchema,
  hashSchema,
  preparationSchema,
} from "../dungeon/protocol";
import { publicKeySchema } from "../solana/addresses";
import { u64Input } from "../solana/program";
import { ApiError, runtime } from "./runtime";

export const deliverySchema = z
  .object({
    transaction: z.string().max(2400),
    signature: z.string().min(64).max(88),
    lastValidBlockHeight: z.number().int().positive(),
    cost: u64Input,
    stage: z.enum(["schedule", "commit", "trigger"]).optional(),
    sentAt: z.number().int().optional(),
  })
  .strict();
export const dungeonRecordSchema = dungeonViewSchema
  .omit({ serverNow: true, proof: true, preparation: true })
  .extend({
    client: z.uuid().nullable(),
    randomness: hashSchema.nullable(),
    createdAt: z.number().int(),
    dueAt: z.number().int(),
    reserve: preparationSchema
      .extend({
        messageHash: hashSchema,
        signature: z.string().nullable(),
        cost: u64Input,
      })
      .strict(),
    delivery: deliverySchema.nullable(),
    outcome: z.union([z.literal(0), z.literal(1), z.literal(2)]).nullable(),
    reason: z
      .enum([
        "banked",
        "trap",
        "gas",
        "fallen",
        "abandoned",
        "unstarted",
        "vrfTimeout",
        "cancelled",
      ])
      .nullable(),
  })
  .strict();
export type DungeonRecord = z.infer<typeof dungeonRecordSchema>;
export const dungeonKey = (owner: string, nonce: string) =>
  `${runtime().prefix}:dungeon:expedition:${publicKeySchema.parse(owner)}:${u64Input.parse(nonce)}`;
export const dungeonActiveKey = (owner: string) =>
  `${runtime().prefix}:dungeon:active:${publicKeySchema.parse(owner)}`;
export const dungeonPendingKey = (owner: string) =>
  `${runtime().prefix}:dungeon:pending:${publicKeySchema.parse(owner)}`;
export async function activeDungeon(owner: string): Promise<string | null> {
  const value = await runtime().redis.get<string>(dungeonActiveKey(owner));
  return value === null ? null : u64Input.parse(String(value));
}
export async function withDungeon<T>(
  owner: string,
  nonce: string,
  work: (
    record: DungeonRecord | null,
  ) => Promise<{ record: DungeonRecord | null; value: T }>,
): Promise<T> {
  const r = runtime(),
    key = dungeonKey(owner, nonce),
    token = randomUUID();
  if (!(await r.redis.set(`${key}:lock`, token, { nx: true, px: 30000 })))
    throw new ApiError("DUNGEON_BUSY", 409);
  try {
    const stored = await r.redis.get<string>(key);
    const record =
      stored === null
        ? null
        : dungeonRecordSchema.parse(JSON.parse(stored.slice(1)));
    const result = await work(record);
    if (result.record) {
      const next = dungeonRecordSchema.parse(result.record);
      if (next.owner !== owner || next.nonce !== nonce)
        throw new ApiError("DUNGEON_SCOPE_MISMATCH", 409);
      const saved = await r.redis.eval(
        "if redis.call('GET',KEYS[1])~=ARGV[1] then return 0 end; redis.call('SET',KEYS[2],ARGV[2]); if ARGV[3]=='1' then redis.call('ZREM',KEYS[3],ARGV[4]); if redis.call('GET',KEYS[4])==ARGV[4] then redis.call('DEL',KEYS[4]) end; redis.call('EXPIRE',KEYS[2],86400) else redis.call('SET',KEYS[4],ARGV[4]); redis.call('ZADD',KEYS[3],ARGV[5],ARGV[4]) end; return 1",
        [`${key}:lock`, key, dungeonPendingKey(owner), dungeonActiveKey(owner)],
        [
          token,
          `!${JSON.stringify(next)}`,
          next.settled ? "1" : "0",
          nonce,
          next.dueAt,
        ],
      );
      if (saved !== 1) throw new ApiError("DUNGEON_BUSY", 409);
    }
    return result.value;
  } finally {
    await r.redis.eval(
      "if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) end; return 0",
      [`${key}:lock`],
      [token],
    );
  }
}
