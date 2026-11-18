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

export function surfaceAt(entity: WorldEntity, x: number): number | null {
  if (entity.kind !== "terrain" && entity.kind !== "ramp") return null;
  const rise = entity.kind === "ramp" ? entity.riseSubpixels : 0;
  const offset = Math.max(
    0,
    Math.min(entity.widthSubpixels, x - entity.xSubpixels),
  );
  return (
    entity.ySubpixels + Math.trunc((rise * offset) / entity.widthSubpixels)
  );
}
function bottom(entity: WorldEntity): number {
  return (
    entity.ySubpixels +
    entity.heightSubpixels +
    (entity.kind === "ramp" ? Math.max(0, entity.riseSubpixels) : 0)
  );
}
function surfaceUnder(entity: WorldEntity, rect: Rect): number | null {
  const left = Math.max(rect.x, entity.xSubpixels);
  const right = Math.min(
    rect.x + rect.w,
    entity.xSubpixels + entity.widthSubpixels,
  );
  if (left >= right) return null;
  const a = surfaceAt(entity, left);
  const b = surfaceAt(entity, right);
  return a === null || b === null ? null : Math.min(a, b);
}
export function insideTerrain(rect: Rect, entity: WorldEntity): boolean {
  const top = surfaceUnder(entity, rect);
  return top !== null && rect.y < bottom(entity) && rect.y + rect.h > top;
}

export function moveRunner(
  runner: RunnerState,
  world: readonly WorldEntity[],
): MotionPath {
  const start = body(runner);
  const supported =
    runner.grounded &&
    world.some((e) => surfaceUnder(e, start) === start.y + start.h);
  let dx = runner.vxSubpixelsPerTick;
  for (const tile of world) {
    if (surfaceAt(tile, start.x) === null) continue;
    const r = entityRect(tile);
    const canStep = (edge: number, velocity: number): boolean => {
      const top = surfaceAt(tile, edge);
      return (
        top !== null &&
        supported &&
        runner.vySubpixelsPerTick >= 0 &&
        tile.kind === "ramp" &&
        start.y + start.h - top <=
          Math.trunc(
            (Math.abs(velocity) * RULES_V1.physics.maxRequiredRiseSubpixels) /
              RULES_V1.generation.segmentWidthSubpixels,
          ) +
            1
      );
    };
    if (start.y < bottom(tile)) {
      const leftTop = surfaceAt(tile, r.x);
      const rightTop = surfaceAt(tile, r.x + r.w);
      if (
        leftTop !== null &&
        dx > 0 &&
        start.x + start.w <= r.x &&
        start.y + start.h > leftTop &&
        !canStep(r.x, dx)
      )
        dx = Math.min(dx, r.x - start.x - start.w);
      if (
        rightTop !== null &&
        dx < 0 &&
        start.x >= r.x + r.w &&
        start.y + start.h > rightTop &&
        !canStep(r.x + r.w, dx)
      )
        dx = Math.max(dx, r.x + r.w - start.x);
    }
  }
  runner.xSubpixels = start.x + dx;
  if (dx !== runner.vxSubpixelsPerTick) runner.vxSubpixelsPerTick = 0;
  const afterX = body(runner);
  let dy = runner.vySubpixelsPerTick;
  let floor: number | null = null;
  runner.grounded = false;
  for (const tile of world) {
    const top = surfaceUnder(tile, afterX);
    if (top === null) continue;
    const oldTop =
      surfaceUnder(tile, start) ??
      surfaceAt(
        tile,
        dx >= 0 ? tile.xSubpixels : tile.xSubpixels + tile.widthSubpixels,
      );
    const tracking =
      supported &&
      runner.vySubpixelsPerTick >= 0 &&
      tile.kind === "ramp" &&
      Math.abs(top - start.y - start.h) <=
        RULES_V1.physics.maxVelocitySubpixelsPerTick;
    if (
      (oldTop !== null &&
        start.y + start.h <= oldTop &&
        afterX.y + afterX.h + dy >= top) ||
      tracking
    )
      floor = floor === null ? top : Math.min(floor, top);
    if (dy < 0 && afterX.y >= bottom(tile))
      dy = Math.max(dy, bottom(tile) - afterX.y);
  }
  if (floor !== null) {
    dy = floor - afterX.y - afterX.h;
    runner.grounded = true;
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
