import type { CatId } from "../game/catalog";

export type Weapon = "spear" | "longsword" | "sword" | "axe";
export type TraitId =
  | "timePouch"
  | "longReach"
  | "steadyShield"
  | "doubleJump"
  | "swiftBlade"
  | "pounce"
  | "gasMask"
  | "ironShell"
  | "shieldBash"
  | "quickPaws"
  | "cleave"
  | "berserk";
export type Trait = {
  readonly id: TraitId;
  readonly name: string;
  readonly description: string;
};
export type Warrior = {
  readonly name: string;
  readonly title: string;
  readonly weapon: Weapon;
  readonly hp: number;
  readonly atk: number;
  readonly def: number;
  // Reach of the attack in front of the body, px.
  readonly reach: number;
  readonly cooldownTicks: number;
  readonly traits: readonly [Trait, Trait, Trait];
};

// The catalog type IDs stay the onchain identity; names and fighting styles
// are presentation and engine values (engine v2, 2026-11-24).
export const WARRIORS: Readonly<Record<CatId, Warrior>> = {
  collector: {
    name: "Pip Spearpaw",
    title: "Spear scout",
    weapon: "spear",
    hp: 110,
    atk: 14,
    def: 5,
    reach: 46,
    cooldownTicks: 22,
    traits: [
      {
        id: "timePouch",
        name: "Time Pouch",
        description: "3 extra seconds in every room",
      },
      {
        id: "longReach",
        name: "Long Reach",
        description: "Spear strikes from further away",
      },
      {
        id: "steadyShield",
        name: "Steady Shield",
        description: "Blocks the first hit in each room",
      },
    ],
  },
  acrobat: {
    name: "Rosie Bladewhisk",
    title: "Duelist",
    weapon: "longsword",
    hp: 90,
    atk: 15,
    def: 3,
    reach: 38,
    cooldownTicks: 16,
    traits: [
      {
        id: "doubleJump",
        name: "Double Jump",
        description: "Jump again in mid-air",
      },
      {
        id: "swiftBlade",
        name: "Swift Blade",
        description: "Swings faster than any other cat",
      },
      {
        id: "pounce",
        name: "Pounce",
        description: "Landing on a foe deals double damage",
      },
    ],
  },
  guardian: {
    name: "Sir Bastion",
    title: "Shield knight",
    weapon: "sword",
    hp: 140,
    atk: 13,
    def: 8,
    reach: 36,
    cooldownTicks: 24,
    traits: [
      {
        id: "gasMask",
        name: "Gas Mask",
        description: "5 seconds of grace after the gas arrives",
      },
      {
        id: "ironShell",
        name: "Iron Shell",
        description: "Heavy armour shrugs off damage",
      },
      {
        id: "shieldBash",
        name: "Shield Bash",
        description: "Hits knock foes far back",
      },
    ],
  },
  sprinter: {
    name: "Bjorn Ironclaw",
    title: "Berserker",
    weapon: "axe",
    hp: 110,
    atk: 18,
    def: 5,
    reach: 40,
    cooldownTicks: 22,
    traits: [
      {
        id: "quickPaws",
        name: "Quick Paws",
        description: "Runs 10% faster",
      },
      {
        id: "cleave",
        name: "Cleave",
        description: "Each swing hits every foe in reach",
      },
      {
        id: "berserk",
        name: "Berserk",
        description: "50% more damage below 30% health",
      },
    ],
  },
};
export function hasTrait(cat: CatId, trait: TraitId): boolean {
  return WARRIORS[cat].traits.some((t) => t.id === trait);
}
export const WARRIOR_ART = "/game-assets/v3";
export const warriorPortrait = (cat: CatId) =>
  `${WARRIOR_ART}/warrior-${cat}.svg`;
