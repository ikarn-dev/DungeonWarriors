import type { CatStats } from "./catalog";
import type { PlayerIntent } from "./protocol";
import { RULES_V1, speedBps } from "./rules";
import {
  body,
  collects,
  entityRect,
  hits,
  type MotionPath,
  moveRunner,
  overlaps,
} from "./simulation-collision";
import { absorbHit, command, pickupRadius, refresh } from "./simulation-powers";
import {
  addCounter,
  SimulationError,
  type SimulationFrame,
  simulationFrameSchema,
  type WorldEntity,
  worldEntitySchema,
} from "./simulation-state";

export type SimulationStep = {
  readonly frame: SimulationFrame;
  readonly entities: WorldEntity[];
};

function validRect(x: number, y: number, w: number, h: number): boolean {
  const limit = RULES_V1.physics.coordinateLimitSubpixels;
  return (
    w > 0 &&
    h > 0 &&
    x >= -limit &&
    y >= -limit &&
    x + w <= limit &&
    y + h <= limit
  );
}
export function validateWorld(world: readonly WorldEntity[]): void {
  if (world.length > RULES_V1.maxWorldEntities)
    throw new SimulationError("INVALID_WORLD");
  let previous: bigint | undefined;
  for (const e of world) {
    if (
      !worldEntitySchema.safeParse(e).success ||
      (previous !== undefined && previous >= e.id) ||
      !validRect(
        e.xSubpixels,
        e.ySubpixels,
        e.widthSubpixels,
        e.heightSubpixels,
      ) ||
      (e.designatedCoin !== null && e.kind !== "coin") ||
      (e.consumed && (e.kind === "terrain" || e.kind === "hazard"))
    )
      throw new SimulationError("INVALID_WORLD");
    previous = e.id;
  }
}
function validateFrame(frame: SimulationFrame, stats: CatStats): void {
  const p = RULES_V1.physics;
  if (
    !simulationFrameSchema.safeParse(frame).success ||
    !validRect(
      frame.runner.xSubpixels,
      frame.runner.ySubpixels,
      p.hitboxWidthSubpixels,
      p.hitboxHeightSubpixels,
    ) ||
    !Number.isInteger(stats.pickupRadiusSubpixels) ||
    stats.pickupRadiusSubpixels <= 0 ||
    stats.pickupRadiusSubpixels > p.maxRequiredRiseSubpixels ||
    !Number.isInteger(stats.airControlSubpixelsPerTick) ||
    stats.airControlSubpixelsPerTick < 0 ||
    stats.airControlSubpixelsPerTick > p.maxVelocitySubpixelsPerTick
  )
    throw new SimulationError("INVALID_FRAME");
}

function integrateVelocity(
  frame: SimulationFrame,
  stats: CatStats,
  tick: bigint,
): void {
  const p = RULES_V1.physics;
  const r = frame.runner;
  const target = Math.trunc(
    (p.runnerSpeedSubpixelsPerTick * speedBps(frame.activeTicks)) / 10_000,
  );
  if (r.grounded)
    r.automaticSpeedSubpixelsPerTick +=
      Math.sign(target - r.automaticSpeedSubpixelsPerTick) *
      Math.min(
        Math.abs(target - r.automaticSpeedSubpixelsPerTick),
        p.speedEasingSubpixelsPerTick,
      );
  const axis = r.grounded
    ? 0
    : r.axis === "left"
      ? -1
      : r.axis === "right"
        ? 1
        : 0;
  const dash = tick < r.dashEndsAtTick ? p.dashBonusSubpixelsPerTick : 0;
  r.vxSubpixelsPerTick = Math.max(
    -p.maxVelocitySubpixelsPerTick,
    Math.min(
      p.maxVelocitySubpixelsPerTick,
      r.automaticSpeedSubpixelsPerTick +
        axis * stats.airControlSubpixelsPerTick +
        dash,
    ),
  );
  r.vySubpixelsPerTick = Math.max(
    -p.maxVelocitySubpixelsPerTick,
    Math.min(
      p.maxVelocitySubpixelsPerTick,
      r.vySubpixelsPerTick + p.gravitySubpixelsPerTickSquared,
    ),
  );
}

function pickups(
  frame: SimulationFrame,
  world: WorldEntity[],
  stats: CatStats,
  path: MotionPath,
  tick: bigint,
): void {
  for (const e of world) {
    if (
      e.consumed ||
      e.kind === "terrain" ||
      e.kind === "hazard" ||
      !collects(path, e, pickupRadius(frame, stats, tick))
    )
      continue;
    switch (e.kind) {
      case "coin":
        frame.totalCoins = addCounter(frame.totalCoins, 1n);
        frame.score = addCounter(
          frame.score,
          BigInt(RULES_V1.score.coinPoints),
        );
        if (
          e.designatedCheckpoint ===
            (tick - 1n) / BigInt(RULES_V1.checkpointTicks) &&
          e.designatedCoin !== null
        )
          frame.designatedCoinMask |= 1 << e.designatedCoin;
        break;
      case "star":
        frame.score = addCounter(
          frame.score,
          BigInt(RULES_V1.score.starPoints),
        );
        break;
      case "booster":
        refresh(frame.powers[e.power], tick);
        break;
    }
    e.consumed = true;
  }
}

// Pure counterpart to Rust simulation::step. Rectangular terrain only here;
// scheduler/liveness, ramp generation and rebasing remain separate P2 work.
export function step(
  frame: SimulationFrame,
  entities: readonly WorldEntity[],
  stats: CatStats,
  actions: readonly PlayerIntent[],
): SimulationStep {
  validateWorld(entities);
  validateFrame(frame, stats);
  if (actions.length > RULES_V1.maxQueuedIntents)
    throw new SimulationError("INVALID_BATCH");
  const result = {
    frame: structuredClone(frame),
    entities: entities.map((e) => ({ ...e })),
  };
  if (frame.phase !== "active") return result;
  if (
    entities.some(
      (e) =>
        e.kind === "terrain" && overlaps(body(frame.runner), entityRect(e)),
    )
  )
    throw new SimulationError("INVALID_WORLD");
  const tick = addCounter(frame.activeTicks, 1n);
  for (const action of actions) {
    const reason =
      action.kind === "surrender"
        ? "surrender"
        : action.kind === "cashOut" && frame.qualifiedCheckpoints > 0n
          ? "cashOut"
          : null;
    if (reason !== null) {
      result.frame.terminalReason = reason;
      result.frame.phase = "terminalRecorded";
      return result;
    }
    command(result.frame, stats, tick, action);
  }
  integrateVelocity(result.frame, stats, tick);
  const path = moveRunner(result.frame.runner, entities);
  validateFrame(result.frame, stats);
  result.frame.activeTicks = tick;
  for (const e of entities) {
    if (
      e.kind === "hazard" &&
      hits(path, e) &&
      !absorbHit(result.frame, tick)
    ) {
      result.frame.phase = "terminalRecorded";
      result.frame.terminalReason = "crash";
      return result;
    }
  }
  pickups(result.frame, result.entities, stats, path, tick);
  if (tick % BigInt(RULES_V1.checkpointTicks) === 0n) {
    let mask = result.frame.designatedCoinMask;
    let count = 0;
    while (mask !== 0) {
      count += mask & 1;
      mask >>>= 1;
    }
    if (count >= RULES_V1.qualificationCoins)
      result.frame.qualifiedCheckpoints = addCounter(
        result.frame.qualifiedCheckpoints,
        1n,
      );
    result.frame.designatedCoinMask = 0;
  }
  return result;
}
