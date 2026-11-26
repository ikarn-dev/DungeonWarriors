import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { enemyStats } from "../../../../../apps/web/lib/dungeon/enemies";
import {
  difficulty,
  generateRoom,
  roomTimeMs,
} from "../../../../../apps/web/lib/dungeon/generate";
import {
  DungeonRunner,
  replayRoom,
} from "../../../../../apps/web/lib/dungeon/replay";
import type { DungeonRoom } from "../../../../../apps/web/lib/dungeon/rooms";
import {
  affordableDepth,
  DUNGEON_V3,
  dungeonRulesSchema,
  LEGACY_DUNGEON_ENGINE_HASH,
  PHYSICS,
  payout,
} from "../../../../../apps/web/lib/dungeon/rules";
import {
  budgetMs,
  type DungeonFrame,
  initialFrame,
  nearbyGate,
  SWING_TICKS,
  stepRoom,
  wardensLeft,
} from "../../../../../apps/web/lib/dungeon/simulation";
import type { CatId } from "../../../../../apps/web/lib/game/catalog";
import { autopilot } from "./autopilot";

const CATS: readonly CatId[] = ["collector", "acrobat", "guardian", "sprinter"];
const seed = (label: string) =>
  createHash("sha256").update(label).digest("hex");
const run = (
  room: DungeonRoom,
  cat: CatId,
  frame: DungeonFrame,
  ticks: number,
  controls: Parameters<typeof stepRoom>[4] = [],
) => {
  let f = stepRoom(frame, room, cat, DUNGEON_V3, controls);
  for (let i = 1; i < ticks; i++) f = stepRoom(f, room, cat, DUNGEON_V3, []);
  return f;
};

describe("generated catacomb rooms", () => {
  it("generates identical rooms from a seed and different rooms from others", () => {
    expect(generateRoom(seed("a"), 2)).toEqual(generateRoom(seed("a"), 2));
    expect(generateRoom(seed("a"), 2)).not.toEqual(generateRoom(seed("b"), 2));
  });
  it("gets longer, busier, tougher and bigger with each room", () => {
    const rooms = [0, 1, 2, 3, 4].map((i) => generateRoom(seed("ramp"), i));
    for (let i = 1; i < rooms.length; i++) {
      const a = difficulty(i);
      const b = difficulty(i + 1);
      expect(b.segments).toBeGreaterThan(a.segments);
      expect(b.spawnEvery).toBeLessThan(a.spawnEvery);
      expect(enemyStats("skeleton", i + 1).height).toBeGreaterThan(
        enemyStats("skeleton", i).height,
      );
      expect(enemyStats("warden", i + 1).hp).toBeGreaterThan(
        enemyStats("warden", i).hp,
      );
      expect(rooms[i]?.spawners.length).toBeGreaterThanOrEqual(
        rooms[i - 1]?.spawners.length ?? 0,
      );
    }
    expect(rooms[0]?.ambushes).toHaveLength(0);
    expect(rooms[4]?.ambushes.length).toBeGreaterThan(0);
    expect(rooms[4]?.wardens.length).toBeGreaterThan(
      rooms[0]?.wardens.length ?? 0,
    );
  });
  it("gives harder rooms more time, never below the onchain minimum or above the cap", () => {
    for (let s = 0; s < 8; s++) {
      const times = [0, 1, 2, 3, 4].map((i) =>
        roomTimeMs(generateRoom(seed(`t${s}`), i), DUNGEON_V3),
      );
      times.forEach((ms, i) => {
        expect(ms).toBeGreaterThanOrEqual(
          (DUNGEON_V3.roomSeconds[i] ?? 0) * 1000,
        );
        expect(ms).toBeLessThanOrEqual(PHYSICS.maxRoomMs);
        expect(ms % 1000).toBe(0);
      });
      expect(times[4]).toBeGreaterThan(times[0] ?? 0);
    }
  });
});

describe("warrior combat", () => {
  const room = generateRoom(seed("combat"), 0);
  const warden = (f: DungeonFrame) => {
    const w = f.enemies.find((e) => e.kind === "warden");
    if (!w) throw new Error("no warden");
    return w;
  };
  const besideWarden = (cat: CatId): DungeonFrame => {
    const f = initialFrame(room, cat);
    const w = warden(f);
    return {
      ...f,
      x: w.x - PHYSICS.width - 8 * 256,
      y: (room.gates[0]?.y ?? 464) * 256 - PHYSICS.height,
    };
  };
  it("seals the gates until every warden is defeated", () => {
    const f = initialFrame(room, "sprinter");
    expect(wardensLeft(f)).toBe(1);
    const gate = room.gates[0];
    if (!gate) throw new Error("no gate");
    const atGate = {
      ...f,
      x: gate.x * 256 - PHYSICS.width / 2,
      y: gate.y * 256 - PHYSICS.height,
    };
    expect(nearbyGate(atGate, room)).toBeNull();
    expect(nearbyGate({ ...atGate, enemies: [] }, room)).toBe(0);
  });
  it("damages the nearest foe once per swing on the hit tick", () => {
    const f = besideWarden("sprinter");
    const hp = warden(f).hp;
    const swung = run(room, "sprinter", f, SWING_TICKS, [{ kind: "attack" }]);
    expect(warden(swung).hp).toBe(hp - (18 - enemyStats("warden", 1).def));
    const again = run(room, "sprinter", swung, 2, [{ kind: "attack" }]);
    expect(warden(again).hp).toBe(warden(swung).hp);
  });
  it("lets Bastion's iron shell take less damage than Rosie", () => {
    const hits = (cat: CatId) => {
      const f = besideWarden(cat);
      const w = warden(f);
      const touching = { ...f, x: w.x };
      return f.hp - run(room, cat, touching, 1).hp;
    };
    expect(hits("guardian")).toBeLessThan(hits("acrobat"));
  });
  it("blocks Pip's first hit with Steady Shield", () => {
    const f = besideWarden("collector");
    const touching = { ...f, x: warden(f).x };
    const hit = run(room, "collector", touching, 1);
    expect(hit.hp).toBe(f.hp);
    expect(hit.shield).toBe(false);
  });
  it("ends the room when a cat loses all its health", () => {
    const f = besideWarden("acrobat");
    const touching = { ...f, x: warden(f).x, hp: 1 };
    const out = run(room, "acrobat", touching, 1);
    expect(out.fallen).toBe(true);
    expect(out.knockouts).toBe(1);
    expect(out.hp).toBe(0);
    expect(out.resets).toBe(f.resets);
    expect(out.timedOut).toBe(false);
    // Nothing moves afterwards and no gate can be entered.
    expect(run(room, "acrobat", out, 30)).toBe(out);
    expect(nearbyGate(out, room)).toBeNull();
  });
  it("replays old expeditions with their original knockout and preserves HP after a new pit fall", () => {
    const legacy = dungeonRulesSchema.parse({
      ...DUNGEON_V3,
      version: 2,
      engineHash: [...Buffer.from(LEGACY_DUNGEON_ENGINE_HASH, "hex")],
    });
    expect(
      dungeonRulesSchema.safeParse({ ...legacy, version: 3 }).success,
    ).toBe(false);
    const f = besideWarden("acrobat");
    const knockedOut = stepRoom(
      { ...f, x: warden(f).x, hp: 1 },
      room,
      "acrobat",
      legacy,
      [],
    );
    expect(knockedOut).toMatchObject({
      fallen: false,
      hp: f.hp,
      knockouts: 1,
      resets: f.resets + 1,
    });
    const reset = stepRoom(
      { ...f, y: (room.height + 65) * 256, hp: 11 },
      room,
      "acrobat",
      DUNGEON_V3,
      [],
    );
    expect(reset).toMatchObject({
      tick: f.tick + 1,
      fallen: false,
      hp: 11,
      resets: f.resets + 1,
    });
  });
});

describe("base-control routes", () => {
  // 5 rooms × 4 cats × 6 seeds; each run replays its own inputs.
  const seeds = [0, 1, 2, 3, 4, 5].map((i) => seed(`route-${i}`));
  it.each(
    [0, 1, 2, 3, 4].flatMap((index) =>
      CATS.flatMap((cat) => seeds.map((s, n) => ({ index, cat, s, n }))),
    ),
  )("room $index seed $n: $cat fights through to the far gate with time left", ({
    index,
    cat,
    s,
  }) => {
    const room = generateRoom(s, index);
    const { frame, inputs } = autopilot(room, cat, DUNGEON_V3, 2);
    const budget = budgetMs(frame, room, cat, DUNGEON_V3);
    const used = (frame.tick * 1000) / PHYSICS.ticksPerSecond;
    const detail = JSON.stringify({
      index,
      cat,
      tick: frame.tick,
      x: frame.x / 256,
      resets: frame.resets,
      knockouts: frame.knockouts,
      wardens: wardensLeft(frame),
      budget,
    });
    expect(nearbyGate(frame, room), detail).toBe(2);
    expect(frame.timedOut, detail).toBe(false);
    expect(frame.fallen, detail).toBe(false);
    // The autopilot stops to fight every foe, so it is slower than a player
    // who jumps past optional ones; it must still finish with time left.
    expect(used, detail).toBeLessThan(budget * 0.97);
    expect(replayRoom(room, cat, DUNGEON_V3, frame.tick, inputs)).toEqual(
      frame,
    );
  });
});

describe("replay limits", () => {
  it("replays browser input identically and rejects reordered, future or excessive input", () => {
    const runner = new DungeonRunner("acrobat", 0, seed("r"), DUNGEON_V3, 1000);
    runner.input({ kind: "move", axis: 1 });
    runner.advance(1400);
    runner.input({ kind: "attack" });
    runner.input({ kind: "jump" });
    runner.advance(1900);
    expect(
      replayRoom(
        runner.room,
        "acrobat",
        DUNGEON_V3,
        runner.frame.tick,
        runner.inputs,
      ),
    ).toEqual(runner.frame);
    expect(() =>
      replayRoom(runner.room, "acrobat", DUNGEON_V3, 1, [
        { tick: 2, action: { kind: "jump" } },
      ]),
    ).toThrow("INVALID_DUNGEON_INPUT_ORDER");
    expect(() =>
      replayRoom(
        runner.room,
        "acrobat",
        DUNGEON_V3,
        1,
        Array.from({ length: 21 }, () => ({
          tick: 1,
          action: { kind: "attack" },
        })),
      ),
    ).toThrow("DUNGEON_CONTROL_RATE");
  });
  it("drops held-key inputs over the per-second limit in the browser", () => {
    const runner = new DungeonRunner("acrobat", 0, seed("h"), DUNGEON_V3, 0);
    for (let i = 0; i < 40; i++) runner.input({ kind: "attack" });
    expect(runner.inputs).toHaveLength(PHYSICS.maxInputsPerSecond);
  });
  it("only Acrobat can double jump", () => {
    const room = generateRoom(seed("j"), 0);
    for (const cat of ["collector", "acrobat"] as const) {
      let f = run(room, cat, initialFrame(room, cat), 10, [{ kind: "jump" }]);
      const before = f.vy;
      f = stepRoom(f, room, cat, DUNGEON_V3, [{ kind: "jump" }]);
      expect(f.jumps).toBe(cat === "acrobat" ? 2 : 1);
      expect(f.vy < before).toBe(cat === "acrobat");
    }
  });
  it("quotes integer gross returns and never reserves above the vault cap", () => {
    expect([1, 2, 3, 4, 5].map((n) => payout(1000000n, n, DUNGEON_V3))).toEqual(
      [1425000n, 2137500n, 3206250n, 4809375n, 7214062n],
    );
    expect(affordableDepth(1000000n, 4000000n, DUNGEON_V3)).toBe(3);
    expect(affordableDepth(1000000n, 1000000n, DUNGEON_V3)).toBe(0);
  });
});
