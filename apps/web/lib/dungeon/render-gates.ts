import type Phaser from "phaser";
import type { DungeonRoom } from "./rooms";

// Gates (2026-11-26): a symmetric stone portal on a threshold step. Two
// block pillars carry a round arch of nine voussoirs and a keystone that
// holds the gate number plate. Inside stands a double door of vertical oak
// planks with three iron straps, rivets and two ring pulls. Geometry is in
// world units from the gate's floor point; the trap animation opens this
// same doorway.
export const GATE = {
  // Door opening: half width and the height of the arch's spring line.
  half: 30,
  spring: 92,
  // Outer half width of the portal and the arch's ring thickness.
  frame: 46,
  ring: 14,
  // Centre of the number plate on the keystone, above the floor point.
  plate: 92 + 30 + 9,
} as const;
const STONE = [0x5d5779, 0x544e70, 0x625c80] as const;
const stone = (i: number) => STONE[i % STONE.length] ?? 0x5d5779;
const WOOD = 0x5b3a27;

const at = (cx: number, cy: number, r: number, a: number) => ({
  x: cx + Math.cos(a) * r,
  y: cy + Math.sin(a) * r,
});

type Point = { x: number; y: number };
function quad(
  g: Phaser.GameObjects.Graphics,
  a: Point,
  b: Point,
  c: Point,
  d: Point,
) {
  g.fillTriangle(a.x, a.y, b.x, b.y, c.x, c.y);
  g.fillTriangle(a.x, a.y, c.x, c.y, d.x, d.y);
}
export function drawGates(g: Phaser.GameObjects.Graphics, room: DungeonRoom) {
  for (const gate of room.gates) drawGate(g, gate.x, gate.y);
}

function drawGate(g: Phaser.GameObjects.Graphics, x: number, y: number) {
  const { half, spring, frame, ring } = GATE;
  const top = y - spring;
  // Threshold step.
  g.fillStyle(0x6a6488);
  g.fillRect(x - frame - 8, y - 5, (frame + 8) * 2, 5);
  g.fillStyle(0xffffff, 0.1);
  g.fillRect(x - frame - 8, y - 5, (frame + 8) * 2, 1.5);
  // Pillars: three stacked blocks each side, mirrored.
  for (const side of [-1, 1]) {
    const left = side < 0 ? x - frame : x + half;
    const width = frame - half;
    for (let i = 0; i < 3; i++) {
      const h = (spring - 5) / 3;
      const by = y - 5 - h * (i + 1);
      g.fillStyle(stone(i));
      g.fillRect(left, by + 1, width, h - 2);
      g.fillStyle(0xffffff, 0.09);
      g.fillRect(left, by + 1, width, 2);
      g.fillStyle(0x000000, 0.22);
      g.fillRect(left, by + h - 4, width, 3);
    }
    // Inner reveal in shadow.
    g.fillStyle(0x000000, 0.3);
    g.fillRect(side < 0 ? x - half - 3 : x + half, top, 3, spring - 5);
  }
  // Doorway recess behind the door.
  g.fillStyle(0x110e18);
  g.fillRect(x - half, top, half * 2, spring);
  g.fillCircle(x, top, half);
  // Arch: nine voussoirs from left to right, the middle one the keystone.
  const steps = 9;
  for (let i = 0; i < steps; i++) {
    const a0 = Math.PI + (Math.PI * i) / steps + 0.012;
    const a1 = Math.PI + (Math.PI * (i + 1)) / steps - 0.012;
    const key = i === 4;
    const outer = half + ring + (key ? 7 : 0);
    g.fillStyle(key ? 0x6e6892 : stone(i % 2));
    quad(
      g,
      at(x, top, half, a0),
      at(x, top, outer, a0),
      at(x, top, outer, a1),
      at(x, top, half, a1),
    );
    g.fillStyle(0xffffff, 0.08);
    quad(
      g,
      at(x, top, outer - 2, a0),
      at(x, top, outer, a0),
      at(x, top, outer, a1),
      at(x, top, outer - 2, a1),
    );
  }
  // Number plate on the keystone (the number is a text object over it).
  g.fillStyle(0x1b1822);
  g.fillRoundedRect(x - 10, y - GATE.plate - 9, 20, 18, 3);
  g.lineStyle(1.5, 0xc9973f, 1);
  g.strokeRoundedRect(x - 10, y - GATE.plate - 9, 20, 18, 3);
  drawDoor(g, x, y);
}

function drawDoor(g: Phaser.GameObjects.Graphics, x: number, y: number) {
  const w = GATE.half - 3;
  const top = y - GATE.spring;
  // Oak leaves filling the opening and its arch.
  g.fillStyle(WOOD);
  g.fillRect(x - w, top, w * 2, GATE.spring - 5);
  g.fillCircle(x, top, w);
  // Planks: dark joints every 9 px, a lit edge on each plank.
  for (let px = x - w + 9; px < x + w - 2; px += 9) {
    const rise = Math.sqrt(Math.max(0, w * w - (px - x) ** 2));
    g.fillStyle(0x3b2418);
    g.fillRect(px - 1, top - rise + 1, 2, GATE.spring - 5 + rise - 1);
    g.fillStyle(0x7a5236, 0.6);
    g.fillRect(px + 1, top - rise + 2, 1, GATE.spring - 6 + rise - 2);
  }
  // Centre seam between the leaves.
  g.fillStyle(0x1e120c);
  g.fillRect(x - 1.5, top - w + 1, 3, GATE.spring - 5 + w - 1);
  // Iron straps with rivets.
  for (const sy of [top + 6, top + 36, top + 66]) {
    g.fillStyle(0x24212d);
    g.fillRect(x - w, sy, w * 2, 6);
    g.fillStyle(0xffffff, 0.12);
    g.fillRect(x - w, sy, w * 2, 1);
    g.fillStyle(0x9a94ad);
    for (let rx = x - w + 4; rx <= x + w - 4; rx += 9)
      g.fillCircle(rx, sy + 3, 1.3);
  }
  // Ring pulls, one on each leaf.
  g.lineStyle(2, 0x8a7442, 1);
  for (const side of [-1, 1]) {
    g.fillStyle(0x24212d);
    g.fillCircle(x + side * 7, top + 49, 2.5);
    g.strokeCircle(x + side * 7, top + 55, 4.5);
  }
}
