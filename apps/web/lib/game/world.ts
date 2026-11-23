import type { CatStats, Power } from "./catalog";
import type { PlayerIntent } from "./protocol";
import {
  type GameplayRules,
  minimumPlatformGap,
  platformGap,
  priceChangeBps,
  RULES_V1,
  RULES_V3,
  speedBps,
  terrainStepSubpixels,
} from "./rules";
import { step, validateFrame } from "./simulation";
import { surfaceAt } from "./simulation-collision";
import {
  addCounter,
  SimulationError,
  type SimulationFrame,
  type WorldEntity,
} from "./simulation-state";
import {
  type PriceSample,
  priceSampleSchema,
  validateWorldState,
  type WorldState,
} from "./world-state";

function coordinate(value: number): number {
  if (
    !Number.isInteger(value) ||
    Math.abs(value) > RULES_V1.physics.coordinateLimitSubpixels
  )
    throw new SimulationError("NUMERIC_OVERFLOW");
  return value;
}
function coinDistance(speed: number, target: number, ticks: number): number {
  const ease = RULES_V1.physics.speedEasingSubpixelsPerTick;
  const accelerating = Math.min(ticks, Math.trunc((target - speed) / ease));
  return (
    accelerating * speed +
    (ease * accelerating * (accelerating + 1)) / 2 +
    (ticks - accelerating) * target
  );
}
function push(state: WorldState, entity: WorldEntity): void {
  if (state.entities.length >= RULES_V1.maxWorldEntities)
    throw new SimulationError("INVALID_WORLD");
  entity.id = state.nextEntityId;
  state.nextEntityId = addCounter(state.nextEntityId, 1n);
  state.entities.push(entity);
}
function entity(
  kind: "coin" | "hazard" | "star",
  x: number,
  y: number,
  width: number,
  height: number,
): WorldEntity {
  return {
    id: 0n,
    kind,
    xSubpixels: x,
    ySubpixels: y,
    widthSubpixels: width,
    heightSubpixels: height,
    designatedCoin: null,
    designatedCheckpoint: 0n,
    consumed: false,
  };
}
function rebase(state: WorldState): void {
  if (
    state.frame.runner.xSubpixels <
    RULES_V1.physics.viewportWidthPixels * 256 * 4
  )
    return;
  const width = RULES_V1.generation.segmentWidthSubpixels;
  const shift = (Math.trunc(state.frame.runner.xSubpixels / width) - 1) * width;
  state.worldOriginPixels = addCounter(
    state.worldOriginPixels,
    BigInt(shift / 256),
  );
  state.frame.runner.xSubpixels = coordinate(
    state.frame.runner.xSubpixels - shift,
  );
  for (const e of state.entities)
    e.xSubpixels = coordinate(e.xSubpixels - shift);
  state.generation.nextXSubpixels = coordinate(
    state.generation.nextXSubpixels - shift,
  );
  state.generation.checkpointXSubpixels = coordinate(
    state.generation.checkpointXSubpixels - shift,
  );
}
function prepare(
  state: WorldState,
  sample: PriceSample,
  gameRules: GameplayRules,
): void {
  if (!priceSampleSchema.safeParse(sample).success)
    throw new SimulationError("INVALID_OBSERVATION");
  let change: number;
  try {
    change = priceChangeBps(
      sample.previousPrice,
      sample.previousExponent,
      sample.price,
      sample.exponent,
    );
  } catch {
    throw new SimulationError("INVALID_OBSERVATION");
  }
  const p = gameRules.physics;
  const rules = gameRules.generation;
  const progressive = gameRules.rulesVersion >= 2;
  const platforms = gameRules.rulesVersion >= RULES_V3.rulesVersion;
  const maximum = BigInt(p.maxRequiredRiseSubpixels);
  const movement = progressive
    ? ((sample.previousPrice - sample.price) * 10_000n * maximum) /
      (sample.previousPrice * BigInt(rules.maxSampleChangeBps))
    : BigInt(terrainStepSubpixels(change));
  const terrainStep = Number(
    movement < -maximum ? -maximum : movement > maximum ? maximum : movement,
  );
  const width = rules.segmentWidthSubpixels;
  const minimumGap = minimumPlatformGap(gameRules);
  const cutoff = state.frame.runner.xSubpixels - 2 * width;
  state.entities = state.entities.filter(
    (e) => !e.consumed && e.xSubpixels + e.widthSubpixels >= cutoff,
  );
  rebase(state);
  const checkpoint = state.frame.activeTicks / BigInt(RULES_V1.checkpointTicks);
  if (state.generation.checkpoint !== checkpoint) {
    state.generation.checkpoint = checkpoint;
    state.generation.checkpointXSubpixels = state.frame.runner.xSubpixels;
    state.generation.checkpointSpeedSubpixelsPerTick =
      state.frame.runner.automaticSpeedSubpixelsPerTick;
    state.generation.spawnedCoinMask = 0;
    state.generation.spawnedHazardMask = 0;
  }
  const horizon =
    state.frame.runner.xSubpixels + width * rules.lookaheadSegments;
  for (let i = 0; i <= rules.lookaheadSegments + 2; i++) {
    if (state.generation.nextXSubpixels >= horizon) break;
    const g = { ...state.generation };
    const gap = platformGap(gameRules, g.nextSegment)
      ? minimumGap +
        Math.trunc(
          ((p.maxRequiredGapSubpixels - minimumGap) * Math.abs(terrainStep)) /
            p.maxRequiredRiseSubpixels,
        )
      : 0;
    const platformWidth = width - gap;
    const riseLimit = Math.trunc(
      (p.maxRequiredRiseSubpixels * platformWidth) / width,
    );
    const rise = Math.max(-riseLimit, Math.min(riseLimit, terrainStep));
    const endY =
      g.nextSegment < 2n
        ? g.surfaceYSubpixels
        : Math.max(
            (p.viewportHeightPixels * 256) / 4,
            Math.min(
              (p.viewportHeightPixels * 256 * 3) / 4,
              g.surfaceYSubpixels + rise,
            ),
          );
    const ramp: WorldEntity = {
      ...entity(
        "star",
        g.nextXSubpixels,
        g.surfaceYSubpixels,
        platformWidth,
        p.hitboxHeightSubpixels,
      ),
      kind: "ramp",
      riseSubpixels: endY - g.surfaceYSubpixels,
    };
    push(state, ramp);
    if (
      g.nextSegment >= 2n &&
      (g.nextSegment % BigInt(rules.boosterStrideSegments) === 0n ||
        (Math.abs(change) >= rules.sharpMoveBps && g.nextSegment % 2n === 0n))
    ) {
      const power: Power =
        (["magnet", "doubleJump", "shield", "extraDash"] as const)[
          Number((g.nextSegment / BigInt(rules.boosterStrideSegments)) % 4n)
        ] ?? "magnet";
      const x = coordinate(g.nextXSubpixels + Math.trunc(platformWidth / 2));
      const surface = surfaceAt(ramp, x);
      if (surface === null) throw new SimulationError("INVALID_WORLD");
      const booster =
        g.nextSegment % BigInt(rules.boosterStrideSegments) === 0n;
      const pickupHeight =
        progressive && booster
          ? p.hitboxHeightSubpixels + 16 * 256
          : p.maxRequiredRiseSubpixels + 8 * 256;
      const y = coordinate(surface - pickupHeight);
      const optional: WorldEntity = booster
        ? {
            ...entity("star", x, y, 8 * 256, 8 * 256),
            kind: "booster",
            power,
          }
        : entity("star", x, y, 8 * 256, 8 * 256);
      push(state, optional);
    }
    state.generation.nextXSubpixels = coordinate(g.nextXSubpixels + width);
    state.generation.surfaceYSubpixels = endY;
    state.generation.nextSegment = addCounter(g.nextSegment, 1n);
  }
  const target = Math.trunc(
    (p.runnerSpeedSubpixelsPerTick *
      speedBps(state.frame.activeTicks, gameRules)) /
      10000,
  );
  const coins = rules.designatedCoinTicks;
  const hazards = [
    Math.trunc((coins[0] + coins[1]) / 2),
    Math.trunc((coins[2] + coins[3]) / 2),
    coins[4] + Math.trunc(p.minRequiredCoinSpacingTicks / 2),
  ];
  for (const [hazard, ticks] of [
    [false, coins],
    [true, hazards],
  ] as const) {
    for (const [index, tick] of ticks.entries()) {
      const mask = hazard
        ? state.generation.spawnedHazardMask
        : state.generation.spawnedCoinMask;
      if ((mask & (1 << index)) !== 0) continue;
      let x = coordinate(
        state.generation.checkpointXSubpixels +
          coinDistance(
            state.generation.checkpointSpeedSubpixelsPerTick,
            target,
            tick,
          ) +
          Math.trunc(p.hitboxWidthSubpixels / 2),
      );
      const tile = state.entities.find(
        (e) =>
          e.kind === "ramp" &&
          x >= e.xSubpixels &&
          x < e.xSubpixels + (platforms ? width : e.widthSubpixels),
      );
      if (tile === undefined) continue;
      if (platforms) {
        // Coins scheduled over a gap remain on the takeoff side. Keep hazards
        // out of the jump window on either side of a gap.
        const end = tile.xSubpixels + tile.widthSubpixels;
        if (tile.widthSubpixels < width)
          x = Math.min(x, end - p.hitboxWidthSubpixels / 2);
        const clearance = p.minLandingWidthSubpixels * 2;
        if (
          hazard &&
          state.entities.some((e) => {
            if (e.kind !== "ramp" || e.widthSubpixels === width) return false;
            const edge = e.xSubpixels + e.widthSubpixels;
            return (
              x >= edge - clearance && x <= e.xSubpixels + width + clearance
            );
          })
        ) {
          state.generation.spawnedHazardMask |= 1 << index;
          continue;
        }
      }
      const surface = surfaceAt(tile, x);
      if (surface === null) throw new SimulationError("INVALID_WORLD");
      if (
        !hazard ||
        (progressive && BigInt(index) <= checkpoint / 3n) ||
        Math.abs(change) >= rules.sharpMoveBps
      ) {
        const size = hazard
          ? Math.trunc(p.hitboxWidthSubpixels / 2) +
            (progressive ? Number(checkpoint > 8n ? 8n : checkpoint) * 256 : 0)
          : 8 * 256;
        const y = coordinate(
          surface -
            (hazard ? size : Math.trunc((p.hitboxHeightSubpixels + size) / 2)),
        );
        const pickup = entity(
          hazard ? "hazard" : "coin",
          x - Math.trunc(size / 2),
          y,
          size,
          size,
        );
        if (!hazard) {
          pickup.designatedCoin = index;
          pickup.designatedCheckpoint = checkpoint;
        }
        push(state, pickup);
      }
      if (hazard) state.generation.spawnedHazardMask |= 1 << index;
      else state.generation.spawnedCoinMask |= 1 << index;
    }
  }
  validateWorldState(state, gameRules);
}

// Pure counterpart of Rust world::initialize_world; caller supplies authenticated run stats/source.
export function initializeWorld(
  frame: SimulationFrame,
  stats: CatStats,
  sample: PriceSample,
  gameRules: GameplayRules = RULES_V1,
): WorldState {
  validateFrame(frame, stats);
  if (
    frame.activeTicks !== 0n ||
    frame.runner.xSubpixels !== 0 ||
    frame.runner.automaticSpeedSubpixelsPerTick !==
      RULES_V1.physics.runnerSpeedSubpixelsPerTick ||
    (frame.phase !== "ready" && frame.phase !== "active") ||
    frame.score !== 0n ||
    frame.totalCoins !== 0n ||
    frame.qualifiedCheckpoints !== 0n ||
    frame.designatedCoinMask !== 0 ||
    frame.terminalReason !== null
  )
    throw new SimulationError("INVALID_FRAME");
  const state: WorldState = {
    frame: structuredClone(frame),
    entities: [],
    worldOriginPixels: 0n,
    nextEntityId: 0n,
    generation: {
      nextSegment: 0n,
      nextXSubpixels: -RULES_V1.generation.segmentWidthSubpixels,
      surfaceYSubpixels: coordinate(
        frame.runner.ySubpixels + RULES_V1.physics.hitboxHeightSubpixels,
      ),
      checkpoint: 0n,
      checkpointXSubpixels: 0,
      checkpointSpeedSubpixelsPerTick:
        frame.runner.automaticSpeedSubpixelsPerTick,
      spawnedCoinMask: 0,
      spawnedHazardMask: 0,
    },
  };
  prepare(state, sample, gameRules);
  return state;
}

export type TimedIntent = { tick: bigint; action: PlayerIntent };

// The caller supplies the price sample and already-ordered actions for this
// window. This loop has no wallet, clock, network or settlement authority.
export function advanceWorld(
  world: WorldState,
  stats: CatStats,
  intents: readonly TimedIntent[],
  sample: PriceSample,
  rules: GameplayRules,
  ticks: number,
): { world: WorldState; limited: boolean } {
  if (!Number.isInteger(ticks) || ticks < 0 || ticks > rules.ticksPerSecond)
    throw new RangeError("Invalid simulation window");
  const through = world.frame.activeTicks + BigInt(ticks);
  const actionsByTick = new Map<bigint, PlayerIntent[]>();
  for (const { tick, action } of intents) {
    if (tick <= world.frame.activeTicks || tick > through) continue;
    const actions = actionsByTick.get(tick);
    if (actions) actions.push(action);
    else actionsByTick.set(tick, [action]);
  }
  for (let i = 0; i < ticks && world.frame.phase === "active"; i++) {
    const actions = actionsByTick.get(world.frame.activeTicks + 1n) ?? [];
    if (actions.length > rules.maxQueuedIntents)
      return { world, limited: true };
    world = stepWorld(world, stats, actions, sample, rules);
  }
  return { world, limited: false };
}

export function stepWorld(
  state: WorldState,
  stats: CatStats,
  actions: readonly PlayerIntent[],
  sample: PriceSample,
  gameRules: GameplayRules = RULES_V1,
): WorldState {
  validateWorldState(state, gameRules);
  validateFrame(state.frame, stats);
  const result = structuredClone(state);
  if (state.frame.phase !== "active") return result;
  prepare(result, sample, gameRules);
  const next = step(result.frame, result.entities, stats, actions, gameRules);
  result.frame = next.frame;
  result.entities = next.entities;
  return result;
}
