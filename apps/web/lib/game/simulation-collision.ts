import { RULES_V1 } from "./rules";
import type { RunnerState, WorldEntity } from "./simulation-state";

type Rect = {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
};
export type MotionPath = {
  readonly start: Rect;
  readonly afterX: Rect;
  readonly end: Rect;
};
export function body(runner: RunnerState): Rect {
  return {
    x: runner.xSubpixels,
    y: runner.ySubpixels,
    w: RULES_V1.physics.hitboxWidthSubpixels,
    h: RULES_V1.physics.hitboxHeightSubpixels,
  };
}
export function entityRect(entity: WorldEntity): Rect {
  return {
    x: entity.xSubpixels,
    y: entity.ySubpixels,
    w: entity.widthSubpixels,
    h: entity.heightSubpixels,
  };
}
export function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
  );
}

export function moveRunner(
  runner: RunnerState,
  world: readonly WorldEntity[],
): MotionPath {
  const start = body(runner);
  let dx = runner.vxSubpixelsPerTick;
  for (const tile of world) {
    if (tile.kind !== "terrain") continue;
    const r = entityRect(tile);
    if (start.y < r.y + r.h && start.y + start.h > r.y) {
      if (dx > 0 && start.x + start.w <= r.x)
        dx = Math.min(dx, r.x - start.x - start.w);
      if (dx < 0 && start.x >= r.x + r.w)
        dx = Math.max(dx, r.x + r.w - start.x);
    }
  }
  runner.xSubpixels = start.x + dx;
  if (dx !== runner.vxSubpixelsPerTick) runner.vxSubpixelsPerTick = 0;
  const afterX = body(runner);
  let dy = runner.vySubpixelsPerTick;
  runner.grounded = false;
  for (const tile of world) {
    if (tile.kind !== "terrain") continue;
    const r = entityRect(tile);
    if (afterX.x < r.x + r.w && afterX.x + afterX.w > r.x) {
      if (
        dy >= 0 &&
        afterX.y + afterX.h <= r.y &&
        afterX.y + afterX.h + dy >= r.y
      ) {
        dy = r.y - afterX.y - afterX.h;
        runner.grounded = true;
      }
      if (dy < 0 && afterX.y >= r.y + r.h)
        dy = Math.max(dy, r.y + r.h - afterX.y);
    }
  }
  runner.ySubpixels = afterX.y + dy;
  if (dy !== runner.vySubpixelsPerTick || runner.grounded)
    runner.vySubpixelsPerTick = 0;
  return { start, afterX, end: body(runner) };
}

function sweptRect(a: Rect, b: Rect): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: a.w + Math.abs(a.x - b.x),
    h: a.h + Math.abs(a.y - b.y),
  };
}
export function hits(path: MotionPath, entity: WorldEntity): boolean {
  const r = entityRect(entity);
  return (
    overlaps(sweptRect(path.start, path.afterX), r) ||
    overlaps(sweptRect(path.afterX, path.end), r)
  );
}

function circleSweep(a: Rect, b: Rect, target: Rect, radius: number): boolean {
  const minX = Math.min(a.x, b.x) + a.w / 2;
  const maxX = Math.max(a.x, b.x) + a.w / 2;
  const minY = Math.min(a.y, b.y) + a.h / 2;
  const maxY = Math.max(a.y, b.y) + a.h / 2;
  const dx = Math.max(target.x - maxX, minX - target.x - target.w, 0);
  const dy = Math.max(target.y - maxY, minY - target.y - target.h, 0);
  return dx * dx + dy * dy < radius * radius;
}
export function collects(
  path: MotionPath,
  entity: WorldEntity,
  radius: number,
): boolean {
  const r = entityRect(entity);
  return (
    circleSweep(path.start, path.afterX, r, radius) ||
    circleSweep(path.afterX, path.end, r, radius)
  );
}
