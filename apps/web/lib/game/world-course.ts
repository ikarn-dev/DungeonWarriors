import type { Power } from "./catalog";
import {
  COURSE_MAX_GAP_SUBPIXELS,
  type GameplayRules,
  minimumPlatformGap,
  RULES_V1,
  RULES_V4,
  speedBps,
} from "./rules";
import { surfaceAt } from "./simulation-collision";
import {
  addCounter,
  SimulationError,
  type WorldEntity,
} from "./simulation-state";
import type { PriceSample, WorldState } from "./world-state";

export function coordinate(value: number): number {
  if (
    !Number.isInteger(value) ||
    Math.abs(value) > RULES_V1.physics.coordinateLimitSubpixels
  )
    throw new SimulationError("NUMERIC_OVERFLOW");
  return value;
}
export function push(state: WorldState, entity: WorldEntity): void {
  if (state.entities.length >= RULES_V1.maxWorldEntities)
    throw new SimulationError("INVALID_WORLD");
  entity.id = state.nextEntityId;
  state.nextEntityId = addCounter(state.nextEntityId, 1n);
  state.entities.push(entity);
}
export function entity(
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

// Rules v4 course (browser runs, replayed by the server). The ground follows
// the price chart: the surface height tracks the move since the run's first
// price, so a rally builds hills and a sell-off digs valleys. Pits and spikes
// come from a per-run seed and get more frequent each level, pits also wider,
// while speed rises. Every course stays clearable with base controls:
//   - a jump rises 144 px; pits are 40–96 px and the far side starts at the
//     takeoff height;
//   - after a pit or spike, the next one starts beyond the longest jump at the
//     next level's speed (with room for a descending landing), so a well-timed
//     jump never lands on another obstacle;
//   - one segment of slope changes height by at most 48 px;
//   - spikes are 20 px square, the size of their artwork.
export const COURSE_V4 = {
  // Surface offset saturates towards this height as the move grows.
  priceRangeSubpixels: 120 * 256,
  // A move of this many basis points uses half of the range.
  priceHalfRangeBps: 15n,
  safeSegments: 3n,
  minGapSubpixels: minimumPlatformGap(RULES_V4),
  maxGapSubpixels: COURSE_MAX_GAP_SUBPIXELS,
  pitPercent: { base: 35, perLevel: 6, max: 65 },
  spikePercent: { base: 45, perLevel: 6, max: 80 },
  // Landing room after an obstacle, as a share of the flat jump distance.
  landingPercent: 140,
  starPercent: 30,
  spikeSubpixels: 20 * 256,
  // Coins that share a spike's position float at jump height instead.
  coinLiftSubpixels: 64 * 256,
} as const;

export function isCourse(rules: GameplayRules) {
  return rules.rulesVersion >= RULES_V4.rulesVersion;
}

// Integer-only mixing, identical in every JavaScript engine.
function roll(seed: number, segment: bigint, salt: number): number {
  let h = Math.imul(Number(segment & 0x7fff_ffffn) ^ seed, 0x9e37_79b1) ^ salt;
  h = Math.imul(h ^ (h >>> 16), 0x85eb_ca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2_ae35);
  return ((h ^ (h >>> 16)) >>> 0) % 100;
}

// The sample's previous price is the run's first price (the anchor).
export function priceTargetY(sample: PriceSample, rules: GameplayRules) {
  if (sample.exponent !== sample.previousExponent)
    throw new SimulationError("INVALID_OBSERVATION");
  const anchor = sample.previousPrice;
  if (anchor <= 0n || sample.price <= 0n)
    throw new SimulationError("INVALID_OBSERVATION");
  const bps = ((sample.price - anchor) * 10_000n) / anchor;
  const size = bps < 0n ? -bps : bps;
  const offset =
    (BigInt(COURSE_V4.priceRangeSubpixels) * bps) /
    (size + COURSE_V4.priceHalfRangeBps);
  return (rules.physics.viewportHeightPixels * 256) / 2 - Number(offset);
}

function chance(
  table: { base: number; perLevel: number; max: number },
  level: number,
) {
  return Math.min(table.max, table.base + table.perLevel * level);
}

// Longest flat jump at the next level's speed, stretched for a landing on a
// descending slope, plus the hitbox.
function obstacleSpacing(state: WorldState, rules: GameplayRules) {
  const p = rules.physics;
  const ahead = state.frame.activeTicks + BigInt(rules.checkpointTicks);
  const speed = Math.trunc(
    (p.runnerSpeedSubpixelsPerTick * speedBps(ahead, rules)) / 10_000,
  );
  const airTicks = Math.trunc(
    (2 * -p.jumpVelocitySubpixelsPerTick) / p.gravitySubpixelsPerTickSquared,
  );
  return (
    Math.trunc((speed * airTicks * COURSE_V4.landingPercent) / 100) +
    p.hitboxWidthSubpixels
  );
}

// Far end of the furthest existing pit or spike.
function lastObstacleEnd(state: WorldState, width: number) {
  let end = Number.MIN_SAFE_INTEGER;
  for (const e of state.entities) {
    if (e.kind === "hazard")
      end = Math.max(end, e.xSubpixels + e.widthSubpixels);
    else if (e.kind === "ramp" && e.widthSubpixels < width)
      end = Math.max(end, e.xSubpixels + width);
  }
  return end;
}

const POWERS = ["magnet", "doubleJump", "shield", "extraDash"] as const;

function placePickup(
  state: WorldState,
  ramp: WorldEntity,
  segment: bigint,
  rules: GameplayRules,
) {
  const p = rules.physics;
  const stride = BigInt(rules.generation.boosterStrideSegments);
  const booster = segment % stride === 0n;
  const x = coordinate(ramp.xSubpixels + Math.trunc(ramp.widthSubpixels / 2));
  const surface = surfaceAt(ramp, x);
  if (surface === null) throw new SimulationError("INVALID_WORLD");
  const y = coordinate(
    surface - p.hitboxHeightSubpixels - (booster ? 16 : 40) * 256,
  );
  const power: Power = POWERS[Number((segment / stride) % 4n)] ?? "magnet";
  push(
    state,
    booster
      ? { ...entity("star", x, y, 8 * 256, 8 * 256), kind: "booster", power }
      : entity("star", x, y, 8 * 256, 8 * 256),
  );
  return booster;
}

export function extendCourse(
  state: WorldState,
  sample: PriceSample,
  rules: GameplayRules,
): void {
  const p = rules.physics;
  const g = rules.generation;
  const width = g.segmentWidthSubpixels;
  const level = Number(
    state.generation.checkpoint > 10n ? 10n : state.generation.checkpoint,
  );
  const seed = Number(sample.previousPrice % 2_147_483_647n);
  const target = priceTargetY(sample, rules);
  const top = (p.viewportHeightPixels * 256) / 4;
  const bottom = (p.viewportHeightPixels * 256 * 3) / 4;
  const horizon = state.frame.runner.xSubpixels + width * g.lookaheadSegments;
  const clear = obstacleSpacing(state, rules);
  let lastEnd = lastObstacleEnd(state, width);
  for (let i = 0; i <= g.lookaheadSegments + 2; i++) {
    const gen = state.generation;
    if (gen.nextXSubpixels >= horizon) break;
    const segment = gen.nextSegment;
    const safe = segment < COURSE_V4.safeSegments;
    const wanted = Math.min(
      COURSE_V4.maxGapSubpixels,
      COURSE_V4.minGapSubpixels +
        (level * 6 + (roll(seed, segment, 2) % 12)) * 256,
    );
    const pit =
      !safe &&
      gen.nextXSubpixels + width - wanted >= lastEnd + clear &&
      roll(seed, segment, 1) < chance(COURSE_V4.pitPercent, level);
    const gap = pit ? wanted : 0;
    if (pit) lastEnd = gen.nextXSubpixels + width;
    const platformWidth = width - gap;
    const riseLimit = Math.trunc(
      (p.maxRequiredRiseSubpixels * platformWidth) / width,
    );
    const rise = safe
      ? 0
      : Math.max(
          -riseLimit,
          Math.min(riseLimit, target - gen.surfaceYSubpixels),
        );
    const endY = Math.max(top, Math.min(bottom, gen.surfaceYSubpixels + rise));
    const ramp: WorldEntity = {
      ...entity(
        "star",
        gen.nextXSubpixels,
        gen.surfaceYSubpixels,
        platformWidth,
        p.hitboxHeightSubpixels,
      ),
      kind: "ramp",
      riseSubpixels: endY - gen.surfaceYSubpixels,
    };
    push(state, ramp);
    const size = COURSE_V4.spikeSubpixels;
    const center = coordinate(gen.nextXSubpixels + Math.trunc((width * 5) / 8));
    const spike =
      !safe &&
      !pit &&
      center - Math.trunc(size / 2) >= lastEnd + clear &&
      roll(seed, segment, 3) < chance(COURSE_V4.spikePercent, level);
    if (spike) {
      const surface = surfaceAt(ramp, center);
      if (surface === null) throw new SimulationError("INVALID_WORLD");
      const left = coordinate(center - Math.trunc(size / 2));
      push(
        state,
        entity("hazard", left, coordinate(surface - size), size, size),
      );
      lastEnd = left + size;
    }
    const booster = segment % BigInt(g.boosterStrideSegments) === 0n;
    if (!safe && (booster || roll(seed, segment, 4) < COURSE_V4.starPercent))
      placePickup(state, ramp, segment, rules);
    gen.nextXSubpixels = coordinate(gen.nextXSubpixels + width);
    gen.surfaceYSubpixels = endY;
    gen.nextSegment = addCounter(segment, 1n);
  }
}

// Height for a designated coin: at runner height, or lifted over a spike.
export function courseCoinLift(
  state: WorldState,
  x: number,
  rules: GameplayRules,
): number | null {
  const reach = rules.physics.hitboxWidthSubpixels;
  const blocked = state.entities.some(
    (e) =>
      e.kind === "hazard" &&
      x >= e.xSubpixels - reach &&
      x <= e.xSubpixels + e.widthSubpixels + reach,
  );
  return blocked ? COURSE_V4.coinLiftSubpixels : null;
}
