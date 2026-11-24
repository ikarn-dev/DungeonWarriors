import { enemyStats } from "./enemies";
import { RoomRandom } from "./random";
import type {
  Ambush,
  DungeonRoom,
  EnemyKind,
  Mover,
  Spawner,
  Spikes,
  Surface,
} from "./rooms";
import { type DungeonRules, PHYSICS } from "./rules";

export const MAX_LEVEL = 5;
export const AMBUSH_WARNING_TICKS = 36;
const HEIGHT = 600;
const TOP = 352;
const BOTTOM = 480;
const ARENA_WIDTH = 544;
const tile = (
  x: number,
  width: number,
  y: number,
  rise = 0,
  floating = false,
): Surface => ({ x, width, y, rise, floating });
const POOLS: readonly (readonly EnemyKind[])[] = [
  ["slime"],
  ["slime", "skeleton"],
  ["skeleton", "bat", "slime"],
  ["skeleton", "bat"],
];
// Difficulty grows with the room number, which is also the payout tier.
export function difficulty(level: number) {
  const step = level - 1;
  return {
    segments: 6 + level,
    gapPercent: 20 + 6 * level,
    moverPercent: 10 + 5 * level,
    movers: 1 + Math.floor(level / 2),
    spikePercent: 15 + 10 * level,
    spawners: Math.min(level, 5),
    spawnEvery: Math.max(240, 480 - 50 * level),
    spawnCap: 1 + Math.floor(level / 2),
    ambushes: Math.min(level - 1, 4),
    ambushSize: 1 + Math.floor(level / 3),
    wardens: level >= 4 ? 2 : 1,
    maxAlive: 3 + level,
    moverTravel: Math.max(90, 150 - 12 * step),
    moverDwell: Math.max(24, 45 - 3 * step),
    pool: POOLS[Math.min(step, POOLS.length - 1)] ?? ["skeleton"],
  };
}
// Rooms come from a public per-room seed, never from the gate secret, so the
// layout and foes cannot hint which gate is the trap.
export function generateRoom(seed: string, index: number): DungeonRoom {
  if (!Number.isInteger(index) || index < 0 || index >= MAX_LEVEL)
    throw new Error("INVALID_DUNGEON_ROOM");
  const level = index + 1;
  const d = difficulty(level);
  const rng = new RoomRandom(seed);
  const surfaces: Surface[] = [tile(0, 320, 464)];
  const movers: Mover[] = [];
  const spikes: Spikes[] = [];
  const route: number[] = [];
  let x = 320;
  let y = 464;
  for (let i = 0; i < d.segments; i++) {
    const roll = rng.int(100);
    if (roll < d.moverPercent && movers.length < d.movers) {
      const gap = 192 + 32 * rng.int(3);
      const travel = d.moverTravel + rng.int(30);
      movers.push({
        x,
        y,
        width: 80,
        span: gap - 80,
        travel,
        dwell: d.moverDwell,
        phase: rng.int(2 * (travel + d.moverDwell)),
      });
      x += gap;
    } else if (roll < d.moverPercent + d.gapPercent) x += 48 + 16 * rng.int(3);
    const width = 192 + 32 * rng.int(5);
    const shape = rng.int(3);
    const size = 32 + 16 * rng.int(2);
    let rise = shape === 0 ? 0 : shape === 1 ? -size : size;
    if (y + rise < TOP || y + rise > BOTTOM) rise = -rise;
    surfaces.push(tile(x, width, y, rise));
    route.push(surfaces.length - 1);
    if (i > 0 && rise === 0 && width >= 256 && rng.int(100) < d.spikePercent) {
      const strip = 32 + 16 * rng.int(3);
      spikes.push({ x: x + (width - strip) / 2, width: strip, y });
    }
    x += width;
    y += rise;
  }
  const arena = surfaces.length;
  surfaces.push(tile(x, ARENA_WIDTH, y));
  const gates = [0, 1, 2].map((id) => ({ id, x: x + 256 + 128 * id, y }));
  const wardens = Array.from({ length: d.wardens }, (_, k) => ({
    x: x + 96 + 64 * k,
    surface: arena,
  }));
  const hourglass = placeHourglass(rng, surfaces, route, spikes);
  const spawners: Spawner[] = [];
  for (let k = 0; k < d.spawners && route.length > 1; k++) {
    const surface =
      route[1 + Math.floor((k * (route.length - 1)) / d.spawners)] ?? 0;
    const ground = surfaces[surface] ?? tile(0, 0, 464);
    const kind = rng.pick(d.pool);
    const cx = ground.x + Math.trunc(ground.width / 2);
    spawners.push({
      kind,
      x: cx,
      y: kind === "bat" ? Math.min(ground.y, ground.y + ground.rise) - 130 : 0,
      surface,
      every: d.spawnEvery,
      first: 90 + rng.int(180),
      cap: d.spawnCap,
    });
  }
  const ambushes: Ambush[] = [];
  for (let k = 0; k < d.ambushes && route.length > 2; k++) {
    const at = route[1 + Math.floor((k * (route.length - 2)) / d.ambushes)];
    const ground = at === undefined ? undefined : surfaces[at];
    if (!ground) continue;
    ambushes.push({
      trigger: ground.x,
      spawns: Array.from({ length: d.ambushSize }, (_, n) => {
        const sx = ground.x + 220 + 48 * n;
        const under = route.find((r) => {
          const s = surfaces[r];
          return s !== undefined && sx >= s.x + 16 && sx <= s.x + s.width - 16;
        });
        const picked = rng.pick(d.pool);
        const kind: EnemyKind = under === undefined ? "bat" : picked;
        return {
          kind,
          x: sx,
          y: kind === "bat" ? 300 : 0,
          surface: kind === "bat" ? -1 : (under ?? -1),
        };
      }),
    });
  }
  return {
    seed,
    index,
    level,
    width: x + ARENA_WIDTH,
    height: HEIGHT,
    spawn: { x: 64, y: 464 - PHYSICS.height / 256 },
    surfaces,
    movers,
    spikes,
    spawners,
    ambushes,
    wardens,
    arena: { x, end: x + ARENA_WIDTH, surface: arena },
    gates,
    hourglass,
  };
}
// A floating slab 76 px above a route segment's middle, within one jump.
function placeHourglass(
  rng: RoomRandom,
  surfaces: Surface[],
  route: readonly number[],
  spikes: readonly Spikes[],
) {
  const options = route.slice(1).filter((r) => {
    const s = surfaces[r];
    return (
      s !== undefined && !spikes.some((p) => p.x >= s.x && p.x < s.x + s.width)
    );
  });
  const ground = surfaces[options.length > 0 ? rng.pick(options) : 0];
  if (!ground) throw new Error("INVALID_DUNGEON_ROOM");
  const cx = ground.x + Math.trunc(ground.width / 2);
  const top = ground.y + Math.trunc(ground.rise / 2) - 76;
  surfaces.push(tile(cx - 48, 96, top, 0, true));
  return { x: cx, y: top - 18 };
}
// Ticks for the weakest hitter (Sir Bastion: 13 attack, 24-tick swing) to beat
// a foe.
function fightTicks(kind: EnemyKind, level: number) {
  const stats = enemyStats(kind, level);
  return Math.ceil(stats.hp / Math.max(1, 13 - stats.def)) * 24 + 30;
}
// Room time: travel, platform waits and the warden fight at base speed, plus
// half of the foes along the route, with slack that tightens each level. The
// onchain per-room seconds stay the minimum.
export function roomTimeMs(room: DungeonRoom, rules: DungeonRules): number {
  const last = room.gates[room.gates.length - 1];
  const travel = Math.ceil(
    (((last?.x ?? room.width) - room.spawn.x) * 256) / PHYSICS.speed,
  );
  const waits = room.movers.reduce((t, m) => t + m.travel + m.dwell, 0);
  const wardens = room.wardens.length * fightTicks("warden", room.level);
  const optional =
    room.spawners.reduce((t, s) => t + fightTicks(s.kind, room.level), 0) +
    room.ambushes.reduce(
      (t, a) =>
        t + a.spawns.reduce((u, s) => u + fightTicks(s.kind, room.level), 0),
      0,
    );
  const base = travel + waits + wardens + Math.ceil(optional / 2);
  const slackBps = Math.max(12000, 17000 - 1000 * (room.level - 1));
  const seconds =
    Math.ceil((base * slackBps) / 10000 / PHYSICS.ticksPerSecond) + 3;
  const floor = rules.roomSeconds[Math.min(room.index, 4)] ?? 30;
  return Math.min(PHYSICS.maxRoomMs, Math.max(floor, seconds) * 1000);
}
