import { z } from "zod";
import { runPhaseSchema, terminalReasonSchema } from "./protocol";
import { RULES_V1, U64_MAX } from "./rules";

const u64 = z.bigint().min(0n).max(U64_MAX);
const coordinate = z
  .number()
  .int()
  .min(-RULES_V1.physics.coordinateLimitSubpixels)
  .max(RULES_V1.physics.coordinateLimitSubpixels);
const velocity = z
  .number()
  .int()
  .min(-RULES_V1.physics.maxVelocitySubpixelsPerTick)
  .max(RULES_V1.physics.maxVelocitySubpixelsPerTick);
const power = z.enum(["magnet", "doubleJump", "shield", "extraDash"]);
export const powerStateSchema = z
  .object({
    readyAtTick: u64,
    endsAtTick: u64,
    charges: z.number().int().min(0).max(1),
  })
  .strict();
export type PowerState = z.infer<typeof powerStateSchema>;
export const runnerStateSchema = z
  .object({
    xSubpixels: coordinate,
    ySubpixels: coordinate,
    vxSubpixelsPerTick: velocity,
    vySubpixelsPerTick: velocity,
    automaticSpeedSubpixelsPerTick: z
      .number()
      .int()
      .min(0)
      .max(RULES_V1.physics.maxVelocitySubpixelsPerTick),
    grounded: z.boolean(),
    axis: z.enum(["left", "neutral", "right"]),
    dashEndsAtTick: u64,
    dashReadyAtTick: u64,
    shieldContactEndsAtTick: u64,
  })
  .strict();
export type RunnerState = z.infer<typeof runnerStateSchema>;
const entity = z.object({
  id: u64,
  xSubpixels: coordinate,
  ySubpixels: coordinate,
  widthSubpixels: z
    .number()
    .int()
    .positive()
    .max(RULES_V1.physics.coordinateLimitSubpixels * 2),
  heightSubpixels: z
    .number()
    .int()
    .positive()
    .max(RULES_V1.physics.coordinateLimitSubpixels * 2),
  designatedCoin: z.number().int().min(0).max(4).nullable(),
  designatedCheckpoint: u64,
  consumed: z.boolean(),
});
export const worldEntitySchema = z.discriminatedUnion("kind", [
  entity.extend({ kind: z.literal("terrain") }).strict(),
  entity.extend({ kind: z.literal("hazard") }).strict(),
  entity.extend({ kind: z.literal("coin") }).strict(),
  entity.extend({ kind: z.literal("star") }).strict(),
  entity.extend({ kind: z.literal("booster"), power }).strict(),
  entity
    .extend({ kind: z.literal("ramp"), riseSubpixels: coordinate })
    .strict(),
]);
export type WorldEntity = z.infer<typeof worldEntitySchema>;

// Parse this projection only after generated-IDL account/owner/version checks.
// It contains no authoritative balances or permission to submit game progress.
export const simulationFrameSchema = z
  .object({
    phase: runPhaseSchema,
    activeTicks: u64,
    runner: runnerStateSchema,
    powers: z
      .object({
        magnet: powerStateSchema,
        doubleJump: powerStateSchema,
        shield: powerStateSchema,
        extraDash: powerStateSchema,
      })
      .strict(),
    score: u64,
    totalCoins: u64,
    designatedCoinMask: z.number().int().min(0).max(31),
    qualifiedCheckpoints: u64,
    terminalReason: terminalReasonSchema.nullable(),
  })
  .strict()
  .refine(
    (frame) =>
      (frame.terminalReason !== null) ===
      (frame.phase === "terminalRecorded" ||
        frame.phase === "completionRequested"),
    { message: "Inconsistent terminal phase" },
  );
export type SimulationFrame = z.infer<typeof simulationFrameSchema>;

export class SimulationError extends Error {
  constructor(
    readonly code:
      | "INVALID_FRAME"
      | "INVALID_WORLD"
      | "INVALID_BATCH"
      | "NUMERIC_OVERFLOW"
      | "INVALID_OBSERVATION",
  ) {
    super(code);
    this.name = "SimulationError";
  }
}

export function addCounter(a: bigint, b: bigint): bigint {
  const value = a + b;
  if (value < 0n || value > U64_MAX)
    throw new SimulationError("NUMERIC_OVERFLOW");
  return value;
}
