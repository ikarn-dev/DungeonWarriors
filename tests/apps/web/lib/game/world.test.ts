import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { type CatId, catStats } from "../../../../../apps/web/lib/game/catalog";
import { grossPayout } from "../../../../../apps/web/lib/game/economy";
import {
  RULES_V1,
  RULES_V2,
  RULES_V3,
  runLevel,
  U64_MAX,
} from "../../../../../apps/web/lib/game/rules";
import { step } from "../../../../../apps/web/lib/game/simulation";
import {
  advanceWorld,
  initializeWorld,
  stepWorld,
} from "../../../../../apps/web/lib/game/world";
import { entity, frame } from "./simulation-fixtures";
import { baseControl, initialWorld, sample, worldHash } from "./world-fixtures";

const cats: CatId[] = ["collector", "acrobat", "guardian", "sprinter"];
it("renders the v2 quiet-market obstacle and maps small price changes to signed slopes", () => {
  const stats = catStats("acrobat", 1);
  const start = initialWorld("acrobat", 1, 0n).frame;
  for (const change of [0n, 1n, -1n]) {
    const world = initializeWorld(start, stats, sample(change), RULES_V2);
    expect(
      world.entities.filter((entity) => entity.kind === "hazard"),
    ).toHaveLength(1);
    const ramp = world.entities.find(
      (entity) => entity.kind === "ramp" && entity.riseSubpixels !== 0,
    );
    if (change === 0n) expect(ramp).toBeUndefined();
    else expect(ramp).toMatchObject({ riseSubpixels: Number(-change * 307n) });
  }
});
it("uses live price direction for v3 platforms and records a missed gap as a loss", () => {
  const stats = catStats("collector", 1);
  const start = initialWorld().frame;
  const rules = RULES_V3;
  for (const change of [1n, -1n]) {
    const world = initializeWorld(start, stats, sample(change), rules);
    expect(world.entities).toContainEqual(
      expect.objectContaining({
        kind: "ramp",
        riseSubpixels: Number(-change * 1536n),
      }),
    );
    expect(world.entities).toContainEqual(
      expect.objectContaining({
        kind: "ramp",
        widthSubpixels: rules.generation.segmentWidthSubpixels - 41 * 256,
      }),
    );
  }

  const initial = initializeWorld(start, stats, sample(), rules);
  const gap = initial.entities.find(
    (e) =>
      e.kind === "ramp" &&
      e.widthSubpixels < rules.generation.segmentWidthSubpixels,
  );
  if (!gap) throw new Error("No gap in the opening course");
  let falling = initial;
  let jumping = initial;
  for (let tick = 0; tick < rules.checkpointTicks; tick++) {
    if (falling.frame.phase === "active")
      falling = stepWorld(falling, stats, [], sample(), rules);
    const runner = jumping.frame.runner;
    const takeoff = jumping.entities.some((e) => {
      const edge = e.xSubpixels + e.widthSubpixels;
      const distance =
        edge - runner.xSubpixels - rules.physics.hitboxWidthSubpixels;
      return (
        e.kind === "ramp" &&
        e.widthSubpixels < rules.generation.segmentWidthSubpixels &&
        distance >= 0 &&
        distance <= rules.physics.minLandingWidthSubpixels
      );
    });
    const jump = runner.grounded && takeoff;
    jumping = stepWorld(
      jumping,
      stats,
      jump ? [{ kind: "jump" }] : [],
      sample(),
      rules,
    );
  }
  expect(falling.frame.terminalReason).toBe("crash");
  expect(falling.frame.runner.ySubpixels).toBeGreaterThanOrEqual(540 * 256);
  expect(jumping.frame.phase).toBe("active");
  expect(jumping.frame.qualifiedCheckpoints).toBe(1n);
});

it("replays a price-synced course across browser frame boundaries without chain snapshots", () => {
  const stats = catStats("collector", 1);
  const rules = RULES_V3;
  const start = initializeWorld(initialWorld().frame, stats, sample(), rules);
  const first = sample(1n);
  const second = sample(-1n);
  const intents = [{ tick: 108n, action: { kind: "jump" as const } }];

  const uphill = advanceWorld(start, stats, intents, first, rules, 60);
  const downhill = advanceWorld(
    uphill.world,
    stats,
    intents,
    second,
    rules,
    60,
  );
  const at90 = advanceWorld(uphill.world, stats, intents, second, rules, 30);
  const at120 = advanceWorld(at90.world, stats, intents, second, rules, 30);

  expect(downhill).toEqual(at120);
  expect(uphill.world.frame.activeTicks).toBe(60n);
  expect(downhill.world.frame.activeTicks).toBe(120n);
  expect(downhill.world.frame.runner.grounded).toBe(false);
  expect(start.frame.activeTicks).toBe(0n);
});

it("matches independent signed ramp-contact and jump cases", () => {
  const rows = readFileSync(
    new URL("../../../../fixtures/game-v1/ramps.csv", import.meta.url),
    "utf8",
  )
    .trim()
    .split("\n")
    .slice(1);
  let f = frame();
  let previous = "";
  for (const row of rows) {
    const p = row.split(",");
    expect(p).toHaveLength(10);
    if (previous !== p[0]) {
      f = frame();
      f.runner.ySubpixels = Number(p[4]);
      previous = p[0] ?? "";
    }
    const tile = {
      ...entity(0n, "terrain", 0, 60000, 32768, 7168),
      kind: "ramp" as const,
      riseSubpixels: Number(p[3]),
    };
    f = step(
      f,
      [tile],
      catStats("collector", 1),
      p[2] === "jump" ? [{ kind: "jump" }] : [],
    ).frame;
    expect(f.activeTicks).toBe(BigInt(p[1] ?? ""));
    expect([
      f.runner.xSubpixels,
      f.runner.ySubpixels,
      f.runner.vxSubpixelsPerTick,
      f.runner.vySubpixelsPerTick,
    ]).toEqual(p.slice(5, 9).map(Number));
    expect(f.runner.grounded).toBe(p[9] === "true");
  }
});
const cases = cats.flatMap((cat, catIndex) =>
  Array.from({ length: 5 }, (_, level) =>
    Array.from({ length: 4 }, (_, mode) => ({
      cat,
      catIndex,
      level: level + 1,
      mode,
    })),
  ).flat(),
);
const { PURRPS_WORLD_TRACE: traceEnabled } = process.env;
const trace =
  traceEnabled === "1"
    ? readFileSync(
        new URL("../../../../.artifacts/world-parity.csv", import.meta.url),
        "utf8",
      )
        .trim()
        .split("\n")
    : null;
if (trace !== null && trace.length !== 96_000)
  throw new Error("Incomplete Rust parity trace");

it.each(
  cases,
)("proves base route and full-state parity: $cat level $level scenario $mode", ({
  cat,
  catIndex,
  level,
  mode,
}) => {
  const stats = catStats(cat, level);
  let state = initialWorld(cat, level, mode === 0 ? 0n : 1000n);
  for (let tick = 0; tick < 1200; tick++) {
    const change =
      mode === 0
        ? 0n
        : mode === 1
          ? 1000n
          : mode === 2
            ? -1000n
            : Math.trunc(tick / 31) % 2 === 0
              ? 1000n
              : -1000n;
    state = stepWorld(state, stats, baseControl(state), sample(change));
    expect(state.frame.phase).toBe("active");
    expect(state.entities.length).toBeLessThanOrEqual(
      RULES_V1.maxWorldEntities,
    );
    expect(
      Object.values(state.frame.powers).every(
        (power) => power.endsAtTick === 0n,
      ),
    ).toBe(true);
    if (tick === 599) expect(state.frame.totalCoins).toBe(5n);
    if (trace !== null) {
      const index = ((catIndex * 5 + level - 1) * 4 + mode) * 1200 + tick;
      expect(
        `${catIndex},${level},${mode},${tick + 1},${worldHash(state)}`,
      ).toBe(trace[index]);
    }
  }
  expect(state.frame.totalCoins).toBe(10n);
  expect(state.frame.qualifiedCheckpoints).toBe(2n);
  expect(state.worldOriginPixels).toBeGreaterThan(0n);
});

it("freezes suspended worlds, rejects bad data and leaves failures atomic", () => {
  const state = initialWorld();
  const before = structuredClone(state);
  const stats = catStats("collector", 1);
  const bad = { ...sample(), price: 0n };
  expect(() => stepWorld(state, stats, [], bad)).toThrow("INVALID_OBSERVATION");
  expect(state).toEqual(before);
  state.frame.phase = "suspended";
  expect(stepWorld(state, stats, [], bad)).toEqual(state);
  const overflow = initialWorld();
  overflow.nextEntityId = U64_MAX;
  overflow.frame.runner.xSubpixels +=
    RULES_V1.physics.maxVelocitySubpixelsPerTick;
  expect(() => stepWorld(overflow, stats, [], sample())).toThrow(
    "NUMERIC_OVERFLOW",
  );
});

it("keeps absolute distance and checkpoint coins correct after both caps", () => {
  const stats = catStats("sprinter", 1);
  let state = initialWorld("sprinter");
  for (let tick = 0; tick < 12600; tick++) {
    const before =
      state.worldOriginPixels * 256n + BigInt(state.frame.runner.xSubpixels);
    state = stepWorld(state, stats, [], sample());
    const after =
      state.worldOriginPixels * 256n + BigInt(state.frame.runner.xSubpixels);
    expect(after - before).toBe(BigInt(state.frame.runner.vxSubpixelsPerTick));
    expect(state.entities.length).toBeLessThanOrEqual(64);
  }
  expect(state.frame.totalCoins).toBe(105n);
  expect(state.frame.qualifiedCheckpoints).toBe(21n);
  expect(state.worldOriginPixels).toBeGreaterThan(50000n);
});

const poweredTrace =
  traceEnabled === "1"
    ? readFileSync(
        new URL(
          "../../../../.artifacts/powered-world-parity.csv",
          import.meta.url,
        ),
        "utf8",
      )
        .trim()
        .split("\n")
    : null;
if (poweredTrace !== null && poweredTrace.length !== 20)
  throw new Error("Incomplete Rust powered world trace");

it.each(
  cats.flatMap((cat, catIndex) =>
    Array.from({ length: 5 }, (_, index) => ({
      cat,
      catIndex,
      level: index + 1,
    })),
  ),
)("matches powered endless parity for $cat level $level", ({
  cat,
  catIndex,
  level,
}) => {
  const stats = catStats(cat, level);
  let state = initialWorld(cat, level);
  let digest = Buffer.alloc(32);
  const cooldown = BigInt(stats.powerCooldownTicks);
  for (let tick = 1n; tick <= 12600n; tick++) {
    state = stepWorld(state, stats, [{ kind: "boost" }], sample());
    const current = state.frame;
    if (
      current.phase !== "active" ||
      current.activeTicks !== tick ||
      current.qualifiedCheckpoints !== tick / 600n ||
      current.powers[stats.power].readyAtTick !==
        1n + ((tick - 1n) / cooldown + 1n) * cooldown
    )
      throw new Error(`Unexpected powered state at tick ${tick}`);
    if (poweredTrace !== null)
      digest = createHash("sha256")
        .update(digest)
        .update(worldHash(state))
        .digest();
  }
  expect(runLevel(state.frame.activeTicks)).toBe(22n);
  expect(grossPayout(1000000n, state.frame.qualifiedCheckpoints)).toBe(
    10000000n,
  );
  if (poweredTrace !== null) {
    expect(`${catIndex},${level},${digest.toString("hex")}`).toBe(
      poweredTrace[catIndex * 5 + level - 1],
    );
  }
});
