import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CATALOG_V1,
  catStats,
  eligibleCatWeights,
  upgradedLevel,
} from "../../../../../apps/web/lib/game/catalog";
import {
  grossPayout,
  maxGrossReservation,
  requiredVaultBalance,
} from "../../../../../apps/web/lib/game/economy";
import {
  earnedMultiplierBps,
  priceChangeBps,
  RULES_V1,
  runLevel,
  speedBps,
  terrainStepSubpixels,
  U64_MAX,
} from "../../../../../apps/web/lib/game/rules";

function fixtureRows(name: string): string[][] {
  return readFileSync(
    new URL(`../../../../fixtures/game-v1/${name}.csv`, import.meta.url),
    "utf8",
  )
    .trim()
    .split("\n")
    .slice(1)
    .map((line) => line.split(","));
}

describe("v1 Rust/predictor numeric contracts", () => {
  it("matches Rust price mapping without floats or exponent substitution", () => {
    for (const row of fixtureRows("price-deltas")) {
      const [previous, previousExponent, next, nextExponent, delta, step] = row;
      if (previous === undefined || next === undefined)
        throw new Error("Invalid price fixture");
      const bps = priceChangeBps(
        BigInt(previous),
        Number(previousExponent),
        BigInt(next),
        Number(nextExponent),
      );
      expect(bps).toBe(Number(delta));
      expect(terrainStepSubpixels(bps)).toBe(Number(step));
    }
    expect(() => priceChangeBps(0n, -8, 1n, -8)).toThrow(RangeError);
    expect(() => priceChangeBps(1n, -8, -1n, -8)).toThrow(RangeError);
    expect(() => priceChangeBps(1n, -8, 1n, -9)).toThrow(RangeError);
    expect(() => priceChangeBps(1n, -19, 1n, -19)).toThrow(RangeError);
    expect(() => priceChangeBps(1n << 63n, 0, 1n, 0)).toThrow(RangeError);
    expect(() => terrainStepSubpixels(Number.NaN)).toThrow(RangeError);
    expect(terrainStepSubpixels(-0x8000_0000)).toBe(
      RULES_V1.physics.maxRequiredRiseSubpixels,
    );
    expect(terrainStepSubpixels(0x7fff_ffff)).toBe(
      -RULES_V1.physics.maxRequiredRiseSubpixels,
    );
  });

  it("matches the complete generation and arcade-score contract", () => {
    const row = fixtureRows("generation")[0];
    if (row === undefined) throw new Error("Missing generation fixture");
    const g = RULES_V1.generation;
    expect([
      g.segmentWidthSubpixels,
      g.lookaheadSegments,
      g.flatBandBps,
      g.sharpMoveBps,
      g.maxSampleChangeBps,
      ...g.designatedCoinTicks,
      g.maxHazardsPerSegment,
      g.maxOptionalPickupsPerSegment,
      g.boosterStrideSegments,
      RULES_V1.score.coinPoints,
      RULES_V1.score.starPoints,
    ]).toEqual(row.map(Number));
  });

  it("uses the same signed subpixel geometry and bounds as Rust", () => {
    const row = fixtureRows("physics")[0];
    if (row === undefined) throw new Error("Missing physics fixture");
    expect(Object.values(RULES_V1.physics)).toEqual(row.map(Number));
  });

  it("advances levels after missed checkpoints and continues beyond the payout cap", () => {
    for (const row of fixtureRows("progression")) {
      const [ticks, qualified, level, speed, multiplier] = row;
      if (ticks === undefined || qualified === undefined || level === undefined)
        throw new Error("Invalid progression fixture");
      expect(runLevel(BigInt(ticks))).toBe(BigInt(level));
      expect(speedBps(BigInt(ticks))).toBe(Number(speed));
      expect(earnedMultiplierBps(BigInt(qualified))).toBe(Number(multiplier));
    }
    expect(() => runLevel(-1n)).toThrow(RangeError);
    expect(() => runLevel(U64_MAX + 1n)).toThrow(RangeError);
    expect(() => earnedMultiplierBps(-1n)).toThrow(RangeError);
  });

  it("uses exact base units, floors payouts and reserves the full gross obligation", () => {
    for (const row of fixtureRows("payouts")) {
      const [stake, qualified, gross, reserved] = row;
      if (
        stake === undefined ||
        qualified === undefined ||
        gross === undefined ||
        reserved === undefined
      )
        throw new Error("Invalid payout fixture");
      expect(grossPayout(BigInt(stake), BigInt(qualified))).toBe(BigInt(gross));
      expect(maxGrossReservation(BigInt(stake))).toBe(BigInt(reserved));
    }
    expect(() => grossPayout(1n, 0n)).toThrow(RangeError);
    expect(() => maxGrossReservation(0n)).toThrow(RangeError);
    expect(() => maxGrossReservation(-1n)).toThrow(RangeError);
    expect(() => maxGrossReservation(U64_MAX / 10n + 1n)).toThrow(RangeError);
    expect(
      requiredVaultBalance(5_000_000n, 2_000_000n, 10_000_000n, 1_000_000n),
    ).toBe(18_000_000n);
    expect(() => requiredVaultBalance(U64_MAX, 1n, 0n, 0n)).toThrow(RangeError);
    expect(() => requiredVaultBalance(-1n, 1n, 0n, 0n)).toThrow(RangeError);
  });

  it("derives all twenty cat/level snapshots from the canonical catalog", () => {
    const rows = fixtureRows("cats");
    expect(rows).toHaveLength(20);
    const rarities = ["common", "rare", "epic"];
    const powers = ["magnet", "doubleJump", "shield", "extraDash"];
    for (const row of rows) {
      const [
        index,
        level,
        rarity,
        weight,
        power,
        cooldown,
        pickup,
        air,
        dashDuration,
        dashCooldown,
      ] = row.map(Number);
      if (
        index === undefined ||
        level === undefined ||
        rarity === undefined ||
        power === undefined
      )
        throw new Error("Invalid cat fixture");
      const cat = CATALOG_V1.cats[index];
      if (cat === undefined) throw new Error("Invalid fixture cat");
      expect(cat.rarity).toBe(rarities[rarity]);
      expect(cat.weight).toBe(weight);
      expect(catStats(cat.id, level)).toEqual({
        power: powers[power],
        powerCooldownTicks: cooldown,
        pickupRadiusSubpixels: pickup,
        airControlSubpixelsPerTick: air,
        dashDurationTicks: dashDuration,
        dashCooldownTicks: dashCooldown,
      });
    }
    for (const level of [0, 6, 1.5, Number.NaN]) {
      expect(() => catStats("collector", level)).toThrow(RangeError);
    }
  });

  it("shows the actual remaining weight/total and rejects a full collection", () => {
    for (let mask = 0; mask < 15; mask++) {
      const pool = eligibleCatWeights(mask);
      expect(pool.total).toBe(
        pool.weights.reduce((sum, weight) => sum + weight, 0),
      );
      pool.weights.forEach((weight, index) => {
        expect(weight).toBe(
          (mask & (1 << index)) === 0 ? CATALOG_V1.cats[index]?.weight : 0,
        );
      });
    }
    expect(eligibleCatWeights(1)).toEqual({
      weights: [0, 3_500, 2_500, 500],
      total: 6_500,
    });
    for (const mask of [-1, 1.5, 15, 16, 2 ** 32, Number.NaN]) {
      expect(() => eligibleCatWeights(mask)).toThrow(RangeError);
    }
  });

  it("clips upgrade gains and preserves the published economic and power rules", () => {
    expect(upgradedLevel(1, "common")).toBe(2);
    expect(upgradedLevel(1, "rare")).toBe(3);
    expect(upgradedLevel(1, "epic")).toBe(4);
    expect(upgradedLevel(4, "epic")).toBe(5);
    for (const level of [0, 5, 1.5, Number.NaN]) {
      expect(() => upgradedLevel(level, "common")).toThrow(RangeError);
    }
    expect(CATALOG_V1.upgrades.map((grade) => grade.weight)).toEqual([
      7_000, 2_500, 500,
    ]);
    expect(CATALOG_V1.starterPriceBaseUnits).toBe(0n);
    expect(CATALOG_V1.catPriceBaseUnits).toBe(2_000_000n);
    expect(CATALOG_V1.upgradePriceBaseUnits).toBe(1_000_000n);
    expect(CATALOG_V1.magnetRadiusBps).toBe(20_000);
    expect(CATALOG_V1.powerCharges).toBe(1);
    expect(RULES_V1.checkpointTicks).toBe(600);
    expect([RULES_V1.qualificationCoins, RULES_V1.designatedCoins]).toEqual([
      3, 5,
    ]);
  });
});
