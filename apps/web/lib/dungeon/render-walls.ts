import type Phaser from "phaser";
import type { DungeonRoom } from "./rooms";

// Catacomb walls (2026-11-26): irregular cut stone in a few close tones, each
// block bevelled with a lit top edge and a shadowed foot, with chips, cracks
// and damp streaks, darkening toward the vault. Deterministic per room, so a
// room always looks the same; drawn once with the rest of the static art.
const STONES = [0x3a3651, 0x3f3a57, 0x433e5c, 0x37334c, 0x48425f, 0x3c3854];
const MORTAR = 0x24212f;
export const BRICK_ROW = 32;
// Torch brackets sit between the alcoves; the flame base is at TORCH_Y.
export const TORCH_Y = 204;

// A stable value in [0, 1) for integer inputs.
export function noise(a: number, b: number, c = 0): number {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263);
  h = Math.imul(h ^ Math.imul(c | 0, 2246822519), 1274126177);
  h ^= h >>> 15;
  h = Math.imul(h, 2654435761);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

export function seedOf(room: DungeonRoom): number {
  return Number.parseInt(room.seed.slice(0, 8), 16) | 0;
}

export function alcoveSpots(room: DungeonRoom): number[] {
  const spots: number[] = [];
  for (let x = 120; x < room.width - 200; x += 320) spots.push(x);
  return spots;
}

export function torchSpots(room: DungeonRoom): number[] {
  return alcoveSpots(room).map((x) => x + 200);
}

export function drawWalls(g: Phaser.GameObjects.Graphics, room: DungeonRoom) {
  const seed = seedOf(room);
  g.fillStyle(MORTAR);
  g.fillRect(0, 0, room.width, room.height);
  const rows = Math.ceil(room.height / BRICK_ROW);
  for (let row = 0; row < rows; row++) {
    const y = row * BRICK_ROW;
    let x = -Math.floor(noise(seed, row, 1) * 40);
    for (let i = 0; x < room.width; i++) {
      const width = 44 + Math.floor(noise(seed, row, i * 3 + 2) * 40);
      drawBlock(
        g,
        x,
        y,
        width,
        noise(seed, row, i * 3 + 7),
        noise(seed, row, i * 3 + 11),
      );
      x += width;
    }
  }
  // Damp streaks running down from a few joints.
  for (let i = 0; i < room.width / 260; i++) {
    const x = noise(seed, i, 41) * room.width;
    const top = 40 + noise(seed, i, 43) * 220;
    const length = 60 + noise(seed, i, 47) * 160;
    g.fillStyle(0x15121d, 0.16);
    g.fillRect(x, top, 3, length);
    g.fillStyle(0x15121d, 0.08);
    g.fillRect(x - 2, top + length * 0.2, 7, length * 0.6);
  }
  // Vault shadow: the wall darkens toward the top, in fine bands.
  for (let y = 0; y < 260; y += 4) {
    g.fillStyle(0x0b0912, 0.34 * (1 - y / 260) ** 1.6);
    g.fillRect(0, y, room.width, 4);
  }
  for (const x of alcoveSpots(room)) drawAlcove(g, x);
  for (const x of torchSpots(room)) drawSconce(g, x);
}

function drawBlock(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  width: number,
  tone: number,
  mark: number,
) {
  const w = width - 3;
  const h = BRICK_ROW - 3;
  const left = x + 1.5;
  const top = y + 1.5;
  g.fillStyle(STONES[Math.floor(tone * STONES.length)] ?? 0x3a3651);
  g.fillRect(left, top, w, h);
  // Bevel: lit top and left edges, shadowed foot and right edge.
  g.fillStyle(0xffffff, 0.07);
  g.fillRect(left, top, w, 2);
  g.fillStyle(0xffffff, 0.035);
  g.fillRect(left, top + 2, 2, h - 2);
  g.fillStyle(0x000000, 0.22);
  g.fillRect(left, top + h - 3, w, 3);
  g.fillStyle(0x000000, 0.12);
  g.fillRect(left + w - 2, top, 2, h - 3);
  // Surface grain: a few faint pits.
  g.fillStyle(0x000000, 0.1);
  for (let i = 0; i < 3; i++) {
    const px = left + 6 + noise(x, y, i) * (w - 12);
    const py = top + 5 + noise(y, x, i) * (h - 12);
    g.fillRect(px, py, 2, 2);
  }
  if (mark > 0.9) {
    // A chipped corner.
    g.fillStyle(MORTAR);
    g.fillTriangle(left + w, top, left + w - 9, top, left + w, top + 7);
  } else if (mark > 0.82) {
    // A hairline crack.
    g.lineStyle(1, 0x1a1724, 0.8);
    const cx = left + w * (0.3 + mark * 0.4);
    g.beginPath();
    g.moveTo(cx, top + 2);
    g.lineTo(cx + 4, top + h * 0.4);
    g.lineTo(cx - 2, top + h * 0.7);
    g.lineTo(cx + 3, top + h - 3);
    g.strokePath();
  }
}

// An arched niche: a stone surround, a deep shadowed recess and a sill.
function drawAlcove(g: Phaser.GameObjects.Graphics, x: number) {
  const cx = x + 48;
  g.fillStyle(0x4d4766);
  g.fillRect(x - 8, 150, 112, 192);
  g.fillCircle(cx, 150, 56);
  g.fillStyle(0x000000, 0.25);
  g.fillRect(x - 8, 150, 4, 192);
  g.fillStyle(0x17141f);
  g.fillRect(x, 150, 96, 190);
  g.fillCircle(cx, 150, 48);
  // Depth: lighter toward the opening's lower edge.
  for (let i = 0; i < 8; i++) {
    g.fillStyle(0x2c2840, 0.12);
    g.fillRect(x + 6 + i * 2, 230 + i * 12, 84 - i * 4, 110 - i * 12);
  }
  g.fillStyle(0x5a5476);
  g.fillRect(x - 12, 336, 120, 8);
  g.fillStyle(0xffffff, 0.08);
  g.fillRect(x - 12, 336, 120, 2);
  g.fillStyle(0x000000, 0.3);
  g.fillRect(x - 12, 344, 120, 4);
}

// Iron wall bracket and wooden torch; the flame is drawn live (render-torch).
function drawSconce(g: Phaser.GameObjects.Graphics, x: number) {
  // Soot stain above the flame.
  g.fillStyle(0x08060c, 0.12);
  g.fillEllipse(x, TORCH_Y - 34, 26, 44);
  g.fillStyle(0x08060c, 0.1);
  g.fillEllipse(x, TORCH_Y - 54, 16, 30);
  // Wall plate.
  g.fillStyle(0x1f1c28);
  g.fillRoundedRect(x - 7, TORCH_Y + 20, 14, 22, 3);
  g.fillStyle(0x8f8aa3, 0.8);
  g.fillCircle(x, TORCH_Y + 25, 1.5);
  g.fillCircle(x, TORCH_Y + 37, 1.5);
  // Handle.
  g.fillStyle(0x4a2d1c);
  g.fillRect(x - 3, TORCH_Y + 2, 6, 30);
  g.fillStyle(0x6e4630);
  g.fillRect(x - 3, TORCH_Y + 2, 2, 30);
  // Iron cup with a lip.
  g.fillStyle(0x2a2733);
  g.fillTriangle(x - 9, TORCH_Y - 2, x + 9, TORCH_Y - 2, x, TORCH_Y + 9);
  g.fillRect(x - 10, TORCH_Y - 4, 20, 4);
  g.fillStyle(0x8f8aa3, 0.5);
  g.fillRect(x - 10, TORCH_Y - 4, 20, 1);
}
