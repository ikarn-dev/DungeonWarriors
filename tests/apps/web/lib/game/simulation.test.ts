import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { catStats } from "../../../../../apps/web/lib/game/catalog";
import type { PlayerIntent } from "../../../../../apps/web/lib/game/protocol";
import {
  RULES_V2,
  speedBps,
  U64_MAX,
} from "../../../../../apps/web/lib/game/rules";
import { step } from "../../../../../apps/web/lib/game/simulation";
import type { WorldEntity } from "../../../../../apps/web/lib/game/simulation-state";

import { entity, floor, frame } from "./simulation-fixtures";

it("uses the v2 native double jump once and keeps increasing speed beyond 1.8×", () => {
  const stats = catStats("acrobat", 1);
  const terrain = [floor()];
  const jump = { kind: "jump" } as const;
  const first = step(frame(), terrain, stats, [jump, jump], RULES_V2).frame;
  expect(first.powers.doubleJump.readyAtTick).toBe(0n);
  const second = step(first, terrain, stats, [jump], RULES_V2).frame;
  expect(second.runner.vySubpixelsPerTick).toBe(
    first.runner.vySubpixelsPerTick,
  );
  expect(second.powers.doubleJump.charges).toBe(0);
  expect(second.powers.doubleJump.readyAtTick).toBeGreaterThan(
    second.activeTicks,
  );
  expect(
    step(second, terrain, stats, [jump], RULES_V2).frame.runner
      .vySubpixelsPerTick,
  ).toBeGreaterThan(second.runner.vySubpixelsPerTick);
  expect(speedBps(14n * 600n, RULES_V2)).toBe(26_800);
  expect(speedBps(16n * 600n, RULES_V2)).toBe(29_200);
  expect(speedBps(U64_MAX, RULES_V2)).toBe(31_600);
});

it("matches Rust's shared motion trace after every step", () => {
  const rows = readFileSync(
    new URL("../../../../fixtures/game-v1/motion.csv", import.meta.url),
    "utf8",
  )
    .trim()
    .split("\n")
    .slice(1);
  let name = "";
  let f = frame();
  let world: WorldEntity[] = [floor()];
  for (const row of rows) {
    const p = row.split(",");
    if (name !== p[0]) {
      name = p[0] ?? "";
      f = frame();
      world = [floor()];
    }
    const actions: PlayerIntent[] =
      p[2] === "jump"
        ? [{ kind: "jump" }]
        : p[2] === "dash"
          ? [{ kind: "dash" }]
          : p[2] === "boost_jump"
            ? [{ kind: "boost" }, { kind: "jump" }]
            : [];
    const result = step(
      f,
      world,
      catStats(name === "double" ? "acrobat" : "collector", 1),
      actions,
    );
    f = result.frame;
    world = result.entities;
    expect(f.activeTicks).toBe(BigInt(p[1] ?? ""));
    expect([
      f.runner.xSubpixels,
      f.runner.ySubpixels,
      f.runner.vxSubpixelsPerTick,
      f.runner.vySubpixelsPerTick,
    ]).toEqual(p.slice(3, 7).map(Number));
    expect(f.runner.grounded).toBe(p[7] === "true");
  }
});

it("resolves walls, ceilings and landing before hazards, without endpoint-only checks", () => {
  const stats = catStats("collector", 1);
  expect(
    step(
      frame(),
      [floor(), entity(2n, "terrain", 6500, -100, 100, 8000)],
      stats,
      [],
    ).frame.runner.xSubpixels,
  ).toBe(356);
  expect(
    step(
      frame(),
      [floor(), entity(2n, "terrain", -5000, -800, 20000, 100)],
      stats,
      [{ kind: "jump" }],
    ).frame.runner.ySubpixels,
  ).toBe(-700);
  const falling = frame();
  falling.runner.vySubpixelsPerTick = 4000;
  falling.runner.grounded = false;
  expect(step(falling, [floor()], stats, []).frame.runner.ySubpixels).toBe(0);
});

it("stops at the first terminal and does not award a pickup after a crash", () => {
  const stats = catStats("collector", 1);
  const result = step(
    frame(),
    [
      floor(),
      entity(2n, "hazard", 6500, 0, 100, 7000),
      entity(3n, "coin", 3000, 3000, 100, 100),
    ],
    stats,
    [],
  );
  expect(result.frame.terminalReason).toBe("crash");
  expect(result.frame.score).toBe(0n);
  const f = frame();
  f.qualifiedCheckpoints = 1n;
  expect(
    step(f, [floor()], stats, [{ kind: "cashOut" }, { kind: "jump" }]).frame
      .activeTicks,
  ).toBe(0n);
  expect(
    step(frame(), [floor()], stats, [{ kind: "cashOut" }]).frame.phase,
  ).toBe("active");
});

it("uses every cat/level cooldown and exclusive expiry", () => {
  for (const cat of ["collector", "acrobat", "guardian", "sprinter"] as const) {
    for (let level = 1; level <= 5; level++) {
      const stats = catStats(cat, level);
      const f = step(frame(), [floor()], stats, [{ kind: "boost" }]).frame;
      expect(f.powers[stats.power].readyAtTick).toBe(
        1n + BigInt(stats.powerCooldownTicks),
      );
    }
  }
  const f = frame();
  f.activeTicks = 179n;
  f.runner.grounded = false;
  f.powers.doubleJump = { charges: 1, endsAtTick: 180n, readyAtTick: 0n };
  expect(
    step(f, [], catStats("acrobat", 1), [{ kind: "jump" }]).frame.runner
      .vySubpixelsPerTick,
  ).toBe(128);
});

it("grants contact immunity, caps booster refresh and consumes a bypass dash", () => {
  const f = step(
    frame(),
    [floor(), entity(2n, "hazard", 0, 0, 100, 100)],
    catStats("guardian", 1),
    [{ kind: "boost" }],
  ).frame;
  expect(f.terminalReason).toBeNull();
  expect(f.runner.shieldContactEndsAtTick).toBe(19n);
  const armed = frame();
  armed.powers.shield.endsAtTick = 500n;
  const booster: WorldEntity = {
    ...entity(2n, "coin", 3000, 3000, 100, 100),
    kind: "booster",
    power: "shield",
  };
  expect(
    step(armed, [floor(), booster], catStats("guardian", 1), []).frame.powers
      .shield.endsAtTick,
  ).toBe(181n);
  const dash = frame();
  dash.runner.dashReadyAtTick = 100n;
  expect(
    step(dash, [floor()], catStats("sprinter", 1), [
      { kind: "boost" },
      { kind: "dash" },
    ]).frame.powers.extraDash.charges,
  ).toBe(0);
});

it("qualifies at the boundary, rejects carryover, and preserves inputs on overflow", () => {
  const f = frame();
  f.activeTicks = 599n;
  f.designatedCoinMask = 3;
  const coin = entity(2n, "coin", 2000, 3000, 100, 100);
  coin.designatedCoin = 2;
  const next = step(f, [floor(), coin], catStats("collector", 1), []).frame;
  expect(next.qualifiedCheckpoints).toBe(1n);
  expect(next.designatedCoinMask).toBe(0);
  expect(
    step(next, [floor(), coin], catStats("collector", 1), []).frame
      .designatedCoinMask,
  ).toBe(0);
  next.score = U64_MAX;
  expect(() =>
    step(next, [floor(), coin], catStats("collector", 1), []),
  ).toThrow("NUMERIC_OVERFLOW");
  expect(next.score).toBe(U64_MAX);
});

it("freezes suspension, rejects duplicate IDs and malformed bounds", () => {
  const f = frame();
  f.phase = "suspended";
  expect(step(f, [floor()], catStats("collector", 1), []).frame).toEqual(f);
  expect(() =>
    step(f, [floor(), floor()], catStats("collector", 1), []),
  ).toThrow("INVALID_WORLD");
  expect(() =>
    step(f, [entity(2n, "coin", NaN, 0, 1, 1)], catStats("collector", 1), []),
  ).toThrow("INVALID_WORLD");
});
