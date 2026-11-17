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

#[derive(Clone, Copy)]
pub struct MotionPath {
    pub start: Rect,
    pub after_x: Rect,
    pub end: Rect,
}

pub fn move_runner(runner: &mut RunnerState, world: &[WorldEntity]) -> MotionPath {
    let start = body(runner);
    let mut dx = i64::from(runner.vx_subpixels_per_tick);
    for tile in world.iter().filter(|e| e.kind == EntityKind::Terrain) {
        let r = entity_rect(tile);
        if start.y < r.y + r.h && start.y + start.h > r.y {
            if dx > 0 && start.x + start.w <= r.x {
                dx = dx.min(r.x - start.x - start.w);
            }
            if dx < 0 && start.x >= r.x + r.w {
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
    runner.grounded = false;
    for tile in world.iter().filter(|e| e.kind == EntityKind::Terrain) {
        let r = entity_rect(tile);
        if after_x.x < r.x + r.w && after_x.x + after_x.w > r.x {
            if dy >= 0 && after_x.y + after_x.h <= r.y && after_x.y + after_x.h + dy >= r.y {
                dy = r.y - after_x.y - after_x.h;
                runner.grounded = true;
            }
            if dy < 0 && after_x.y >= r.y + r.h {
                dy = dy.max(r.y + r.h - after_x.y);
            }
        }
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
