import { z } from "zod";
import { ENGINE_HASH } from "./engine-binding.ts";

// Financial and timing envelope frozen onchain in DungeonConfig. The program
// hashes the envelope and the exact shared engine binding.
export const dungeonRulesSchema = z
  .object({
    version: z.literal(2),
    engineHash: z
      .array(z.number().int().min(0).max(255))
      .length(32)
      .refine(
        (bytes) =>
          bytes.map((b) => b.toString(16).padStart(2, "0")).join("") ===
          ENGINE_HASH,
      ),
    rooms: z.number().int().min(1).max(5),
    returnBps: z.number().int().min(6667).max(10000),
    roomSeconds: z
      .tuple([z.number(), z.number(), z.number(), z.number(), z.number()])
      .refine((values) =>
        values.every((n) => Number.isInteger(n) && n >= 10 && n <= 120),
      ),
    collectorBonusMs: z.number().int().min(0).max(10000),
    guardianGraceMs: z.number().int().min(0).max(10000),
    hourglassMs: z.number().int().min(0).max(10000),
    sprintBps: z.number().int().min(10000).max(15000),
    vrfTimeoutSeconds: z.number().int().min(30).max(600),
  })
  .strict();
export type DungeonRules = z.infer<typeof dungeonRulesSchema>;
export const DUNGEON_V2: DungeonRules = {
  version: 2,
  engineHash: Array.from({ length: 32 }, (_, i) =>
    Number.parseInt(ENGINE_HASH.slice(i * 2, i * 2 + 2), 16),
  ),
  rooms: 5,
  returnBps: 9500,
  // Minimum room time; generated rooms add time for their length and foes.
  roomSeconds: [30, 28, 26, 24, 22],
  collectorBonusMs: 3000,
  guardianGraceMs: 5000,
  hourglassMs: 3000,
  sprintBps: 11000,
  vrfTimeoutSeconds: 300,
};
// Engine v2 (2026-11-24): generated rooms, enemies and warrior combat.
// v3 (2026-11-26): losing all health ends the room as a loss. The rules
// envelope stays version 2; the engine hash identifies the engine.
export const ENGINE = "purrps-dungeon-v3";
// Positions are 1/256 px; velocities per tick. Jump rises 100 px and travels
// 120 px on flat ground at base speed.
export const PHYSICS = {
  ticksPerSecond: 60,
  unit: 256,
  width: 28 * 256,
  height: 40 * 256,
  speed: 3 * 256,
  gravity: 128,
  jump: -10 * 256,
  maxFall: 16 * 256,
  coyoteTicks: 6,
  maxInputs: 3000,
  maxInputsPerSecond: 20,
  maxRoomTicks: 9000,
  maxRoomMs: 120000,
} as const;
export function payout(
  stake: bigint,
  cleared: number,
  rules: DungeonRules,
): bigint {
  if (
    !Number.isInteger(cleared) ||
    cleared < 1 ||
    cleared > rules.rooms ||
    stake <= 0n
  )
    throw new Error("INVALID_DUNGEON_PAYOUT");
  const n = BigInt(cleared);
  return (stake * BigInt(rules.returnBps) * 3n ** n) / (10000n * 2n ** n);
}
export function affordableDepth(
  stake: bigint,
  cap: bigint,
  rules: DungeonRules,
): number {
  if (stake <= 0n || cap <= stake) return 0;
  for (let depth = rules.rooms; depth > 0; depth--)
    if (payout(stake, depth, rules) <= cap) return depth;
  return 0;
}
