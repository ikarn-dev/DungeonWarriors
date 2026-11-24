import type Phaser from "phaser";
import type { DungeonRoom } from "./rooms";

// "Catacomb dusk" palette (2026-11-24): dark plum stone that never reaches
// black, warm torchlight and readable walkable edges.
export const DUSK = {
  wall: 0x3d3956,
  wallLit: 0x4b4668,
  mortar: 0x322e48,
  recess: 0x2b2840,
  floor: 0x625c7e,
  floorShade: 0x4e4964,
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
  gas: 0x8fe36a,
} as const;

// Static room art, drawn once per room. Moving parts are drawn per frame.
export function drawScenery(g: Phaser.GameObjects.Graphics, room: DungeonRoom) {
  g.clear();
  g.fillStyle(DUSK.mortar);
  g.fillRect(0, 0, room.width, room.height);
  for (let row = 0; row < Math.ceil(room.height / 32); row++)
    for (let col = -1; col < Math.ceil(room.width / 64) + 1; col++) {
      const x = col * 64 + (row % 2) * 32;
      const y = row * 32;
      g.fillStyle((row * 7 + col * 3) % 5 === 0 ? DUSK.wallLit : DUSK.wall);
      g.fillRect(x + 2, y + 2, 60, 28);
      g.fillStyle(DUSK.wallLit, 0.7);
      g.fillRect(x + 2, y + 2, 60, 2);
    }
  for (let x = 120; x < room.width - 200; x += 320) {
    g.fillStyle(DUSK.recess);
    g.fillRect(x, 150, 96, 190);
    g.fillCircle(x + 48, 150, 48);
    g.fillStyle(DUSK.floor);
    g.fillRect(x - 8, 336, 112, 10);
    const tx = x + 200;
    g.fillStyle(DUSK.halo, 0.08);
    g.fillCircle(tx, 190, 56);
    g.fillStyle(DUSK.halo, 0.12);
    g.fillCircle(tx, 190, 32);
    g.fillStyle(DUSK.door);
    g.fillRect(tx - 4, 200, 8, 38);
    g.fillStyle(DUSK.flameOuter);
    g.fillEllipse(tx, 186, 16, 24);
    g.fillStyle(DUSK.flame);
    g.fillEllipse(tx, 188, 8, 16);
  }
  for (const m of room.movers) {
    g.fillStyle(DUSK.iron);
    g.fillRect(m.x, m.y + 24, m.width + m.span, 4);
    g.fillStyle(DUSK.gold);
    g.fillCircle(m.x + 4, m.y + 26, 4);
    g.fillCircle(m.x + m.width + m.span - 4, m.y + 26, 4);
  }
  for (const s of room.surfaces) {
    const bottom = s.floating ? Math.max(s.y, s.y + s.rise) + 22 : room.height;
    for (let x = 0; x < s.width; x += 8) {
      const top = Math.round(s.y + (s.rise * (x + 4)) / s.width);
      g.fillStyle(DUSK.floor);
      g.fillRect(s.x + x, top, 8, bottom - top);
      for (let y = top + 14; y < bottom; y += 22) {
        g.fillStyle(
          (Math.floor(x / 32) + Math.floor(y / 22)) % 2
            ? DUSK.floorShade
            : DUSK.mortar,
        );
        g.fillRect(s.x + x, y, 8, 3);
      }
      g.fillStyle(DUSK.edge);
      g.fillRect(s.x + x, top, 8, 6);
      g.fillStyle(DUSK.lip);
      g.fillRect(s.x + x, top, 8, 2);
    }
    if (!s.floating) {
      g.fillStyle(DUSK.ink, 0.6);
      g.fillRect(s.x, s.y, 3, bottom - s.y);
      g.fillRect(s.x + s.width - 3, s.y + s.rise, 3, bottom - s.y - s.rise);
    }
  }
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
  for (const gate of room.gates) {
    const x = gate.x;
    const y = gate.y;
    g.fillStyle(DUSK.ink);
    g.fillRect(x - 34, y - 92, 68, 92);
    g.fillCircle(x, y - 92, 34);
    g.fillStyle(DUSK.gate);
    g.fillRect(x - 30, y - 90, 60, 90);
    g.fillCircle(x, y - 90, 30);
    g.fillStyle(DUSK.door);
    g.fillRect(x - 22, y - 84, 44, 84);
    g.fillCircle(x, y - 84, 22);
    g.fillStyle(DUSK.iron);
    for (const dx of [-14, -2, 10]) g.fillRect(x + dx, y - 100, 4, 100);
    g.fillRect(x - 22, y - 54, 44, 4);
    g.fillStyle(DUSK.gold);
    g.fillRect(x - 4, y - 126, 8, 8);
  }
}
