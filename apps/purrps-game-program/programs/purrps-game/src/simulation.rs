pub mod collision;
pub mod powers;
pub mod world;

use crate::{
    catalog::CatStats,
    protocol::{InputAxis, PlayerIntent, RunPhase, TerminalReason},
    rules::{speed_bps, RULES_V1},
    state::run::{
        EntityKind, PowerState, RunnerState, WorldEntity, MAX_QUEUED_INTENTS, MAX_WORLD_ENTITIES,
    },
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SimulationError {
    InvalidFrame,
    InvalidWorld,
    InvalidBatch,
    NumericOverflow,
    InvalidObservation,
}

// A pure projection of RunGameState, not another authority or persisted account.
// Callers must authenticate/order accepted inputs and pin stats/rules first.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SimulationFrame {
    pub phase: RunPhase,
    pub active_ticks: u64,
    pub runner: RunnerState,
    pub powers: [PowerState; 4],
    pub score: u64,
    pub total_coins: u64,
    pub designated_coin_mask: u8,
    pub qualified_checkpoints: u64,
    pub terminal_reason: Option<TerminalReason>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SimulationStep {
    pub frame: SimulationFrame,
    pub entities: Vec<WorldEntity>,
}

fn valid_rect(x: i32, y: i32, w: i32, h: i32) -> bool {
    let limit = i64::from(RULES_V1.physics.coordinate_limit_subpixels);
    w > 0
        && h > 0
        && i64::from(x) >= -limit
        && i64::from(y) >= -limit
        && i64::from(x) + i64::from(w) <= limit
        && i64::from(y) + i64::from(h) <= limit
}

pub fn validate_world(world: &[WorldEntity]) -> Result<(), SimulationError> {
    if world.len() > MAX_WORLD_ENTITIES {
        return Err(SimulationError::InvalidWorld);
    }
    let mut previous = None;
    for e in world {
        if previous.is_some_and(|id| id >= e.id)
            || !valid_rect(
                e.x_subpixels,
                e.y_subpixels,
                e.width_subpixels,
                e.height_subpixels,
            )
            || e.designated_coin.is_some_and(|index| {
                index >= RULES_V1.designated_coins || e.kind != EntityKind::Coin
            })
            || (e.consumed && matches!(e.kind, EntityKind::Terrain | EntityKind::Hazard))
            || matches!(e.kind, EntityKind::Ramp(rise) if e.consumed
                || i64::from(rise).abs() * i64::from(RULES_V1.generation.segment_width_subpixels)
                    > i64::from(RULES_V1.physics.max_required_rise_subpixels) * i64::from(e.width_subpixels)
                || e.width_subpixels < RULES_V1.physics.min_landing_width_subpixels
                || !valid_rect(e.x_subpixels, e.y_subpixels + rise.min(0),
                    e.width_subpixels, e.height_subpixels + rise.abs()))
        {
            return Err(SimulationError::InvalidWorld);
        }
        previous = Some(e.id);
    }
    Ok(())
}

fn validate_frame(frame: &SimulationFrame, stats: &CatStats) -> Result<(), SimulationError> {
    let p = RULES_V1.physics;
    let r = frame.runner;
    if !valid_rect(
        r.x_subpixels,
        r.y_subpixels,
        p.hitbox_width_subpixels,
        p.hitbox_height_subpixels,
    ) || i64::from(r.vx_subpixels_per_tick).abs() > i64::from(p.max_velocity_subpixels_per_tick)
        || i64::from(r.vy_subpixels_per_tick).abs() > i64::from(p.max_velocity_subpixels_per_tick)
        || !(0..=p.max_velocity_subpixels_per_tick).contains(&r.automatic_speed_subpixels_per_tick)
        || frame.designated_coin_mask & !0b1_1111 != 0
        || frame.powers.iter().any(|power| power.charges > 1)
        || stats.pickup_radius_subpixels <= 0
        || stats.pickup_radius_subpixels > p.max_required_rise_subpixels
        || stats.air_control_subpixels_per_tick < 0
        || stats.air_control_subpixels_per_tick > p.max_velocity_subpixels_per_tick
        || (frame.terminal_reason.is_some()
            != matches!(
                frame.phase,
                RunPhase::TerminalRecorded | RunPhase::CompletionRequested
            ))
    {
        return Err(SimulationError::InvalidFrame);
    }
    Ok(())
}

fn integrate_velocity(frame: &mut SimulationFrame, stats: &CatStats, tick: u64) {
    let p = RULES_V1.physics;
    let r = &mut frame.runner;
    if r.grounded {
        let target = i64::from(p.runner_speed_subpixels_per_tick)
            * i64::from(speed_bps(frame.active_ticks))
            / 10_000;
        let current = i64::from(r.automatic_speed_subpixels_per_tick);
        r.automatic_speed_subpixels_per_tick = (current
            + (target - current).clamp(
                -i64::from(p.speed_easing_subpixels_per_tick),
                i64::from(p.speed_easing_subpixels_per_tick),
            )) as i32;
    }
    let air = if r.grounded {
        0
    } else {
        match r.axis {
            InputAxis::Left => -stats.air_control_subpixels_per_tick,
            InputAxis::Neutral => 0,
            InputAxis::Right => stats.air_control_subpixels_per_tick,
        }
    };
    let dash = if tick < r.dash_ends_at_tick {
        p.dash_bonus_subpixels_per_tick
    } else {
        0
    };
    let bound = i64::from(p.max_velocity_subpixels_per_tick);
    r.vx_subpixels_per_tick =
        (i64::from(r.automatic_speed_subpixels_per_tick) + i64::from(air) + i64::from(dash))
            .clamp(-bound, bound) as i32;
    r.vy_subpixels_per_tick = (i64::from(r.vy_subpixels_per_tick)
        + i64::from(p.gravity_subpixels_per_tick_squared))
    .clamp(-bound, bound) as i32;
}

fn terminate(frame: &mut SimulationFrame, reason: TerminalReason) {
    frame.phase = RunPhase::TerminalRecorded;
    frame.terminal_reason = Some(reason);
}

fn add(counter: &mut u64, amount: u64) -> Result<(), SimulationError> {
    *counter = counter
        .checked_add(amount)
        .ok_or(SimulationError::NumericOverflow)?;
    Ok(())
}

fn pickups(
    frame: &mut SimulationFrame,
    world: &mut [WorldEntity],
    path: collision::MotionPath,
    stats: &CatStats,
    tick: u64,
) -> Result<(), SimulationError> {
    for e in world.iter_mut() {
        if e.consumed
            || matches!(
                e.kind,
                EntityKind::Terrain | EntityKind::Ramp(_) | EntityKind::Hazard
            )
            || !collision::collects(path, e, powers::pickup_radius(&frame.powers, stats, tick))
        {
            continue;
        }
        match e.kind {
            EntityKind::Coin => {
                add(&mut frame.total_coins, 1)?;
                add(&mut frame.score, u64::from(RULES_V1.score.coin_points))?;
                if e.designated_checkpoint == (tick - 1) / u64::from(RULES_V1.checkpoint_ticks) {
                    if let Some(index) = e.designated_coin {
                        frame.designated_coin_mask |= 1 << index;
                    }
                }
            }
            EntityKind::Star => add(&mut frame.score, u64::from(RULES_V1.score.star_points))?,
            EntityKind::Booster(power) => powers::refresh(&mut frame.powers[power as usize], tick)?,
            _ => unreachable!(),
        }
        e.consumed = true;
    }
    Ok(())
}

// Terrain is swept X then Y; supported feet follow continuous ramp surfaces.
// Bounded copies make failures atomic for both the program core and predictor.
pub fn step(
    frame: &SimulationFrame,
    entities: &[WorldEntity],
    stats: &CatStats,
    actions: &[PlayerIntent],
) -> Result<SimulationStep, SimulationError> {
    validate_world(entities)?;
    validate_frame(frame, stats)?;
    if actions.len() > MAX_QUEUED_INTENTS {
        return Err(SimulationError::InvalidBatch);
    }
    let mut result = SimulationStep {
        frame: *frame,
        entities: entities.to_vec(),
    };
    if frame.phase != RunPhase::Active {
        return Ok(result);
    }
    if entities
        .iter()
        .any(|e| collision::inside_terrain(collision::body(&frame.runner), e))
    {
        return Err(SimulationError::InvalidWorld);
    }
    let tick = frame
        .active_ticks
        .checked_add(1)
        .ok_or(SimulationError::NumericOverflow)?;
    for action in actions {
        let reason = match action {
            PlayerIntent::CashOut if frame.qualified_checkpoints > 0 => {
                Some(TerminalReason::CashOut)
            }
            PlayerIntent::Surrender => Some(TerminalReason::Surrender),
            _ => None,
        };
        if let Some(reason) = reason {
            terminate(&mut result.frame, reason);
            return Ok(result);
        }
        powers::command(
            &mut result.frame.runner,
            &mut result.frame.powers,
            stats,
            tick,
            action,
        )?;
    }
    integrate_velocity(&mut result.frame, stats, tick);
    let path = collision::move_runner(&mut result.frame.runner, entities);
    validate_frame(&result.frame, stats)?;
    result.frame.active_ticks = tick;
    for e in entities.iter().filter(|e| e.kind == EntityKind::Hazard) {
        if collision::hits(path, e)
            && !powers::absorb_hit(&mut result.frame.runner, &mut result.frame.powers, tick)?
        {
            terminate(&mut result.frame, TerminalReason::Crash);
            return Ok(result);
        }
    }
    pickups(&mut result.frame, &mut result.entities, path, stats, tick)?;
    if tick % u64::from(RULES_V1.checkpoint_ticks) == 0 {
        if result.frame.designated_coin_mask.count_ones() >= u32::from(RULES_V1.qualification_coins)
        {
            add(&mut result.frame.qualified_checkpoints, 1)?;
        }
        result.frame.designated_coin_mask = 0;
    }
    Ok(result)
}
