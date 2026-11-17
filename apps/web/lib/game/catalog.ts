import { RULES_V1 } from "./rules";

export type CatId = "collector" | "acrobat" | "guardian" | "sprinter";
export type Rarity = "common" | "rare" | "epic";
export type Power = "magnet" | "doubleJump" | "shield" | "extraDash";

type CatDefinition = {
  readonly id: CatId;
  readonly rarity: Rarity;
  readonly weight: number;
  readonly power: Power;
  readonly pickupRadiusBps: number;
  readonly airControlBps: number;
  readonly dashDurationBps: number;
  readonly dashCooldownBps: number;
};

// Stable array order is the Borsh enum order and owned-mask bit order.
export const CATALOG_V1 = {
  schemaVersion: 1,
  catalogVersion: 1,
  cats: [
    {
      id: "collector",
      rarity: "common",
      weight: 3_500,
      power: "magnet",
      pickupRadiusBps: 12_500,
      airControlBps: 10_000,
      dashDurationBps: 10_000,
      dashCooldownBps: 12_500,
    },
    {
      id: "acrobat",
      rarity: "common",
      weight: 3_500,
      power: "doubleJump",
      pickupRadiusBps: 10_000,
      airControlBps: 12_500,
      dashDurationBps: 8_000,
      dashCooldownBps: 10_000,
    },
    {
      id: "guardian",
      rarity: "rare",
      weight: 2_500,
      power: "shield",
      pickupRadiusBps: 10_000,
      airControlBps: 10_000,
      dashDurationBps: 10_000,
      dashCooldownBps: 12_500,
    },
    {
      id: "sprinter",
      rarity: "epic",
      weight: 500,
      power: "extraDash",
      pickupRadiusBps: 7_500,
      airControlBps: 10_000,
      dashDurationBps: 10_000,
      dashCooldownBps: 7_500,
    },
  ] satisfies readonly CatDefinition[],
  upgrades: [
    { rarity: "common", weight: 7_000, levelGain: 1 },
    { rarity: "rare", weight: 2_500, levelGain: 2 },
    { rarity: "epic", weight: 500, levelGain: 3 },
  ],
  starterPriceBaseUnits: 0n,
  catPriceBaseUnits: 2_000_000n,
  upgradePriceBaseUnits: 1_000_000n,
  maxCatLevel: 5,
  powerCooldownTicks: [1_200, 1_080, 960, 840, 720],
  magnetRadiusBps: 20_000,
  powerCharges: 1,
} as const;

export type CatalogV1 = typeof CATALOG_V1;

export type CatStats = {
  readonly power: Power;
  readonly powerCooldownTicks: number;
  readonly pickupRadiusSubpixels: number;
  readonly airControlSubpixelsPerTick: number;
  readonly dashDurationTicks: number;
  readonly dashCooldownTicks: number;
};

export function catStats(catId: CatId, level: number): CatStats {
  if (!Number.isInteger(level) || level < 1 || level > CATALOG_V1.maxCatLevel) {
    throw new RangeError("Cat level must be between 1 and 5");
  }
  const cat = CATALOG_V1.cats.find((entry) => entry.id === catId);
  const cooldown = CATALOG_V1.powerCooldownTicks[level - 1];
  if (cat === undefined || cooldown === undefined) {
    throw new RangeError("Invalid cat or level");
  }
  const physics = RULES_V1.physics;
  return {
    power: cat.power,
    powerCooldownTicks: cooldown,
    pickupRadiusSubpixels: Math.trunc(
      (physics.pickupRadiusSubpixels * cat.pickupRadiusBps) / 10_000,
    ),
    airControlSubpixelsPerTick: Math.trunc(
      (physics.airControlSubpixelsPerTick * cat.airControlBps) / 10_000,
    ),
    dashDurationTicks: Math.trunc(
      (physics.dashDurationTicks * cat.dashDurationBps) / 10_000,
    ),
    dashCooldownTicks: Math.trunc(
      (physics.dashCooldownTicks * cat.dashCooldownBps) / 10_000,
    ),
  };
}

export function eligibleCatWeights(ownedMask: number): {
  readonly weights: readonly number[];
  readonly total: number;
} {
  if (!Number.isInteger(ownedMask) || ownedMask < 0 || ownedMask > 15) {
    throw new RangeError("Owned mask must contain only the four cat bits");
  }
  const weights = CATALOG_V1.cats.map((cat, index) =>
    (ownedMask & (1 << index)) === 0 ? cat.weight : 0,
  );
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total === 0) throw new RangeError("All cats are already owned");
  return { weights, total };
}

export function upgradedLevel(currentLevel: number, grade: Rarity): number {
  if (
    !Number.isInteger(currentLevel) ||
    currentLevel < 1 ||
    currentLevel >= CATALOG_V1.maxCatLevel
  ) {
    throw new RangeError("Only cat levels 1 through 4 can be upgraded");
  }
  const upgrade = CATALOG_V1.upgrades.find((entry) => entry.rarity === grade);
  if (upgrade === undefined) throw new RangeError("Invalid upgrade grade");
  return Math.min(CATALOG_V1.maxCatLevel, currentLevel + upgrade.levelGain);
}
