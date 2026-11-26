import type Phaser from "phaser";
import { drawGates } from "./render-gates";
import { drawWalls, noise } from "./render-walls";
import type { DungeonRoom, Surface } from "./rooms";

// "Catacomb dusk" palette (2026-11-24): dark plum stone that never reaches
// black, warm torchlight and readable walkable edges.
export const DUSK = {
  wall: 0x3d3956,
  wallLit: 0x4b4668,
  mortar: 0x322e48,
  recess: 0x2b2840,
  floor: 0x625c7e,
  floorShade: 0x4e4964,
  // Walkable top plane seen from slightly above, as in a side-view brawler.
  floorTop: 0x7c7598,
  edge: 0x9a93b5,
  lip: 0xc9b79a,
  gate: 0x8f88ad,
  door: 0x6e4a3a,
  iron: 0x2f2b3d,
  ink: 0x1e1626,
  flame: 0xffd36d,
  flameOuter: 0xff8a3d,
  halo: 0xffb547,
  gold: 0xffc531,
  steel: 0xd9dde8,
  danger: 0xe24a4a,
} as const;

// Static room art, drawn once per room. Moving parts are drawn per frame.
export function drawScenery(g: Phaser.GameObjects.Graphics, room: DungeonRoom) {
  g.clear();
  drawWalls(g, room);
  // Lift rails: a dark iron track with bolted end brackets.
  for (const m of room.movers) {
    const left = m.x;
    const right = m.x + m.width + m.span;
    g.fillStyle(0x1b1822);
    g.fillRect(left, m.y + 23, right - left, 5);
    g.fillStyle(0xffffff, 0.1);
    g.fillRect(left, m.y + 23, right - left, 1);
    for (const end of [left, right - 10]) {
      g.fillStyle(0x24212d);
      g.fillRect(end, m.y + 18, 10, 14);
      g.fillStyle(0x8f8aa3, 0.8);
      g.fillCircle(end + 5, m.y + 25, 1.5);
    }
  }
  for (const s of room.surfaces) drawSurface(g, room, s);
  for (const s of room.spikes) {
    g.fillStyle(DUSK.danger);
    g.fillRect(s.x, s.y - 3, s.width, 3);
    g.fillStyle(DUSK.steel);
    for (let x = s.x; x < s.x + s.width; x += 12)
      g.fillTriangle(x, s.y - 3, x + 6, s.y - 18, x + 12, s.y - 3);
  }
  // Crypt spawners: coffins on the floor, roost holes for bats.
  for (const s of room.spawners) {
    if (s.kind === "bat") {
      g.fillStyle(DUSK.recess);
      g.fillEllipse(s.x, s.y - 20, 56, 30);
      continue;
    }
    const ground = room.surfaces[s.surface];
    if (!ground) continue;
    const y =
      ground.y + Math.trunc((ground.rise * (s.x - ground.x)) / ground.width);
    g.fillStyle(DUSK.iron);
    g.fillRect(s.x - 26, y - 14, 52, 14);
    g.fillStyle(DUSK.door);
    g.fillRect(s.x - 22, y - 12, 44, 10);
    g.fillStyle(DUSK.gold);
    g.fillRect(s.x - 2, y - 12, 4, 10);
  }
  drawGates(g, room);
}

// Stone ramps and ledges (2026-11-26): a cut-stone cap seen slightly from
// above (the walkable top plane, then a lit front lip where the feet stand),
// over coursed blocks that follow the slope and darken with depth. Drawn in
// 4 px columns so slopes stay smooth.
const COL = 4;
const COURSE = 24;
const BLOCK = 48;
function drawSurface(
  g: Phaser.GameObjects.Graphics,
  room: DungeonRoom,
  s: Surface,
) {
  const bottom = s.floating ? Math.max(s.y, s.y + s.rise) + 22 : room.height;
  for (let x = 0; x < s.width; x += COL) {
    const top = s.y + (s.rise * (x + COL / 2)) / s.width;
    const wx = s.x + x;
    g.fillStyle(DUSK.floor);
    g.fillRect(wx, top, COL, bottom - top);
    for (let y = top + 10, course = 0; y < bottom; y += COURSE, course++) {
      const h = Math.min(COURSE, bottom - y);
      const shift = (course % 2) * (BLOCK / 2);
      const block = Math.floor((x + shift) / BLOCK);
      // Per-block tone, then a vertical joint at each block's left edge.
      const tone = noise(s.x, course, block);
      g.fillStyle(
        tone > 0.5 ? 0xffffff : 0x000000,
        0.03 + Math.abs(tone - 0.5) * 0.08,
      );
      g.fillRect(wx, y, COL, h);
      g.fillStyle(DUSK.mortar);
      g.fillRect(wx, y, COL, 2);
      if ((x + shift) % BLOCK < COL) g.fillRect(wx, y, 2, h);
      // Deeper courses fall into shadow.
      g.fillStyle(0x0b0912, Math.min(0.45, course * 0.07));
      g.fillRect(wx, y + 2, COL, h - 2);
    }
    // Cap: top plane, lit front lip, then the shadow under the cap.
    g.fillStyle(DUSK.floorTop);
    g.fillRect(wx, top - 8, COL, 8);
    g.fillStyle(0xffffff, 0.08);
    g.fillRect(wx, top - 8, COL, 1.5);
    g.fillStyle(0x857ea3);
    g.fillRect(wx, top, COL, 8);
    g.fillStyle(DUSK.lip, 0.85);
    g.fillRect(wx, top, COL, 1.5);
    g.fillStyle(0x000000, 0.3);
    g.fillRect(wx, top + 8, COL, 2);
  }
  // Slab joints across the cap.
  for (let x = BLOCK; x < s.width; x += BLOCK) {
    const top = s.y + (s.rise * x) / s.width;
    g.fillStyle(DUSK.mortar, 0.8);
    g.fillRect(s.x + x, top - 8, 1.5, 16);
  }
  if (s.floating) {
    g.fillStyle(0x000000, 0.35);
    g.fillRect(s.x, bottom - 3, s.width, 3);
  } else {
    g.fillStyle(DUSK.ink, 0.6);
    g.fillRect(s.x, s.y - 8, 3, bottom - s.y + 8);
    g.fillRect(
      s.x + s.width - 3,
      s.y + s.rise - 8,
      3,
      bottom - s.y - s.rise + 8,
    );
  }
}
