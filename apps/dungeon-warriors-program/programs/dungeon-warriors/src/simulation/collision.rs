use crate::{
    rules::RULES_V1,
    state::run::{EntityKind, RunnerState, WorldEntity},
};

// Products/distances stay in i64 after the bounded world validation.
#[derive(Clone, Copy)]
pub struct Rect {
    pub x: i64,
    pub y: i64,
    pub w: i64,
    pub h: i64,
}

pub fn body(runner: &RunnerState) -> Rect {
    let p = RULES_V1.physics;
    Rect {
        x: i64::from(runner.x_subpixels),
        y: i64::from(runner.y_subpixels),
        w: i64::from(p.hitbox_width_subpixels),
        h: i64::from(p.hitbox_height_subpixels),
    }
}

pub fn entity_rect(entity: &WorldEntity) -> Rect {
    Rect {
        x: i64::from(entity.x_subpixels),
        y: i64::from(entity.y_subpixels),
        w: i64::from(entity.width_subpixels),
        h: i64::from(entity.height_subpixels),
    }
}

pub fn overlaps(a: Rect, b: Rect) -> bool {
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

pub fn surface_at(entity: &WorldEntity, x: i64) -> Option<i64> {
    let rise = match entity.kind {
        EntityKind::Terrain => 0,
        EntityKind::Ramp(rise) => i64::from(rise),
        _ => return None,
    };
    let offset = (x - i64::from(entity.x_subpixels)).clamp(0, i64::from(entity.width_subpixels));
    Some(i64::from(entity.y_subpixels) + rise * offset / i64::from(entity.width_subpixels))
}

fn bottom(entity: &WorldEntity) -> i64 {
    i64::from(entity.y_subpixels)
        + i64::from(entity.height_subpixels)
        + match entity.kind {
            EntityKind::Ramp(rise) => i64::from(rise.max(0)),
            _ => 0,
        }
}

fn surface_under(entity: &WorldEntity, rect: Rect) -> Option<i64> {
    let left = rect.x.max(i64::from(entity.x_subpixels));
    let right =
        (rect.x + rect.w).min(i64::from(entity.x_subpixels) + i64::from(entity.width_subpixels));
    if left >= right {
        return None;
    }
    Some(surface_at(entity, left)?.min(surface_at(entity, right)?))
}

pub fn inside_terrain(rect: Rect, entity: &WorldEntity) -> bool {
    surface_under(entity, rect).is_some_and(|top| rect.y < bottom(entity) && rect.y + rect.h > top)
}

#[derive(Clone, Copy)]
pub struct MotionPath {
    pub start: Rect,
    pub after_x: Rect,
    pub end: Rect,
}

pub fn move_runner(runner: &mut RunnerState, world: &[WorldEntity]) -> MotionPath {
    let start = body(runner);
    let supported = runner.grounded
        && world
            .iter()
            .any(|e| surface_under(e, start) == Some(start.y + start.h));
    let mut dx = i64::from(runner.vx_subpixels_per_tick);
    for tile in world {
        if surface_at(tile, start.x).is_none() {
            continue;
        }
        let r = entity_rect(tile);
        let can_step = |edge, velocity: i64| {
            supported
                && runner.vy_subpixels_per_tick >= 0
                && matches!(tile.kind, EntityKind::Ramp(_))
                && start.y + start.h - surface_at(tile, edge).unwrap()
                    <= velocity.abs() * i64::from(RULES_V1.physics.max_required_rise_subpixels)
                        / i64::from(RULES_V1.generation.segment_width_subpixels)
                        + 1
        };
        if start.y < bottom(tile) {
            if dx > 0
                && start.x + start.w <= r.x
                && start.y + start.h > surface_at(tile, r.x).unwrap()
                && !can_step(r.x, dx)
            {
                dx = dx.min(r.x - start.x - start.w);
            }
            if dx < 0
                && start.x >= r.x + r.w
                && start.y + start.h > surface_at(tile, r.x + r.w).unwrap()
                && !can_step(r.x + r.w, dx)
            {
                dx = dx.max(r.x + r.w - start.x);
            }
        }
    }
    runner.x_subpixels = (start.x + dx) as i32;
    if dx != i64::from(runner.vx_subpixels_per_tick) {
        runner.vx_subpixels_per_tick = 0;
    }
    let after_x = body(runner);
    let mut dy = i64::from(runner.vy_subpixels_per_tick);
    let mut floor = None;
    runner.grounded = false;
    for tile in world {
        let Some(top) = surface_under(tile, after_x) else {
            continue;
        };
        let old_top = surface_under(tile, start).unwrap_or_else(|| {
            surface_at(
                tile,
                if dx >= 0 {
                    i64::from(tile.x_subpixels)
                } else {
                    i64::from(tile.x_subpixels) + i64::from(tile.width_subpixels)
                },
            )
            .unwrap()
        });
        let tracking = supported
            && runner.vy_subpixels_per_tick >= 0
            && matches!(tile.kind, EntityKind::Ramp(_))
            && (top - start.y - start.h).abs()
                <= i64::from(RULES_V1.physics.max_velocity_subpixels_per_tick);
        if (start.y + start.h <= old_top && after_x.y + after_x.h + dy >= top) || tracking {
            floor = Some(floor.map_or(top, |value: i64| value.min(top)));
        }
        if dy < 0 && after_x.y >= bottom(tile) {
            dy = dy.max(bottom(tile) - after_x.y);
        }
    }
    if let Some(top) = floor {
        dy = top - after_x.y - after_x.h;
        runner.grounded = true;
    }
    runner.y_subpixels = (after_x.y + dy) as i32;
    if dy != i64::from(runner.vy_subpixels_per_tick) || runner.grounded {
        runner.vy_subpixels_per_tick = 0;
    }
    MotionPath {
        start,
        after_x,
        end: body(runner),
    }
}

fn swept_rect(a: Rect, b: Rect) -> Rect {
    Rect {
        x: a.x.min(b.x),
        y: a.y.min(b.y),
        w: a.w + (a.x - b.x).abs(),
        h: a.h + (a.y - b.y).abs(),
    }
}

pub fn hits(path: MotionPath, entity: &WorldEntity) -> bool {
    let r = entity_rect(entity);
    overlaps(swept_rect(path.start, path.after_x), r)
        || overlaps(swept_rect(path.after_x, path.end), r)
}

fn circle_sweep(a: Rect, b: Rect, target: Rect, radius: i64) -> bool {
    let min_x = a.x.min(b.x) + a.w / 2;
    let max_x = a.x.max(b.x) + a.w / 2;
    let min_y = a.y.min(b.y) + a.h / 2;
    let max_y = a.y.max(b.y) + a.h / 2;
    let dx = (target.x - max_x).max(min_x - target.x - target.w).max(0);
    let dy = (target.y - max_y).max(min_y - target.y - target.h).max(0);
    dx * dx + dy * dy < radius * radius
}

pub fn collects(path: MotionPath, entity: &WorldEntity, radius: i32) -> bool {
    let r = entity_rect(entity);
    circle_sweep(path.start, path.after_x, r, i64::from(radius))
        || circle_sweep(path.after_x, path.end, r, i64::from(radius))
}
