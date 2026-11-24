import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseAssetManifest } from "../../apps/web/lib/game/assets.ts";
import { ENEMIES, ENEMY_TOP } from "./enemy-art.mjs";
import {
  CATS,
  catBody,
  catPortrait,
  HAND,
  WEAPON_PIVOT,
  weapon,
} from "./warrior-art.mjs";

// Version 3 smooth vector set (2026-11-24): warrior cats, their weapons and
// catacomb foes. Run with --check to confirm the committed files match.
const VERSION = 3;
const directory = fileURLToPath(
  new URL(`../../apps/web/public/game-assets/v${VERSION}/`, import.meta.url),
);
const check = process.argv.includes("--check");
if (!check) mkdirSync(directory, { recursive: true });
const assets = [];
const images = {};
function emit(id, size, content, anchor) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${content}</svg>\n`;
  const target = `${directory}${id}.svg`;
  if (check) {
    if (readFileSync(target, "utf8") !== svg)
      throw new Error(`Stale artwork: ${id}`);
  } else writeFileSync(target, svg);
  if (!id.startsWith("warrior-")) images[id] = svg;
  assets.push({
    id,
    path: `/game-assets/v${VERSION}/${id}.svg`,
    sha256: createHash("sha256").update(svg).digest("hex"),
    bytes: Buffer.byteLength(svg),
    width: size,
    height: size,
    frameWidth: size,
    frameHeight: size,
    frames: 1,
    anchor,
    repeat: "none",
    reducedMotionFrame: 0,
    clips: [],
  });
}
for (const id of Object.keys(CATS)) {
  emit(`body-${id}`, 128, catBody(id), { x: 61, y: 120 });
  emit(`warrior-${id}`, 128, catPortrait(id), { x: 61, y: 120 });
}
for (const [kind, pivot] of Object.entries(WEAPON_PIVOT))
  emit(`weapon-${kind}`, 96, weapon(kind), pivot);
for (const [kind, draw] of Object.entries(ENEMIES))
  emit(`enemy-${kind}`, 128, draw(), { x: 64, y: kind === "bat" ? 90 : 120 });
assets.sort((a, b) => a.id.localeCompare(b.id));
const manifest = parseAssetManifest({
  schemaVersion: 1,
  version: VERSION,
  assets,
});
const bytes = `${JSON.stringify(manifest, null, 2)}\n`;
if (check) {
  if (readFileSync(`${directory}manifest.json`, "utf8") !== bytes)
    throw new Error("Stale artwork: manifest.json");
} else writeFileSync(`${directory}manifest.json`, bytes);
// Ship essential gameplay art in the same release as the renderer. Browser
// caches cannot mix an old standalone SVG with a newer manifest.
const bundle = fileURLToPath(
  new URL("../../apps/web/lib/dungeon/artwork-data.json", import.meta.url),
);
const bundled = `${JSON.stringify({ manifest, images }, null, 2)}\n`;
if (check) {
  if (readFileSync(bundle, "utf8") !== bundled)
    throw new Error("Stale bundled dungeon artwork");
} else writeFileSync(bundle, bundled);
// Layout values the renderer needs, printed for review.
if (!check)
  process.stdout.write(
    `${JSON.stringify({ hand: HAND, enemyTop: ENEMY_TOP })}\n`,
  );
