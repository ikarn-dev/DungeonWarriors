import type { AssetManifest } from "./assets";
import type { CatId } from "./catalog";

// Artwork a run loads from the published manifest: parallax layers (with
// their scroll factors), still images and animated sheets.
export const layers = [
  ["background-sky", 0.05],
  ["background-forest-far", 0.2],
  ["background-forest-near", 0.4],
] as const;
const stills = [
  "background-sky",
  "background-forest-far",
  "background-forest-near",
  "coin-shadow",
  "hazard-obstacle",
  "terrain-fill",
  "terrain-grass",
  "booster-magnet",
  "booster-shield",
  "booster-double-jump",
  "booster-extra-dash",
] as const;
const sheets = [
  "coin-spin",
  "star",
  "effects-actions",
  "effects-powers",
  "water-surface",
] as const;
export const boosters = {
  magnet: "booster-magnet",
  shield: "booster-shield",
  doubleJump: "booster-double-jump",
  extraDash: "booster-extra-dash",
} as const;
export const auras = [
  ["magnet", "magnet"],
  ["doubleJump", "double-jump"],
  ["extraDash", "extra-dash"],
  ["shield", "shield-active"],
] as const;

export function runImages(manifest: AssetManifest, cat: CatId) {
  const wanted = new Set<string>([`cat-${cat}`, ...sheets, ...stills]);
  return manifest.assets.filter(({ id }) => wanted.has(id));
}
