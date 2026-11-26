import { z } from "zod";
import { pause, WebApiError, webApi } from "../game/web-api";
import { publicKeySchema } from "../solana/addresses";
import { u64Input } from "../solana/program";
import { catSchema, type DungeonRequest, hashSchema } from "./protocol";

export const dungeonPrepareSchema = z.strictObject({
  kind: z.literal("prepare"),
  stake: u64Input.refine((value) => BigInt(value) > 0n),
  cat: catSchema,
  device: publicKeySchema.optional(),
  review: z
    .strictObject({
      maxRooms: z.number().int().min(1).max(5),
      maxGross: u64Input,
      rulesHash: hashSchema,
    })
    .optional(),
});
export type DungeonPrepare = z.infer<typeof dungeonPrepareSchema>;

// A busy write lock rejects before changing the record. Repeat the same
// request; never replace a wallet-approved transaction or cancel it here.
export async function requestDungeon(
  input: DungeonRequest | DungeonPrepare,
  signal?: AbortSignal,
): Promise<unknown> {
  const deadline = AbortSignal.timeout(12000);
  const bounded = signal ? AbortSignal.any([signal, deadline]) : deadline;
  for (let attempt = 0; ; attempt++) {
    bounded.throwIfAborted();
    try {
      return await webApi("/api/dungeon", input, bounded);
    } catch (error) {
      if (
        !(error instanceof WebApiError) ||
        error.code !== "DUNGEON_BUSY" ||
        attempt >= 3
      )
        throw error;
      await pause(1000, bounded);
    }
  }
}
