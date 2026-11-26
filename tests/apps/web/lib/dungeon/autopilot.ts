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
// A simple player using only Move, Jump and Attack: walk right, time each
// moving platform at its dwell, jump gaps and spikes, and stand and swing at
// any foe within reach.
export function autopilot(
  room: DungeonRoom,
  cat: CatId,
  rules: DungeonRules,
  gate: number,
  onStep?: (before: DungeonFrame, after: DungeonFrame) => void,
): { frame: DungeonFrame; inputs: DungeonInput[] } {
  let f = initialFrame(room, cat);
  const inputs: DungeonInput[] = [];
  let axis: -1 | 0 | 1 = 0;
  const target = room.gates[gate];
  if (!target) throw new Error("NO_GATE");
  const reach = WARRIORS[cat].reach;
  while (
    f.tick < PHYSICS.maxRoomTicks &&
    !roomOver(f) &&
    nearbyGate(f, room) !== gate
  ) {
    const controls: Control[] = [];
    const center = px(f.x) + px(PHYSICS.width) / 2;
    const feet = px(f.y) + px(PHYSICS.height);
    let want: -1 | 0 | 1 =
      center < target.x - 4 ? 1 : center > target.x + 4 ? -1 : 0;
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
      } else if (
        center >= start &&
        center < end &&
        !f.grounded &&
        f.riding < 0
      ) {
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
      (e) =>
        e.kind === "bat" && px(e.x) > center - 40 && px(e.x) < center + 150,
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
    if (want !== axis) {
      axis = want;
      controls.push({ kind: "move", axis });
    }
    if (jump) controls.push({ kind: "jump" });
    for (const action of controls) inputs.push({ tick, action });
    const next = stepRoom(f, room, cat, rules, controls);
    onStep?.(f, next);
    f = next;
  }
  return { frame: f, inputs };
}
