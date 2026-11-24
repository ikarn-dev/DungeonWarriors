import { shuttle } from "./random";
import { type DungeonRoom, type EnemyKind, surfaceAt } from "./rooms";

export type Enemy = {
  id: number;
  kind: EnemyKind;
  // Spawner index, -1 for ambushes and -2 for gate wardens.
  source: number;
  // Index into room.surfaces for walkers; -1 for flyers.
  surface: number;
  x: number;
  y: number;
  dir: -1 | 1;
  hp: number;
  maxHp: number;
  stagger: number;
  homeY: number;
  leashMin: number;
  leashMax: number;
};
export type EnemyStats = {
  width: number;
  height: number;
  hp: number;
  atk: number;
  def: number;
  speed: number;
  aggro: number;
  flying: boolean;
};
// Level 1 values; px sizes, subpixel-per-tick speeds.
const BASE: Readonly<Record<EnemyKind, EnemyStats>> = {
  slime: {
    width: 30,
    height: 24,
    hp: 30,
    atk: 10,
    def: 0,
    speed: 224,
    aggro: 240,
    flying: false,
  },
  skeleton: {
    width: 26,
    height: 44,
    hp: 44,
    atk: 14,
    def: 2,
    speed: 300,
    aggro: 300,
    flying: false,
  },
  bat: {
    width: 30,
    height: 20,
    hp: 22,
    atk: 9,
    def: 0,
    speed: 320,
    aggro: 320,
    flying: true,
  },
  warden: {
    width: 44,
    height: 66,
    hp: 130,
    atk: 16,
    def: 4,
    speed: 220,
    aggro: 420,
    flying: false,
  },
};
export const MAX_ENEMIES = 24;
export const STAGGER_TICKS = 18;
const scale = (value: number, bps: number) => Math.trunc((value * bps) / 10000);
// Each level makes foes 12.5% larger, 25–30% tougher and 10% stronger.
export function enemyStats(kind: EnemyKind, level: number): EnemyStats {
  const base = BASE[kind];
  const step = Math.max(0, level - 1);
  const size = 10000 + 1250 * step;
  return {
    width: scale(base.width, size),
    height: scale(base.height, size),
    hp: scale(base.hp, 10000 + (kind === "warden" ? 2500 : 3000) * step),
    atk: scale(base.atk, 10000 + 1000 * step),
    def: base.def,
    speed: scale(base.speed, 10000 + 400 * step),
    aggro: base.aggro,
    flying: base.flying,
  };
}
export function spawnEnemy(
  room: DungeonRoom,
  id: number,
  kind: EnemyKind,
  source: number,
  x: number,
  y: number,
  surface: number,
): Enemy {
  const stats = enemyStats(kind, room.level);
  const ground = room.surfaces[surface];
  const arena = source === -2;
  const leashMin = stats.flying ? 0 : arena ? room.arena.x : (ground?.x ?? 0);
  const leashMax = stats.flying
    ? room.width
    : arena
      ? room.arena.end
      : (ground?.x ?? 0) + (ground?.width ?? room.width);
  const left = Math.max(
    leashMin * 256,
    Math.min((leashMax - stats.width) * 256, (x - stats.width / 2) * 256),
  );
  const enemy: Enemy = {
    id,
    kind,
    source,
    surface: stats.flying ? -1 : surface,
    x: Math.trunc(left),
    y: (y - stats.height) * 256,
    dir: -1,
    hp: stats.hp,
    maxHp: stats.hp,
    stagger: 0,
    homeY: (y - stats.height) * 256,
    leashMin: leashMin * 256,
    leashMax: (leashMax - stats.width) * 256,
  };
  return settle(enemy, room, stats);
}
function settle(enemy: Enemy, room: DungeonRoom, stats: EnemyStats): Enemy {
  if (stats.flying) return enemy;
  const surface = room.surfaces[enemy.surface];
  const top = surface
    ? surfaceAt(surface, enemy.x + (stats.width * 256) / 2)
    : null;
  if (top !== null) enemy.y = top - stats.height * 256;
  return enemy;
}
export function stepEnemy(
  previous: Enemy,
  room: DungeonRoom,
  tick: number,
  target: { x: number; y: number },
): Enemy {
  const stats = enemyStats(previous.kind, room.level);
  const e = { ...previous };
  if (e.stagger > 0) {
    e.stagger--;
    return e;
  }
  const cx = e.x + (stats.width * 256) / 2;
  const cy = e.y + (stats.height * 256) / 2;
  const dx = target.x - cx;
  const dy = target.y - cy;
  const near = Math.abs(dx) < stats.aggro * 256;
  if (stats.flying) {
    if (near && Math.abs(dy) < stats.aggro * 256) {
      e.x += Math.sign(dx) * Math.min(stats.speed, Math.abs(dx));
      e.y +=
        Math.sign(dy) * Math.min(Math.trunc(stats.speed / 2), Math.abs(dy));
      e.dir = dx < 0 ? -1 : 1;
    } else e.y = e.homeY - shuttle(tick, e.id * 37, 60, 10, 24) * 256;
    e.x = Math.max(0, Math.min((room.width - stats.width) * 256, e.x));
    e.y = Math.max(40 * 256, Math.min(500 * 256, e.y));
    return e;
  }
  if (near && Math.abs(dy) < 200 * 256 && Math.abs(dx) > 4 * 256) {
    e.dir = dx < 0 ? -1 : 1;
    e.x += e.dir * stats.speed;
  } else if (!near) {
    e.x += e.dir * Math.trunc(stats.speed / 2);
  }
  if (e.x <= e.leashMin) {
    e.x = e.leashMin;
    if (!near) e.dir = 1;
  } else if (e.x >= e.leashMax) {
    e.x = e.leashMax;
    if (!near) e.dir = -1;
  }
  return settle(e, room, stats);
}
export function knockEnemy(e: Enemy, room: DungeonRoom, push: number): Enemy {
  const stats = enemyStats(e.kind, room.level);
  const next = {
    ...e,
    x: Math.max(e.leashMin, Math.min(e.leashMax, e.x + push)),
    stagger: STAGGER_TICKS,
  };
  return settle(next, room, stats);
}
