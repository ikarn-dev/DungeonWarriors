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

export function command(
  frame: SimulationFrame,
  stats: CatStats,
  tick: bigint,
  action: PlayerIntent,
): void {
  const runner = frame.runner;
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
        refresh(power, tick);
        power.readyAtTick = addCounter(tick, BigInt(stats.powerCooldownTicks));
      }
      break;
    }
    case "jump": {
      const doubleJump = frame.powers.doubleJump;
      if (runner.grounded || active(doubleJump, tick)) {
        if (!runner.grounded) doubleJump.charges = 0;
        runner.vySubpixelsPerTick =
          RULES_V1.physics.jumpVelocitySubpixelsPerTick;
        runner.grounded = false;
      }
      break;
    }
    case "dash": {
      const extraDash = frame.powers.extraDash;
      if (tick < runner.dashEndsAtTick) break;
      const regular = tick >= runner.dashReadyAtTick;
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
