import type Phaser from "phaser";
import { AMBUSH_WARNING_TICKS } from "./generate";
import { DUSK } from "./render-scenery";
import { type DungeonRoom, moverSurface } from "./rooms";
import type { DungeonFrame } from "./simulation";

// Moving parts of a room drawn every frame: lifts, the hourglass pickup and
// ambush warnings.
export function drawMovers(
  g: Phaser.GameObjects.Graphics,
  room: DungeonRoom,
  frame: DungeonFrame,
) {
  for (const m of room.movers) {
    const s = moverSurface(m, frame.tick);
    g.fillStyle(DUSK.ink);
    g.fillRoundedRect(s.x - 2, s.y - 9, s.width + 4, 29, 5);
    g.fillStyle(DUSK.floorTop);
    g.fillRoundedRect(s.x, s.y - 7, s.width, 9, 3);
    g.fillStyle(DUSK.gate);
    g.fillRect(s.x, s.y, s.width, 18);
    g.fillStyle(DUSK.lip);
    g.fillRect(s.x + 2, s.y, s.width - 4, 2);
    g.fillStyle(DUSK.gold);
    g.fillCircle(s.x + 10, s.y + 10, 3);
    g.fillCircle(s.x + s.width - 10, s.y + 10, 3);
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
