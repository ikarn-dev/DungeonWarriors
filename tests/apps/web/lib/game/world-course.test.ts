import { describe, expect, it } from "vitest";
import { catStats } from "../../../../../apps/web/lib/game/catalog";
import type { PlayerIntent } from "../../../../../apps/web/lib/game/protocol";
import {
  COURSE_MAX_GAP_SUBPIXELS,
  minimumPlatformGap,
  RULES_V4,
} from "../../../../../apps/web/lib/game/rules";
import { surfaceAt } from "../../../../../apps/web/lib/game/simulation-collision";
import {
  initializeWorld,
  stepWorld,
} from "../../../../../apps/web/lib/game/world";
import { priceTargetY } from "../../../../../apps/web/lib/game/world-course";
import type { WorldState } from "../../../../../apps/web/lib/game/world-state";
import { frame } from "./simulation-fixtures";

const rules = RULES_V4;
const width = rules.generation.segmentWidthSubpixels;
const price = (bps: bigint) => ({
  previousPrice: 1_000_000n,
  previousExponent: -2,
  price: 1_000_000n + bps * 100n,
  exponent: -2,
});
function start(
  bps = 0n,
  cat: "collector" | "acrobat" | "guardian" | "sprinter" = "collector",
) {
  const f = frame();
  f.runner.ySubpixels =
    (rules.physics.viewportHeightPixels * 256) / 2 -
    rules.physics.hitboxHeightSubpixels;
  return initializeWorld(f, catStats(cat, 1), price(bps), rules);
}
const ramps = (world: WorldState) =>
  world.entities
    .filter((e) => e.kind === "ramp")
    .sort((a, b) => a.xSubpixels - b.xSubpixels);

// Base-control autopilot: jump just before a pit edge or a spike.
function pilot(world: WorldState): PlayerIntent[] {
  const r = world.frame.runner;
  if (!r.grounded) return [];
  const front = r.xSubpixels + rules.physics.hitboxWidthSubpixels;
  const reach = r.automaticSpeedSubpixelsPerTick * 6;
  const spike = world.entities.some(
    (e) =>
      e.kind === "hazard" &&
      e.xSubpixels >= front &&
      e.xSubpixels - front <= r.automaticSpeedSubpixelsPerTick * 5,
  );
  const edge = ramps(world).some((tile, index, all) => {
    const end = tile.xSubpixels + tile.widthSubpixels;
    const next = all[index + 1];
    return (
      next !== undefined &&
      next.xSubpixels > end &&
      end >= front - reach &&
      end - front <= reach
    );
  });
  return spike || edge ? [{ kind: "jump" }] : [];
}

describe("rules v4 price course", () => {
  it("raises the ground on a rally and lowers it on a sell-off", () => {
    const mid = (rules.physics.viewportHeightPixels * 256) / 2;
    expect(priceTargetY(price(0n), rules)).toBe(mid);
    expect(priceTargetY(price(10n), rules)).toBeLessThan(mid);
    expect(priceTargetY(price(-10n), rules)).toBeGreaterThan(mid);
    // Large moves saturate within the walkable band.
    expect(priceTargetY(price(100_000n), rules)).toBeGreaterThan(
      (rules.physics.viewportHeightPixels * 256) / 4,
    );
  });

  it.each([
    "collector",
    "acrobat",
    "guardian",
    "sprinter",
  ] as const)("%s clears pits and spikes with base controls through level 10", (cat) => {
    let world = start(0n, cat);
    const stats = catStats(cat, 1);
    let pits = 0;
    let spikes = 0;
    const seen = new Set<bigint>();
    for (let tick = 0; tick < 6000 && world.frame.phase === "active"; tick++) {
      const move = BigInt(Math.trunc(Math.sin(tick / 120) * 20));
      world = stepWorld(world, stats, pilot(world), price(move), rules);
      const track = ramps(world);
      track.forEach((tile, index) => {
        if (seen.has(tile.id)) return;
        seen.add(tile.id);
        const next = track[index + 1];
        const gap = width - tile.widthSubpixels;
        if (gap > 0) {
          pits++;
          expect(gap).toBeGreaterThanOrEqual(minimumPlatformGap(rules));
          expect(gap).toBeLessThanOrEqual(COURSE_MAX_GAP_SUBPIXELS);
          if (next) expect(next.widthSubpixels).toBe(width);
          if (next)
            expect(next.ySubpixels).toBe(
              surfaceAt(tile, tile.xSubpixels + tile.widthSubpixels),
            );
        }
      });
      spikes = Math.max(
        spikes,
        world.entities.filter((e) => e.kind === "hazard").length,
      );
    }
    expect(pits).toBeGreaterThan(0);
    expect(spikes).toBeGreaterThan(0);
    expect(world.frame.terminalReason).toBeNull();
    expect(world.frame.activeTicks).toBe(6000n);
  });

  it("follows the price: a steady rally climbs above a flat run", () => {
    const stats = catStats("collector", 1);
    let flat = start();
    let rally = start();
    for (let tick = 0; tick < 240; tick++) {
      flat = stepWorld(flat, stats, pilot(flat), price(0n), rules);
      rally = stepWorld(rally, stats, pilot(rally), price(30n), rules);
    }
    expect(rally.generation.surfaceYSubpixels).toBeLessThan(
      flat.generation.surfaceYSubpixels,
    );
  });

  it("generates the same course for the same price history", () => {
    const stats = catStats("collector", 1);
    let a = start();
    let b = start();
    for (let tick = 0; tick < 600; tick++) {
      a = stepWorld(a, stats, pilot(a), price(BigInt(tick % 7)), rules);
      b = stepWorld(b, stats, pilot(b), price(BigInt(tick % 7)), rules);
    }
    expect(a).toEqual(b);
  });
});
