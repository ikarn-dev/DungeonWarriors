import { enemyStats } from "../../../../../apps/web/lib/dungeon/enemies";
import {
  type DungeonRoom,
  moverOffset,
  surfaceAt,
} from "../../../../../apps/web/lib/dungeon/rooms";
import {
  type DungeonRules,
  PHYSICS,
} from "../../../../../apps/web/lib/dungeon/rules";
import {
  type Control,
  type DungeonFrame,
  type DungeonInput,
  initialFrame,
  nearbyGate,
  roomOver,
  stepRoom,
} from "../../../../../apps/web/lib/dungeon/simulation";
import { WARRIORS } from "../../../../../apps/web/lib/dungeon/warriors";
import type { CatId } from "../../../../../apps/web/lib/game/catalog";

const px = (v: number) => v / 256;

function routeControls(
  f: DungeonFrame,
  room: DungeonRoom,
  reach: number,
  goal: number,
): Control[] {
  const controls: Control[] = [];
  const center = px(f.x) + px(PHYSICS.width) / 2;
  const feet = px(f.y) + px(PHYSICS.height);
  let want: -1 | 0 | 1 = center < goal - 4 ? 1 : center > goal + 4 ? -1 : 0;
  let jump = false;
  const tick = f.tick + 1;
  for (const [i, m] of room.movers.entries()) {
    const start = m.x;
    const end = m.x + m.width + m.span;
    const period = 2 * (m.travel + m.dwell);
    const phase = (tick + m.phase) % period;
    if (f.riding === i) {
      // Ride at the front edge, then step off during the far dwell.
      const front = m.x + moverOffset(m, tick) + m.width;
      const docked =
        moverOffset(m, tick) === m.span &&
        phase >= m.dwell + m.travel &&
        phase < 2 * m.dwell + m.travel - 8;
      want = docked || center < front - 22 ? 1 : 0;
    } else if (f.grounded && center > start - 44 && center < start + 2) {
      // Board while the platform rests against this ledge.
      const ready = phase < m.dwell - 18 && moverOffset(m, tick) === 0;
      if (center < start - 24) want = 1;
      else want = ready ? 1 : 0;
    } else if (center >= start && center < end && !f.grounded && f.riding < 0) {
      want = 1;
    }
  }
  const inMoverGap = room.movers.some(
    (m) => center + 30 >= m.x && center < m.x + m.width + m.span,
  );
  const solid = room.surfaces.filter((s) => !s.floating);
  const gapAhead =
    !inMoverGap &&
    solid.every((s) => surfaceAt(s, (center + 26) * 256) === null) &&
    f.riding < 0;
  const spikeAhead = room.spikes.some(
    (s) => center + 34 >= s.x && center < s.x && Math.abs(feet - s.y) < 8,
  );
  // Clear a bat hovering over a pit before jumping it.
  const flyerAhead = f.enemies.some(
    (e) => e.kind === "bat" && px(e.x) > center - 40 && px(e.x) < center + 150,
  );
  if (f.grounded && want === 1 && (gapAhead || spikeAhead)) {
    if (gapAhead && flyerAhead) want = 0;
    else jump = true;
  }
  let foe = false;
  for (const e of f.enemies) {
    const s = enemyStats(e.kind, room.level);
    const ex = px(e.x);
    const ey = px(e.y);
    const front =
      f.facing > 0
        ? ex - (center + px(PHYSICS.width) / 2)
        : center - px(PHYSICS.width) / 2 - (ex + s.width);
    if (
      front < reach - 4 &&
      front > -s.width &&
      ey < feet + 4 &&
      ey + s.height > feet - 56
    )
      foe = true;
  }
  if (foe) {
    if (f.cooldown === 0) controls.push({ kind: "attack" });
    if (f.riding < 0 && f.grounded) want = 0;
  }
  if (want !== f.axis) {
    controls.push({ kind: "move", axis: want });
  }
  if (jump) controls.push({ kind: "jump" });
  return controls;
}

// One short lookahead covers a swing and most of a jump.
const combatWindowTicks = 38;
type Maneuver = {
  axis: -1 | 0 | 1;
  jump?: boolean;
  face?: -1 | 1;
  stopAfter?: number;
};
const combatManeuvers: readonly Maneuver[] = [
  { axis: 0, face: 1 },
  { axis: 0, face: -1 },
  { axis: 0, face: 1, jump: true },
  { axis: 0, face: -1, jump: true },
  { axis: 1, jump: true },
  { axis: -1, jump: true },
  { axis: 1 },
  { axis: -1, stopAfter: 12, face: 1 },
];

function combatMove(
  f: DungeonFrame,
  move: Maneuver,
  elapsed: number,
): Control[] {
  const controls: Control[] = [];
  const stopped = move.stopAfter !== undefined && elapsed >= move.stopAfter;
  const axis =
    stopped || move.axis === 0
      ? move.face !== undefined && f.facing !== move.face
        ? move.face
        : 0
      : move.axis;
  if (f.axis !== axis) controls.push({ kind: "move", axis });
  if (elapsed === 0 && move.jump) controls.push({ kind: "jump" });
  if (f.cooldown <= 1) controls.push({ kind: "attack" });
  return controls;
}

function trial(
  start: DungeonFrame,
  room: DungeonRoom,
  cat: CatId,
  rules: DungeonRules,
  goal: number,
  gate: number,
  rate: number,
  maneuver?: Maneuver,
): { frame: DungeonFrame; inputs: DungeonInput[]; rate: number } {
  let frame = start;
  const inputs: DungeonInput[] = [];
  for (
    let i = 0;
    i < combatWindowTicks &&
    !roomOver(frame) &&
    nearbyGate(frame, room) !== gate;
    i++
  ) {
    if (frame.tick % PHYSICS.ticksPerSecond === 0) rate = 0;
    const actions = (
      maneuver
        ? combatMove(frame, maneuver, i)
        : routeControls(frame, room, WARRIORS[cat].reach, goal)
    ).slice(0, PHYSICS.maxInputsPerSecond - rate);
    rate += actions.length;
    for (const action of actions) inputs.push({ tick: frame.tick + 1, action });
    frame = stepRoom(frame, room, cat, rules, actions);
  }
  return { frame, inputs, rate };
}

function stableGround(room: DungeonRoom, x: number) {
  return room.surfaces.some((s) => !s.floating && surfaceAt(s, x) !== null);
}

function score(
  before: DungeonFrame,
  frame: DungeonFrame,
  room: DungeonRoom,
  goal: number,
  gate: number,
) {
  if (nearbyGate(frame, room) === gate) return 10000;
  if (roomOver(frame)) return -10000;
  const progress = Math.abs(goal - px(before.x)) - Math.abs(goal - px(frame.x));
  let damage = 0;
  for (const target of before.enemies) {
    const remaining =
      frame.enemies.find((enemy) => enemy.id === target.id)?.hp ?? 0;
    damage += (target.hp - remaining) * (target.kind === "warden" ? 3 : 0.9);
  }
  const unsupported =
    frame.riding < 0 && !stableGround(room, frame.x + PHYSICS.width / 2);
  return (
    -(unsupported ? 180 : 0) +
    progress * 0.52 +
    (frame.hp - before.hp) * 12 +
    damage -
    (frame.resets - before.resets) * 130 +
    (frame.hourglass && !before.hourglass ? 45 : 0)
  );
}

// Turns a single visible fight into a short, deterministic sequence of
// ordinary controls, leaving ledge and platform navigation to the route.
function traceRoute(
  room: DungeonRoom,
  cat: CatId,
  rules: DungeonRules,
  gate: number,
  landingClearance: number,
): { frame: DungeonFrame; inputs: DungeonInput[] } {
  let frame = initialFrame(room, cat),
    rate = 0;
  const inputs: DungeonInput[] = [];
  const goal = room.gates[gate]?.x;
  if (goal === undefined) throw new Error("NO_GATE");
  while (
    frame.tick < PHYSICS.maxRoomTicks &&
    !roomOver(frame) &&
    nearbyGate(frame, room) !== gate
  ) {
    const center = px(frame.x + PHYSICS.width / 2);
    const nearMover = room.movers.some(
      (m) =>
        center >= m.x - 34 &&
        center < m.x + m.span + m.width + landingClearance,
    );
    const close =
      !nearMover &&
      frame.grounded &&
      frame.riding < 0 &&
      frame.enemies.some(
        (enemy) =>
          Math.abs(enemy.x - frame.x) < 120 * 256 &&
          Math.abs(enemy.y - frame.y) < 105 * 256,
      );
    if (close) {
      let best = trial(frame, room, cat, rules, goal, gate, rate);
      let points = score(frame, best.frame, room, goal, gate);
      for (const maneuver of combatManeuvers) {
        const span =
          (maneuver.stopAfter ?? combatWindowTicks) * PHYSICS.speed * 1.1;
        if (
          maneuver.axis !== 0 &&
          !Array.from({ length: 6 }, (_, step) =>
            stableGround(
              room,
              frame.x +
                PHYSICS.width / 2 +
                (maneuver.axis * span * (step + 1)) / 6,
            ),
          ).every(Boolean)
        )
          continue;
        const candidate = trial(
          frame,
          room,
          cat,
          rules,
          goal,
          gate,
          rate,
          maneuver,
        );
        const value = score(frame, candidate.frame, room, goal, gate) - 0.01;
        if (value > points) {
          points = value;
          best = candidate;
        }
      }
      frame = best.frame;
      rate = best.rate;
      inputs.push(...best.inputs);
      continue;
    }
    if (frame.tick % PHYSICS.ticksPerSecond === 0) rate = 0;
    const controls = routeControls(
      frame,
      room,
      WARRIORS[cat].reach,
      goal,
    ).slice(0, PHYSICS.maxInputsPerSecond - rate);
    rate += controls.length;
    for (const action of controls)
      inputs.push({ tick: frame.tick + 1, action });
    const next = stepRoom(frame, room, cat, rules, controls);
    frame = next;
  }
  return { frame, inputs };
}

// Prefer clearing the landing before engaging. If enemies block that route,
// try fighting as soon as the cat steps onto solid ground.
export function autopilot(
  room: DungeonRoom,
  cat: CatId,
  rules: DungeonRules,
  gate: number,
) {
  const route = traceRoute(room, cat, rules, gate, 26);
  return nearbyGate(route.frame, room) === gate
    ? route
    : traceRoute(room, cat, rules, gate, 0);
}
