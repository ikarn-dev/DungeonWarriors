import type {
  SimulationFrame,
  WorldEntity,
} from "../../../../../apps/web/lib/game/simulation-state";
export function frame(): SimulationFrame {
  return {
    phase: "active",
    activeTicks: 0n,
    runner: {
      xSubpixels: 0,
      ySubpixels: 0,
      vxSubpixelsPerTick: 0,
      vySubpixelsPerTick: 0,
      automaticSpeedSubpixelsPerTick: 1024,
      grounded: true,
      axis: "neutral",
      dashEndsAtTick: 0n,
      dashReadyAtTick: 0n,
      shieldContactEndsAtTick: 0n,
    },
    powers: {
      magnet: { readyAtTick: 0n, endsAtTick: 0n, charges: 0 },
      doubleJump: { readyAtTick: 0n, endsAtTick: 0n, charges: 0 },
      shield: { readyAtTick: 0n, endsAtTick: 0n, charges: 0 },
      extraDash: { readyAtTick: 0n, endsAtTick: 0n, charges: 0 },
    },
    score: 0n,
    totalCoins: 0n,
    designatedCoinMask: 0,
    qualifiedCheckpoints: 0n,
    terminalReason: null,
  };
}
export function entity(
  id: bigint,
  kind: "terrain" | "hazard" | "coin" | "star",
  x: number,
  y: number,
  w: number,
  h: number,
): WorldEntity {
  return {
    id,
    kind,
    xSubpixels: x,
    ySubpixels: y,
    widthSubpixels: w,
    heightSubpixels: h,
    designatedCoin: null,
    designatedCheckpoint: 0n,
    consumed: false,
  };
}
export function floor(): WorldEntity {
  return entity(1n, "terrain", -10000, 7168, 100000, 1000);
}
