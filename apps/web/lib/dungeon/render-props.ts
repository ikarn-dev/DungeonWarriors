import type Phaser from "phaser";
import { AMBUSH_WARNING_TICKS } from "./generate";
import { DUSK } from "./render-scenery";
import { type DungeonRoom, moverSurface } from "./rooms";
import type { DungeonFrame } from "./simulation";

// Moving parts of a room drawn every frame: lifts (2026-11-26: stone slabs
// on iron carriages, matching the ledges), the hourglass pickup and ambush
// warnings.
export function drawMovers(
  g: Phaser.GameObjects.Graphics,
  room: DungeonRoom,
  frame: DungeonFrame,
) {
  for (const m of room.movers) {
    const s = moverSurface(m, frame.tick);
    // A cut-stone slab like the ledges, riding an iron carriage on the rail.
    g.fillStyle(0x24212d);
    g.fillRect(s.x + 6, s.y + 12, 6, 12);
    g.fillRect(s.x + s.width - 12, s.y + 12, 6, 12);
    g.fillStyle(DUSK.floorTop);
    g.fillRect(s.x, s.y - 8, s.width, 8);
    g.fillStyle(0xffffff, 0.08);
    g.fillRect(s.x, s.y - 8, s.width, 1.5);
    g.fillStyle(0x857ea3);
    g.fillRect(s.x, s.y, s.width, 8);
    g.fillStyle(DUSK.lip, 0.85);
    g.fillRect(s.x, s.y, s.width, 1.5);
    g.fillStyle(DUSK.floor);
    g.fillRect(s.x, s.y + 8, s.width, 8);
    g.fillStyle(0x000000, 0.3);
    g.fillRect(s.x, s.y + 8, s.width, 2);
    g.fillRect(s.x, s.y + 14, s.width, 2);
    g.fillStyle(DUSK.mortar, 0.8);
    for (let x = s.x + 24; x < s.x + s.width - 4; x += 24)
      g.fillRect(x, s.y - 8, 1.5, 24);
    g.fillStyle(0x9a94ad);
    g.fillCircle(s.x + 9, s.y + 20, 1.5);
    g.fillCircle(s.x + s.width - 9, s.y + 20, 1.5);
  }
}
export function drawHourglass(
  g: Phaser.GameObjects.Graphics,
  room: DungeonRoom,
  frame: DungeonFrame,
  time: number,
  still: boolean,
) {
  if (frame.hourglass) return;
  const { x } = room.hourglass;
  const y = room.hourglass.y + (still ? 0 : Math.sin(time / 300) * 3);
  g.fillStyle(DUSK.halo, 0.18);
  g.fillCircle(x, y, 18);
  g.fillStyle(DUSK.gold);
  g.fillRect(x - 8, y - 12, 16, 3);
  g.fillRect(x - 8, y + 9, 16, 3);
  g.fillStyle(0xa8ecf5);
  g.fillTriangle(x - 6, y - 9, x + 6, y - 9, x, y);
  g.fillStyle(0xffe08a);
  g.fillTriangle(x - 6, y + 9, x + 6, y + 9, x, y);
}
export function drawWarnings(
  g: Phaser.GameObjects.Graphics,
  room: DungeonRoom,
  frame: DungeonFrame,
  time: number,
  still: boolean,
) {
  room.ambushes.forEach((ambush, i) => {
    const fired = frame.ambushes[i] ?? 0;
    if (fired === 0 || frame.tick >= fired + AMBUSH_WARNING_TICKS) return;
    if (!still && Math.floor(time / 120) % 2 === 1) return;
    for (const s of ambush.spawns) {
      const ground = room.surfaces[s.surface];
      const y =
        s.kind === "bat" || !ground
          ? s.y
          : ground.y +
            Math.trunc((ground.rise * (s.x - ground.x)) / ground.width) -
            70;
      g.fillStyle(DUSK.ink);
      g.fillRoundedRect(s.x - 11, y - 30, 22, 34, 6);
      g.fillStyle(DUSK.gold);
      g.fillRoundedRect(s.x - 9, y - 28, 18, 30, 5);
      g.fillStyle(DUSK.ink);
      g.fillRect(s.x - 2, y - 23, 4, 14);
      g.fillRect(s.x - 2, y - 6, 4, 4);
    }
  });
}
