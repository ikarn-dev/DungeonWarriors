import type { CatId } from "./catalog";

// Painted avatars (1254 × 1254 PNG, transparent) used for every warrior
// portrait in the UI (2026-11-24). Kept out of lib/dungeon/warriors.ts, whose
// source is hashed into the onchain engine binding.
const FILES: Readonly<Record<CatId, string>> = {
  collector: "pip-spearpaw",
  acrobat: "rosie-bladewhisk",
  guardian: "sir-bastion",
  sprinter: "bjorn-ironclaw",
};

export function warriorAvatar(cat: CatId): string {
  return `/cats_avatars/${FILES[cat]}.png`;
}
