import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseAssetManifest } from "../../apps/web/lib/game/assets.ts";
import { catPortrait } from "./cat-portrait.mjs";
import { CAT_CLIPS, catFrame, catPose } from "./cat-sprite.mjs";
import {
  ACTION_CLIPS,
  actionEffect,
  capsuleBase,
  capsuleLid,
  HUD_ORDER,
  hudIcon,
  POWER_CLIPS,
  powerEffect,
  upgradeItem,
} from "./fx-art.mjs";
import { svgDocument } from "./pixel-grid.mjs";
import * as scene from "./scene-art.mjs";

// Version 2 pixel-art set (2026-11-22). Every file is generated here; run with
// --check to confirm the committed SVGs and manifest match this source.
const VERSION = 2;
const directory = fileURLToPath(
  new URL(`../../apps/web/public/game-assets/v${VERSION}/`, import.meta.url),
);
const check = process.argv.includes("--check");
if (!check) mkdirSync(directory, { recursive: true });
function output(file, bytes) {
  const target = `${directory}${file}`;
  if (check) {
    if (readFileSync(target, "utf8") !== bytes)
      throw new Error(`Stale artwork: ${file}`);
  } else writeFileSync(target, bytes);
}

const shift = (x, content) => `<g transform="translate(${x} 0)">${content}</g>`;
const clip = (name, count, fps, loop = false) => ({ name, count, fps, loop });
const assets = [];
function sheet(id, w, h, render, options = {}) {
  const { clips = [], anchor = { x: 0, y: 0 }, repeat = "none" } = options;
  let frames = 0;
  const content =
    clips.length === 0
      ? render("", 0)
      : clips
          .map((entry) => {
            entry.start = frames;
            return Array.from({ length: entry.count }, (_, i) =>
              shift(w * frames++, render(entry.name, i)),
            ).join("");
          })
          .join("");
  frames = Math.max(1, frames);
  const svg = svgDocument(w * frames, h, content);
  output(`${id}.svg`, svg);
  assets.push({
    id,
    path: `/game-assets/v${VERSION}/${id}.svg`,
    sha256: createHash("sha256").update(svg).digest("hex"),
    bytes: Buffer.byteLength(svg),
    width: w * frames,
    height: h,
    frameWidth: w,
    frameHeight: h,
    frames,
    anchor,
    repeat,
    reducedMotionFrame: 0,
    clips: [...clips].sort((a, b) => a.name.localeCompare(b.name)),
  });
}
const still = (id, w, h, svg, options) => sheet(id, w, h, () => svg, options);

for (const id of ["acrobat", "collector", "guardian", "sprinter"]) {
  sheet(`cat-${id}`, 48, 48, (name, i) => catFrame(id, catPose(name, i)), {
    anchor: { x: 24, y: 40 },
    clips: CAT_CLIPS.map(([name, count, fps, loop]) =>
      clip(name, count, fps, loop),
    ),
  });
  still(`portrait-${id}`, 96, 96, catPortrait(id));
}
sheet("coin-spin", 32, 32, (_, i) => scene.coin(i), {
  clips: [clip("spin", 16, 16, true)],
  anchor: { x: 16, y: 28 },
});
still("coin-shadow", 16, 6, scene.coinShadow(), { anchor: { x: 8, y: 3 } });
sheet("star", 24, 24, (_, i) => scene.star(i), {
  clips: [clip("twinkle", 4, 6, true)],
  anchor: { x: 12, y: 12 },
});
for (const power of ["double-jump", "extra-dash", "magnet", "shield"])
  still(`booster-${power}`, 24, 24, scene.booster(power), {
    anchor: { x: 12, y: 12 },
  });
// The anchor is the bottom centre of the 20 px spike collider.
still("hazard-obstacle", 32, 32, scene.hazard(), { anchor: { x: 16, y: 30 } });
still("hazard-pit-edge", 32, 32, scene.pitEdge());
still("terrain-fill", 32, 32, scene.terrainFill(), { repeat: "xy" });
still("terrain-grass", 32, 16, scene.terrainGrass(), { repeat: "x" });
still("terrain-left", 32, 32, scene.terrainEdge("left"));
still("terrain-right", 32, 32, scene.terrainEdge("right"));
still("terrain-underside", 32, 32, scene.terrainUnderside(), { repeat: "x" });
still("bridge-deck", 32, 16, scene.bridgeDeck(), { repeat: "x" });
for (const [name, x] of [
  ["left", 2],
  ["right", 10],
  ["support", 6],
])
  still(`bridge-${name}`, 32, 32, scene.bridgePost(x));
still("water-fill", 32, 32, scene.waterFill(), { repeat: "xy" });
sheet("water-surface", 32, 32, (_, i) => scene.waterSurface(i), {
  clips: [clip("wave", 4, 6, true)],
  repeat: "x",
});
sheet("hud-controls", 24, 24, (name) => hudIcon(name), {
  clips: HUD_ORDER.map((name) => clip(name, 1, 1)),
});
sheet("effects-actions", 32, 32, actionEffect, {
  clips: ACTION_CLIPS.map((name) => clip(name, 6, 18)),
  anchor: { x: 16, y: 16 },
});
sheet("effects-powers", 64, 64, powerEffect, {
  clips: POWER_CLIPS.map((name) =>
    clip(name, 6, 12, name !== "shield-contact"),
  ),
  anchor: { x: 32, y: 32 },
});
still("background-sky", 960, 540, scene.sky(), { repeat: "x" });
still("background-forest-far", 960, 540, scene.farHills(), { repeat: "x" });
still("background-forest-near", 960, 540, scene.nearForest(), {
  repeat: "x",
});
still("capsule-lid", 160, 160, capsuleLid());
still("capsule-base", 160, 160, capsuleBase());
still("upgrade-item", 32, 32, upgradeItem());

assets.sort((a, b) => a.id.localeCompare(b.id));
const manifest = parseAssetManifest({
  schemaVersion: 1,
  version: VERSION,
  assets,
});
output("manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
