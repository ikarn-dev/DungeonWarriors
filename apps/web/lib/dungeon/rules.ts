import { z } from "zod";
import { ENGINE_HASH } from "./engine-binding.ts";

export const DUNGEON_RULES_VERSION = 3;
export const LEGACY_DUNGEON_ENGINE_HASH =
  "87507c4a8b685d6ed938808b8cc2b44e18944bc90b5ed6277aeda80365daf479";

// Financial and timing envelope frozen onchain in DungeonConfig. The program
// hashes the envelope and the exact shared engine binding.
export const dungeonRulesSchema = z
  .object({
    version: z.union([z.literal(2), z.literal(DUNGEON_RULES_VERSION)]),
    engineHash: z.array(z.number().int().min(0).max(255)).length(32),
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
  .strict()
  .refine(
    ({ version, engineHash }) =>
      engineHash.map((b) => b.toString(16).padStart(2, "0")).join("") ===
      (version === DUNGEON_RULES_VERSION
        ? ENGINE_HASH
        : LEGACY_DUNGEON_ENGINE_HASH),
    { path: ["engineHash"] },
  );
export type DungeonRules = z.infer<typeof dungeonRulesSchema>;
export const DUNGEON_V3: DungeonRules = {
  version: DUNGEON_RULES_VERSION,
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
// Rules v3 make defeat terminal. Existing rules-v2 expeditions keep their
// original engine binding and checkpoint behavior until settlement.
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
const controlSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("move"),
      axis: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
    })
    .strict(),
  z.object({ kind: z.literal("jump") }).strict(),
  z.object({ kind: z.literal("attack") }).strict(),
]);
export type Control = z.infer<typeof controlSchema>;
const inputSchema = z
  .object({
    tick: z.number().int().min(1).max(PHYSICS.maxRoomTicks),
    action: controlSchema,
  })
  .strict();
export const inputsSchema = z.array(inputSchema).max(PHYSICS.maxInputs);
export type DungeonInput = z.infer<typeof inputSchema>;
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
