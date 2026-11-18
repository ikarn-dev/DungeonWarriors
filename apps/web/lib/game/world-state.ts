import { z } from "zod";
import { RULES_V1, speedBps, U64_MAX } from "./rules";
import { validateWorld } from "./simulation";
import { surfaceAt } from "./simulation-collision";
import {
  SimulationError,
  simulationFrameSchema,
  worldEntitySchema,
} from "./simulation-state";

const u64 = z.bigint().min(0n).max(U64_MAX);
const coordinate = z
  .number()
  .int()
  .min(-RULES_V1.physics.coordinateLimitSubpixels)
  .max(RULES_V1.physics.coordinateLimitSubpixels);
const exponent = z.number().int().min(-18).max(18);
const price = z
  .bigint()
  .min(1n)
  .max((1n << 63n) - 1n);
export const priceSampleSchema = z
  .object({
    previousPrice: price,
    previousExponent: exponent,
    price,
    exponent,
  })
  .strict();
export type PriceSample = z.infer<typeof priceSampleSchema>;

export const generationStateSchema = z
  .object({
    nextSegment: u64,
    nextXSubpixels: coordinate,
    surfaceYSubpixels: coordinate,
    checkpoint: u64,
    checkpointXSubpixels: coordinate,
    checkpointSpeedSubpixelsPerTick: z
      .number()
      .int()
      .min(0)
      .max(RULES_V1.physics.maxVelocitySubpixelsPerTick),
    spawnedCoinMask: z.number().int().min(0).max(31),
    spawnedHazardMask: z.number().int().min(0).max(7),
  })
  .strict();
export const worldStateSchema = z
  .object({
    frame: simulationFrameSchema,
    entities: z.array(worldEntitySchema).max(RULES_V1.maxWorldEntities),
    generation: generationStateSchema,
    worldOriginPixels: u64,
    nextEntityId: u64,
  })
  .strict();
export type WorldState = z.infer<typeof worldStateSchema>;

export function validateWorldState(state: WorldState): void {
  if (!worldStateSchema.safeParse(state).success)
    throw new SimulationError("INVALID_WORLD");
  validateWorld(state.entities);
  const g = state.generation;
  const p = RULES_V1.physics;
  const checkpoint = state.frame.activeTicks / BigInt(RULES_V1.checkpointTicks);
  const target = Math.trunc(
    (p.runnerSpeedSubpixelsPerTick * speedBps(state.frame.activeTicks)) / 10000,
  );
  if (
    g.checkpoint > checkpoint ||
    checkpoint - g.checkpoint > 1n ||
    g.checkpointSpeedSubpixelsPerTick > target ||
    g.checkpointSpeedSubpixelsPerTick < p.runnerSpeedSubpixelsPerTick ||
    (g.checkpoint !== checkpoint &&
      state.frame.activeTicks % BigInt(RULES_V1.checkpointTicks) !== 0n) ||
    g.nextXSubpixels + RULES_V1.generation.segmentWidthSubpixels <
      state.frame.runner.xSubpixels ||
    g.surfaceYSubpixels < (p.viewportHeightPixels * 256) / 4 ||
    g.surfaceYSubpixels > (p.viewportHeightPixels * 256 * 3) / 4 ||
    state.entities.some((e) => e.id >= state.nextEntityId)
  )
    throw new SimulationError("INVALID_WORLD");
  const ramps = state.entities
    .filter((e) => e.kind === "ramp")
    .sort((a, b) => a.xSubpixels - b.xSubpixels);
  const first = ramps[0];
  const last = ramps.at(-1);
  const width = RULES_V1.generation.segmentWidthSubpixels;
  const horizon =
    state.frame.runner.xSubpixels +
    width * RULES_V1.generation.lookaheadSegments;
  if (
    first === undefined ||
    last === undefined ||
    first.xSubpixels > state.frame.runner.xSubpixels ||
    g.nextXSubpixels < horizon - p.maxVelocitySubpixelsPerTick ||
    g.nextXSubpixels > horizon + width ||
    last.xSubpixels + last.widthSubpixels !== g.nextXSubpixels ||
    surfaceAt(last, g.nextXSubpixels) !== g.surfaceYSubpixels ||
    ramps.some((r, index) => {
      const next = ramps[index + 1];
      return (
        next !== undefined &&
        (r.xSubpixels + r.widthSubpixels !== next.xSubpixels ||
          surfaceAt(r, next.xSubpixels) !== next.ySubpixels)
      );
    })
  )
    throw new SimulationError("INVALID_WORLD");
}
