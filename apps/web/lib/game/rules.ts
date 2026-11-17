// Pure predictor contract; imported data does not authorize gameplay or funds.
// Mirrors src/rules.rs. Positions use 256 signed subpixels/pixel, y points down;
// velocity is subpixels/tick, gravity subpixels/tick², division truncates to zero.
// Tick order: commands, gravity/velocity, swept terrain X/Y, hazards by ID,
// pickups by ID, checkpoint while alive. First terminal stops further work.
// Edge contact grounds terrain; hazards/pickups need strict overlap. End ticks
// are exclusive. Rebase local coordinates; counters and money use checked u64.
// MOVE offsets airborne horizontal speed by -1/0/+1 air-control units. A grounded
// Jump sets vy, then gravity applies before integration. Ease automatic speed
// only while grounded, retain it in air; add control/dash and clamp velocities.
// Geometry caps do not replace the generator's required base-route proof.
export const RULES_V1 = {
  schemaVersion: 1,
  rulesVersion: 1,
  ticksPerSecond: 60,
  checkpointTicks: 600,
  designatedCoins: 5,
  qualificationCoins: 3,
  initialMultiplierBps: [11_000, 12_500, 15_000, 19_000, 24_000, 30_000],
  multiplierStepBps: 5_000,
  maxMultiplierBps: 100_000,
  speedStepBps: 1_200,
  maxSpeedBps: 18_000,
  powerDurationTicks: 180,
  shieldContactTicks: 18,
  heartbeatGraceTicks: 300,
  activationTimeoutSeconds: 300,
  suspensionTimeoutSeconds: 300,
  paidDrawTimeoutSeconds: 300,
  crankIntervalMs: 100,
  maxTicksPerCrank: 6,
  maxQueuedIntents: 32,
  maxControlUpdatesPerSecond: 20,
  maxPredictionTicks: 15,
  maxLocalIntents: 128,
  maxWorldEntities: 64,
  maxRecentObservations: 16,
  physics: {
    subpixelsPerPixel: 256,
    viewportWidthPixels: 960,
    viewportHeightPixels: 540,
    coordinateLimitSubpixels: 16_777_216,
    maxVelocitySubpixelsPerTick: 4_096,
    runnerSpeedSubpixelsPerTick: 1_024,
    speedEasingSubpixelsPerTick: 4,
    jumpVelocitySubpixelsPerTick: -3_072,
    gravitySubpixelsPerTickSquared: 128,
    airControlSubpixelsPerTick: 256,
    dashBonusSubpixelsPerTick: 2_048,
    dashDurationTicks: 12,
    dashCooldownTicks: 60,
    pickupRadiusSubpixels: 4_096,
    hitboxWidthSubpixels: 6_144,
    hitboxHeightSubpixels: 7_168,
    maxRequiredGapSubpixels: 24_576,
    maxRequiredRiseSubpixels: 12_288,
    minLandingWidthSubpixels: 8_192,
    minRequiredCoinSpacingTicks: 90,
  },
  generation: {
    segmentWidthSubpixels: 32_768,
    lookaheadSegments: 8,
    flatBandBps: 5,
    sharpMoveBps: 100,
    maxSampleChangeBps: 1_000,
    designatedCoinTicks: [90, 180, 270, 360, 450],
    maxHazardsPerSegment: 1,
    maxOptionalPickupsPerSegment: 1,
    boosterStrideSegments: 16,
  },
  score: { coinPoints: 1, starPoints: 5 },
} as const;

export function priceChangeBps(
  previousPrice: bigint,
  previousExponent: number,
  nextPrice: bigint,
  nextExponent: number,
): number {
  const i64Max = (1n << 63n) - 1n;
  if (
    previousPrice <= 0n ||
    nextPrice <= 0n ||
    previousPrice > i64Max ||
    nextPrice > i64Max ||
    !Number.isInteger(previousExponent) ||
    previousExponent < -18 ||
    previousExponent > 18 ||
    previousExponent !== nextExponent
  ) {
    throw new RangeError(
      "Positive same-exponent i64 observations are required",
    );
  }
  const delta = ((nextPrice - previousPrice) * 10_000n) / previousPrice;
  const bound = BigInt(RULES_V1.generation.maxSampleChangeBps);
  return Number(delta < -bound ? -bound : delta > bound ? bound : delta);
}

export function terrainStepSubpixels(changeBps: number): number {
  if (
    !Number.isInteger(changeBps) ||
    changeBps < -0x8000_0000 ||
    changeBps > 0x7fff_ffff
  )
    throw new RangeError("An i32 price change is required");
  const rules = RULES_V1.generation;
  const change = Math.max(
    -rules.maxSampleChangeBps,
    Math.min(rules.maxSampleChangeBps, changeBps),
  );
  if (Math.abs(change) <= rules.flatBandBps) return 0;
  return Math.trunc(
    (-change * RULES_V1.physics.maxRequiredRiseSubpixels) /
      rules.maxSampleChangeBps,
  );
}

export type GameRulesV1 = typeof RULES_V1;

export const U64_MAX = (1n << 64n) - 1n;

export function checkedU64(value: bigint): bigint {
  if (value < 0n || value > U64_MAX) {
    throw new RangeError("Value is outside the u64 range");
  }
  return value;
}

export function runLevel(activeTicks: bigint): bigint {
  return checkedU64(activeTicks) / BigInt(RULES_V1.checkpointTicks) + 1n;
}

export function speedBps(activeTicks: bigint): number {
  const steps = runLevel(activeTicks) - 1n;
  return Math.min(
    10_000 + Number(steps > 7n ? 7n : steps) * RULES_V1.speedStepBps,
    RULES_V1.maxSpeedBps,
  );
}

export function earnedMultiplierBps(qualifiedCheckpoints: bigint): number {
  checkedU64(qualifiedCheckpoints);
  if (qualifiedCheckpoints === 0n) return 0;
  if (qualifiedCheckpoints <= 6n) {
    const bps =
      RULES_V1.initialMultiplierBps[Number(qualifiedCheckpoints - 1n)];
    if (bps === undefined) throw new RangeError("Invalid checkpoint tier");
    return bps;
  }
  const steps = qualifiedCheckpoints - 6n;
  return Math.min(
    30_000 + Number(steps > 14n ? 14n : steps) * RULES_V1.multiplierStepBps,
    RULES_V1.maxMultiplierBps,
  );
}
