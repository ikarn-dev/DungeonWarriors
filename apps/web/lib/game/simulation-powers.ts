import { CATALOG_V1, type CatStats } from "./catalog";
import type { PlayerIntent } from "./protocol";
import { RULES_V1 } from "./rules";
import {
  addCounter,
  type PowerState,
  type SimulationFrame,
} from "./simulation-state";

export function active(power: PowerState, tick: bigint): boolean {
  return power.charges > 0 && tick < power.endsAtTick;
}
export function refresh(power: PowerState, tick: bigint): void {
  power.endsAtTick = addCounter(tick, BigInt(RULES_V1.powerDurationTicks));
  power.charges = 1;
}

function armNative(power: PowerState, stats: CatStats, tick: bigint) {
  if (tick >= power.readyAtTick) {
    refresh(power, tick);
    power.readyAtTick = addCounter(tick, BigInt(stats.powerCooldownTicks));
  }
}

function jump(
  runner: SimulationFrame["runner"],
  power: PowerState,
  tick: bigint,
) {
  if (runner.grounded || active(power, tick)) {
    if (!runner.grounded) power.charges = 0;
    runner.vySubpixelsPerTick = RULES_V1.physics.jumpVelocitySubpixelsPerTick;
    runner.grounded = false;
  }
}

export function command(
  frame: SimulationFrame,
  stats: CatStats,
  tick: bigint,
  action: PlayerIntent,
  intuitivePowers = false,
): void {
  const runner = frame.runner;
  const alreadyJumped =
    !runner.grounded &&
    runner.vySubpixelsPerTick === RULES_V1.physics.jumpVelocitySubpixelsPerTick;
  switch (action.kind) {
    case "move":
      runner.axis = action.axis;
      break;
    case "inactive":
      runner.axis = "neutral";
      break;
    case "heartbeat":
      if (!action.active) runner.axis = "neutral";
      break;
    case "boost": {
      const power = frame.powers[stats.power];
      if (tick >= power.readyAtTick) {
        armNative(power, stats, tick);
        if (
          intuitivePowers &&
          stats.power === "doubleJump" &&
          !runner.grounded &&
          !alreadyJumped
        )
          jump(runner, power, tick);
      }
      break;
    }
    case "jump": {
      const doubleJump = frame.powers.doubleJump;
      if (intuitivePowers && alreadyJumped) break;
      if (
        intuitivePowers &&
        !runner.grounded &&
        stats.power === "doubleJump" &&
        !active(doubleJump, tick)
      )
        armNative(doubleJump, stats, tick);
      jump(runner, doubleJump, tick);
      break;
    }
    case "dash": {
      const extraDash = frame.powers.extraDash;
      if (tick < runner.dashEndsAtTick) break;
      const regular = tick >= runner.dashReadyAtTick;
      if (
        intuitivePowers &&
        !regular &&
        stats.power === "extraDash" &&
        !active(extraDash, tick)
      )
        armNative(extraDash, stats, tick);
      if (regular || active(extraDash, tick)) {
        if (regular)
          runner.dashReadyAtTick = addCounter(
            tick,
            BigInt(stats.dashCooldownTicks),
          );
        else extraDash.charges = 0;
        runner.dashEndsAtTick = addCounter(
          tick,
          BigInt(stats.dashDurationTicks),
        );
      }
      break;
    }
    case "cashOut":
    case "surrender":
      break;
  }
}

export function absorbHit(frame: SimulationFrame, tick: bigint): boolean {
  if (tick < frame.runner.shieldContactEndsAtTick) return true;
  const shield = frame.powers.shield;
  if (!active(shield, tick)) return false;
  shield.charges = 0;
  frame.runner.shieldContactEndsAtTick = addCounter(
    tick,
    BigInt(RULES_V1.shieldContactTicks),
  );
  return true;
}

export function pickupRadius(
  frame: SimulationFrame,
  stats: CatStats,
  tick: bigint,
): number {
  return active(frame.powers.magnet, tick)
    ? Math.max(
        stats.pickupRadiusSubpixels,
        (RULES_V1.physics.pickupRadiusSubpixels * CATALOG_V1.magnetRadiusBps) /
          10_000,
      )
    : stats.pickupRadiusSubpixels;
}
