import { z } from "zod";
import type { CatId } from "../game/catalog";
import {
  type Enemy,
  enemyStats,
  knockEnemy,
  MAX_ENEMIES,
  spawnEnemy,
  stepEnemy,
} from "./enemies";
import { AMBUSH_WARNING_TICKS, difficulty, roomTimeMs } from "./generate";
import {
  type DungeonRoom,
  groundAt,
  moverOffset,
  solidsAt,
  surfaceAt,
} from "./rooms";
import { type DungeonRules, PHYSICS } from "./rules";
import { hasTrait, WARRIORS } from "./warriors";

export const controlSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("move"),
      axis: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
    })
    .strict(),
  z.object({ kind: z.literal("jump") }).strict(),
  z.object({ kind: z.literal("attack") }).strict(),
]);
export type Control = z.infer<typeof controlSchema>;
export const inputSchema = z
  .object({
    tick: z.number().int().min(1).max(PHYSICS.maxRoomTicks),
    action: controlSchema,
  })
  .strict();
export const inputsSchema = z.array(inputSchema).max(PHYSICS.maxInputs);
export type DungeonInput = z.infer<typeof inputSchema>;
export const SWING_TICKS = 16;
// The blade connects on the fourth tick of a swing.
export const SWING_HIT = SWING_TICKS - 4;
const HURT_TICKS = 60;
// Health restored for each defeated foe.
export const DEFEAT_HEAL = 6;
const KNOCK_TICKS = 8;
const RESPAWN_TICKS = 90;
export type DungeonFrame = {
  tick: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  axis: -1 | 0 | 1;
  facing: -1 | 1;
  grounded: boolean;
  jumps: number;
  coyote: number;
  riding: number;
  hourglass: boolean;
  checkpointX: number;
  checkpointY: number;
  resets: number;
  timedOut: boolean;
  hp: number;
  invuln: number;
  knock: number;
  knockDir: -1 | 1;
  swing: number;
  cooldown: number;
  shield: boolean;
  knockouts: number;
  defeated: number;
  nextEnemy: number;
  ambushes: number[];
  enemies: Enemy[];
};
export function initialFrame(room: DungeonRoom, cat: CatId): DungeonFrame {
  const x = room.spawn.x * 256;
  const y = room.spawn.y * 256;
  const enemies = room.wardens.map((w, i) =>
    spawnEnemy(room, i, "warden", -2, w.x, room.gates[0]?.y ?? 464, w.surface),
  );
  return {
    tick: 0,
    x,
    y,
    vx: 0,
    vy: 0,
    axis: 0,
    facing: 1,
    grounded: true,
    jumps: 0,
    coyote: PHYSICS.coyoteTicks,
    riding: -1,
    hourglass: false,
    checkpointX: x,
    checkpointY: y,
    resets: 0,
    timedOut: false,
    hp: WARRIORS[cat].hp,
    invuln: 0,
    knock: 0,
    knockDir: 1,
    swing: 0,
    cooldown: 0,
    shield: hasTrait(cat, "steadyShield"),
    knockouts: 0,
    defeated: 0,
    nextEnemy: enemies.length,
    ambushes: room.ambushes.map(() => 0),
    enemies,
  };
}
export function budgetMs(
  frame: DungeonFrame,
  room: DungeonRoom,
  cat: CatId,
  rules: DungeonRules,
) {
  return (
    roomBudgetMs(room, cat, rules) +
    (frame.hourglass ? rules.hourglassMs : 0) +
    (cat === "guardian" ? rules.guardianGraceMs : 0)
  );
}
export function roomBudgetMs(
  room: DungeonRoom,
  cat: CatId,
  rules: DungeonRules,
): number {
  return (
    roomTimeMs(room, rules) + (cat === "collector" ? rules.collectorBonusMs : 0)
  );
}
export function wardensLeft(frame: DungeonFrame): number {
  return frame.enemies.filter((e) => e.kind === "warden").length;
}
export function stepRoom(
  previous: DungeonFrame,
  room: DungeonRoom,
  cat: CatId,
  rules: DungeonRules,
  controls: readonly Control[],
): DungeonFrame {
  if (previous.timedOut) return previous;
  const warrior = WARRIORS[cat];
  const f: DungeonFrame = {
    ...previous,
    tick: previous.tick + 1,
    ambushes: [...previous.ambushes],
    invuln: Math.max(0, previous.invuln - 1),
    swing: Math.max(0, previous.swing - 1),
    cooldown: Math.max(0, previous.cooldown - 1),
  };
  for (const control of controls) {
    if (control.kind === "move") {
      f.axis = control.axis;
      if (control.axis !== 0) f.facing = control.axis;
    } else if (control.kind === "attack") {
      if (f.cooldown === 0) {
        f.swing = SWING_TICKS;
        f.cooldown = warrior.cooldownTicks;
      }
    } else if (
      f.grounded ||
      f.coyote > 0 ||
      (hasTrait(cat, "doubleJump") && f.jumps < 2)
    ) {
      f.vy = PHYSICS.jump;
      f.grounded = false;
      f.coyote = 0;
      f.jumps++;
    }
  }
  move(f, previous, room, cat, rules);
  combat(f, previous, room, cat);
  if (f.y > (room.height + 64) * 256) respawn(f, false);
  const hx = room.hourglass.x * 256;
  const hy = room.hourglass.y * 256;
  if (
    !f.hourglass &&
    Math.abs(f.x + PHYSICS.width / 2 - hx) < 22 * 256 &&
    Math.abs(f.y + PHYSICS.height / 2 - hy) < 30 * 256
  )
    f.hourglass = true;
  f.timedOut =
    (f.tick * 1000) / PHYSICS.ticksPerSecond >= budgetMs(f, room, cat, rules);
  return f;
}
function move(
  f: DungeonFrame,
  previous: DungeonFrame,
  room: DungeonRoom,
  cat: CatId,
  rules: DungeonRules,
) {
  f.coyote = f.grounded ? PHYSICS.coyoteTicks : Math.max(0, f.coyote - 1);
  const mover = room.movers[previous.riding];
  if (previous.grounded && mover)
    f.x +=
      (moverOffset(mover, f.tick) - moverOffset(mover, previous.tick)) * 256;
  const speed = Math.trunc(
    (PHYSICS.speed * (hasTrait(cat, "quickPaws") ? rules.sprintBps : 10000)) /
      10000,
  );
  if (f.knock > 0) {
    f.knock--;
    f.vx = f.knockDir * PHYSICS.speed;
  } else f.vx = f.axis * speed;
  f.x = Math.max(0, Math.min(room.width * 256 - PHYSICS.width, f.x + f.vx));
  const solids = solidsAt(room, f.tick);
  const oldFeet = previous.y + PHYSICS.height;
  const center = f.x + PHYSICS.width / 2;
  const ground = groundAt(solids, center, oldFeet);
  f.vy = Math.min(PHYSICS.maxFall, f.vy + PHYSICS.gravity);
  f.y += f.vy;
  f.grounded = false;
  f.riding = -1;
  let support: number | null = null;
  if (
    previous.grounded &&
    f.jumps === 0 &&
    ground !== null &&
    Math.abs(ground.y - oldFeet) <= 12 * 256
  ) {
    f.y = ground.y - PHYSICS.height;
    support = ground.index;
  } else if (f.vy >= 0) {
    let landing: { y: number; index: number } | null = null;
    for (let index = 0; index < solids.length; index++) {
      const surface = solids[index];
      const y = surface ? surfaceAt(surface, center) : null;
      if (
        y !== null &&
        oldFeet <= y + 256 &&
        f.y + PHYSICS.height >= y &&
        (landing === null || y < landing.y)
      )
        landing = { y, index };
    }
    if (landing !== null) {
      f.y = landing.y - PHYSICS.height;
      support = landing.index;
    }
  }
  if (support === null) return;
  f.vy = 0;
  f.grounded = true;
  f.jumps = 0;
  f.riding =
    support >= room.surfaces.length ? support - room.surfaces.length : -1;
  // Checkpoints sit on solid ground with room to retry a missed gap.
  const onSpikes = room.spikes.some(
    (s) => center >= (s.x - 24) * 256 && center <= (s.x + s.width + 24) * 256,
  );
  const solid = room.surfaces[support];
  if (
    solid !== undefined &&
    !solid.floating &&
    !onSpikes &&
    center >= (solid.x + 32) * 256 &&
    center <= (solid.x + solid.width - 32) * 256 &&
    f.x - previous.checkpointX > 96 * 256
  ) {
    f.checkpointX = f.x;
    f.checkpointY = f.y;
  }
}
function overlaps(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number,
) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}
function combat(
  f: DungeonFrame,
  previous: DungeonFrame,
  room: DungeonRoom,
  cat: CatId,
) {
  const warrior = WARRIORS[cat];
  const center = { x: f.x + PHYSICS.width / 2, y: f.y + PHYSICS.height / 2 };
  room.ambushes.forEach((ambush, i) => {
    if (f.ambushes[i] === 0 && center.x >= ambush.trigger * 256)
      f.ambushes[i] = f.tick;
  });
  let enemies = f.enemies.map((e) => stepEnemy(e, room, f.tick, center));
  const add = (
    kind: Enemy["kind"],
    source: number,
    x: number,
    y: number,
    surface: number,
  ) => {
    if (enemies.length >= MAX_ENEMIES) return;
    enemies.push(spawnEnemy(room, f.nextEnemy, kind, source, x, y, surface));
    f.nextEnemy++;
  };
  room.ambushes.forEach((ambush, i) => {
    const fired = f.ambushes[i] ?? 0;
    if (fired !== 0 && f.tick === fired + AMBUSH_WARNING_TICKS)
      for (const s of ambush.spawns) add(s.kind, -1, s.x, s.y, s.surface);
  });
  // A spawner waits while its last foe is still near the spawn point or the
  // cat stands on it, so foes never stack or appear on top of the cat.
  const limit = difficulty(room.level).maxAlive;
  room.spawners.forEach((s, i) => {
    const own = enemies.filter((e) => e.source === i);
    if (
      f.tick >= s.first &&
      (f.tick - s.first) % s.every === 0 &&
      own.length < s.cap &&
      enemies.length < limit &&
      Math.abs(center.x - s.x * 256) > 140 * 256 &&
      !own.some((e) => Math.abs(e.x - s.x * 256) < 64 * 256)
    )
      add(s.kind, i, s.x, s.y, s.surface);
  });
  const berserk = hasTrait(cat, "berserk") && f.hp * 10 <= warrior.hp * 3;
  const atk = berserk ? Math.trunc((warrior.atk * 3) / 2) : warrior.atk;
  if (f.swing === SWING_HIT) {
    // The arc covers the front half of the body and the weapon's reach.
    const span = (PHYSICS.width / 2 + warrior.reach * 256) | 0;
    const left = f.facing > 0 ? center.x : center.x - span;
    const inReach = enemies.filter((e) => {
      const s = enemyStats(e.kind, room.level);
      return overlaps(
        left,
        f.y - 12 * 256,
        span,
        PHYSICS.height + 12 * 256,
        e.x,
        e.y,
        s.width * 256,
        s.height * 256,
      );
    });
    const distance = (e: Enemy) => Math.abs(e.x - f.x);
    const struck = hasTrait(cat, "cleave")
      ? inReach
      : inReach
          .sort((a, b) => distance(a) - distance(b) || a.id - b.id)
          .slice(0, 1);
    const push = (hasTrait(cat, "shieldBash") ? 28 : 12) * 256 * f.facing;
    enemies = enemies.map((e) =>
      struck.some((s) => s.id === e.id)
        ? knockEnemy(
            {
              ...e,
              hp: e.hp - Math.max(1, atk - enemyStats(e.kind, room.level).def),
            },
            room,
            push,
          )
        : e,
    );
  }
  const oldFeet = previous.y + PHYSICS.height;
  const feet = f.y + PHYSICS.height;
  for (const [i, e] of enemies.entries()) {
    const s = enemyStats(e.kind, room.level);
    const stomp =
      f.y > previous.y &&
      oldFeet <= e.y + 6 * 256 &&
      feet >= e.y &&
      overlaps(f.x, 0, PHYSICS.width, 1, e.x, 0, s.width * 256, 1);
    if (stomp) {
      const damage = hasTrait(cat, "pounce") ? atk * 2 : atk;
      enemies[i] = knockEnemy(
        { ...e, hp: e.hp - Math.max(1, damage - s.def) },
        room,
        0,
      );
      f.vy = Math.trunc((PHYSICS.jump * 3) / 5);
      f.y = e.y - PHYSICS.height;
      f.grounded = false;
      f.riding = -1;
      f.jumps = 1;
      f.invuln = Math.max(f.invuln, 8);
    }
  }
  const before = enemies.length;
  enemies = enemies.filter((e) => e.hp > 0);
  const beaten = before - enemies.length;
  f.defeated += beaten;
  f.hp = Math.min(warrior.hp, f.hp + beaten * DEFEAT_HEAL);
  f.enemies = enemies;
  if (f.invuln > 0) return;
  for (const [i, e] of enemies.entries()) {
    const s = enemyStats(e.kind, room.level);
    if (
      e.stagger === 0 &&
      overlaps(
        f.x,
        f.y,
        PHYSICS.width,
        PHYSICS.height,
        e.x,
        e.y,
        s.width * 256,
        s.height * 256,
      )
    ) {
      const from = e.x + (s.width * 256) / 2;
      hurt(f, cat, s.atk, from);
      // A foe that lands a hit recoils, so it cannot pin the cat in place.
      enemies[i] = knockEnemy(e, room, (from < center.x ? -20 : 20) * 256);
      return;
    }
  }
  for (const spike of room.spikes) {
    if (
      feet >= (spike.y - 12) * 256 &&
      feet <= (spike.y + 2) * 256 &&
      overlaps(
        f.x,
        0,
        PHYSICS.width,
        1,
        (spike.x + 4) * 256,
        0,
        (spike.width - 8) * 256,
        1,
      )
    ) {
      hurt(f, cat, 12 + 4 * (room.level - 1), center.x);
      f.vy = Math.trunc((PHYSICS.jump * 7) / 10);
      return;
    }
  }
}
function hurt(f: DungeonFrame, cat: CatId, raw: number, fromX: number) {
  const center = f.x + PHYSICS.width / 2;
  f.knockDir = center < fromX ? -1 : 1;
  // A cat riding a platform flinches in place instead of being thrown off.
  if (f.riding < 0) {
    f.knock = KNOCK_TICKS;
    f.vy = -4 * 256;
    f.grounded = false;
    f.coyote = 0;
    f.jumps = 1;
  }
  if (f.shield) {
    f.shield = false;
    f.invuln = 40;
    return;
  }
  f.hp -= Math.max(1, raw - WARRIORS[cat].def);
  f.invuln = HURT_TICKS;
  if (f.hp <= 0) respawn(f, true, WARRIORS[cat].hp);
}
// A fall or a knockout returns the cat to its checkpoint; the timer runs on.
function respawn(f: DungeonFrame, knockedOut: boolean, hp = f.hp) {
  f.x = f.checkpointX;
  f.y = f.checkpointY;
  f.vx = 0;
  f.vy = 0;
  f.grounded = false;
  f.jumps = 0;
  f.coyote = PHYSICS.coyoteTicks;
  f.riding = -1;
  f.knock = 0;
  f.swing = 0;
  f.resets++;
  if (knockedOut) {
    f.hp = hp;
    f.knockouts++;
    f.invuln = RESPAWN_TICKS;
  }
}
export function nearbyGate(
  frame: DungeonFrame,
  room: DungeonRoom,
): number | null {
  if (!frame.grounded || frame.timedOut || wardensLeft(frame) > 0) return null;
  return (
    room.gates.find(
      (g) =>
        Math.abs(frame.x + PHYSICS.width / 2 - g.x * 256) <= 32 * 256 &&
        Math.abs(frame.y + PHYSICS.height - g.y * 256) <= 12 * 256,
    )?.id ?? null
  );
}
