import { createHash } from "node:crypto";
import { type CatId, catStats } from "../../../../../apps/web/lib/game/catalog";
import type { PlayerIntent } from "../../../../../apps/web/lib/game/protocol";
import { RULES_V1 } from "../../../../../apps/web/lib/game/rules";
import { initializeWorld } from "../../../../../apps/web/lib/game/world";
import type { WorldState } from "../../../../../apps/web/lib/game/world-state";
import { frame } from "./simulation-fixtures";

export function sample(change = 0n) {
  return {
    previousPrice: 10000n,
    previousExponent: 8,
    price: 10000n + change,
    exponent: 8,
  };
}
export function initialWorld(
  cat: CatId = "collector",
  level = 1,
  change = 0n,
): WorldState {
  const f = frame();
  f.runner.ySubpixels =
    (RULES_V1.physics.viewportHeightPixels * 256) / 2 -
    RULES_V1.physics.hitboxHeightSubpixels;
  return initializeWorld(f, catStats(cat, level), sample(change));
}
export function baseControl(state: WorldState): PlayerIntent[] {
  const r = state.frame.runner;
  return r.grounded &&
    state.entities.some(
      (e) =>
        e.kind === "hazard" &&
        e.xSubpixels >= r.xSubpixels + RULES_V1.physics.hitboxWidthSubpixels &&
        e.xSubpixels - r.xSubpixels - RULES_V1.physics.hitboxWidthSubpixels <=
          r.automaticSpeedSubpixelsPerTick * 20,
    )
    ? [{ kind: "jump" }]
    : [];
}

// Independent test encoder matches the complete Rust projection's Borsh tuple.
export function worldHash(state: WorldState): string {
  const bytes = Buffer.alloc(4096);
  let offset = 0;
  const u8 = (n: number) => {
    offset = bytes.writeUInt8(n, offset);
  };
  const i32 = (n: number) => {
    offset = bytes.writeInt32LE(n, offset);
  };
  const u64 = (n: bigint) => {
    offset = bytes.writeBigUInt64LE(n, offset);
  };
  const f = state.frame;
  u8(
    [
      "ready",
      "active",
      "suspended",
      "terminalRecorded",
      "completionRequested",
    ].indexOf(f.phase),
  );
  u64(f.activeTicks);
  const r = f.runner;
  for (const n of [
    r.xSubpixels,
    r.ySubpixels,
    r.vxSubpixelsPerTick,
    r.vySubpixelsPerTick,
    r.automaticSpeedSubpixelsPerTick,
  ])
    i32(n);
  u8(Number(r.grounded));
  u8(["left", "neutral", "right"].indexOf(r.axis));
  for (const n of [
    r.dashEndsAtTick,
    r.dashReadyAtTick,
    r.shieldContactEndsAtTick,
  ])
    u64(n);
  const powers = ["magnet", "doubleJump", "shield", "extraDash"] as const;
  for (const power of powers) {
    u64(f.powers[power].readyAtTick);
    u64(f.powers[power].endsAtTick);
    u8(f.powers[power].charges);
  }
  u64(f.score);
  u64(f.totalCoins);
  u8(f.designatedCoinMask);
  u64(f.qualifiedCheckpoints);
  u8(f.terminalReason === null ? 0 : 1);
  if (f.terminalReason !== null)
    u8(
      [
        "cashOut",
        "crash",
        "autoCashOut",
        "surrender",
        "technicalAbort",
      ].indexOf(f.terminalReason),
    );
  u64(state.worldOriginPixels);
  u64(state.nextEntityId);
  const g = state.generation;
  u64(g.nextSegment);
  i32(g.nextXSubpixels);
  i32(g.surfaceYSubpixels);
  u64(g.checkpoint);
  i32(g.checkpointXSubpixels);
  i32(g.checkpointSpeedSubpixelsPerTick);
  u8(g.spawnedCoinMask);
  u8(g.spawnedHazardMask);
  offset = bytes.writeUInt32LE(state.entities.length, offset);
  for (const e of state.entities) {
    u64(e.id);
    u8(
      ["terrain", "hazard", "coin", "star", "booster", "ramp"].indexOf(e.kind),
    );
    if (e.kind === "booster") u8(powers.indexOf(e.power));
    if (e.kind === "ramp") i32(e.riseSubpixels);
    for (const n of [
      e.xSubpixels,
      e.ySubpixels,
      e.widthSubpixels,
      e.heightSubpixels,
    ])
      i32(n);
    u8(e.designatedCoin === null ? 0 : 1);
    if (e.designatedCoin !== null) u8(e.designatedCoin);
    u64(e.designatedCheckpoint);
    u8(Number(e.consumed));
  }
  return createHash("sha256").update(bytes.subarray(0, offset)).digest("hex");
}
