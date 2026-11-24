import { shuttle } from "./random";

// Room geometry in whole world pixels; the simulation works in 1/256 px.
export type Surface = {
  x: number;
  width: number;
  y: number;
  rise: number;
  floating: boolean;
};
// Horizontal moving platform at a ledge's height, shuttling across a pit.
export type Mover = {
  x: number;
  y: number;
  width: number;
  span: number;
  travel: number;
  dwell: number;
  phase: number;
};
export type Spikes = { x: number; width: number; y: number };
export type EnemyKind = "slime" | "skeleton" | "bat" | "warden";
export type Spawner = {
  kind: EnemyKind;
  x: number;
  y: number;
  surface: number;
  every: number;
  first: number;
  cap: number;
};
export type Ambush = {
  trigger: number;
  spawns: readonly {
    kind: EnemyKind;
    x: number;
    y: number;
    surface: number;
  }[];
};
export type Gate = { id: number; x: number; y: number };
export type DungeonRoom = {
  seed: string;
  index: number;
  level: number;
  width: number;
  height: number;
  spawn: { x: number; y: number };
  surfaces: readonly Surface[];
  movers: readonly Mover[];
  spikes: readonly Spikes[];
  spawners: readonly Spawner[];
  ambushes: readonly Ambush[];
  wardens: readonly { x: number; surface: number }[];
  arena: { x: number; end: number; surface: number };
  gates: readonly Gate[];
  hourglass: { x: number; y: number };
};
export function moverOffset(mover: Mover, tick: number): number {
  return shuttle(tick, mover.phase, mover.travel, mover.dwell, mover.span);
}
export function moverSurface(mover: Mover, tick: number): Surface {
  return {
    x: mover.x + moverOffset(mover, tick),
    width: mover.width,
    y: mover.y,
    rise: 0,
    floating: true,
  };
}
export function surfaceAt(surface: Surface, subpixelX: number): number | null {
  const x = subpixelX - surface.x * 256;
  if (x < 0 || x > surface.width * 256) return null;
  return surface.y * 256 + Math.trunc((x * surface.rise) / surface.width);
}
// Static surfaces first, then each mover at this tick; the index into this
// list identifies a mover as `index - room.surfaces.length`.
export function solidsAt(room: DungeonRoom, tick: number): Surface[] {
  return [
    ...room.surfaces,
    ...room.movers.map((mover) => moverSurface(mover, tick)),
  ];
}
export function groundAt(
  solids: readonly Surface[],
  x: number,
  near: number,
): { y: number; index: number } | null {
  let best: { y: number; index: number } | null = null;
  for (let index = 0; index < solids.length; index++) {
    const surface = solids[index];
    const y = surface ? surfaceAt(surface, x) : null;
    if (y !== null && y >= near - 12 * 256 && (best === null || y < best.y))
      best = { y, index };
  }
  return best;
}
