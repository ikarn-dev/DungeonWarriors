use super::SimulationError;
use crate::{
    catalog::{CatStats, Power, CATALOG_V1},
    protocol::{InputAxis, PlayerIntent},
    rules::RULES_V1,
    state::run::{PowerState, RunnerState},
};

pub fn active(power: &PowerState, tick: u64) -> bool {
    power.charges > 0 && tick < power.ends_at_tick
}

pub fn refresh(power: &mut PowerState, tick: u64) -> Result<(), SimulationError> {
    power.ends_at_tick = tick
        .checked_add(u64::from(RULES_V1.power_duration_ticks))
        .ok_or(SimulationError::NumericOverflow)?;
    power.charges = 1;
    Ok(())
}

pub fn command(
    runner: &mut RunnerState,
    powers: &mut [PowerState; 4],
    stats: &CatStats,
    tick: u64,
    action: &PlayerIntent,
) -> Result<(), SimulationError> {
    match action {
        PlayerIntent::Move { axis } => runner.axis = *axis,
        PlayerIntent::Inactive | PlayerIntent::Heartbeat { active: false } => {
            runner.axis = InputAxis::Neutral
        }
        PlayerIntent::Boost if tick >= powers[stats.power as usize].ready_at_tick => {
            let power = &mut powers[stats.power as usize];
            refresh(power, tick)?;
            power.ready_at_tick = tick
                .checked_add(u64::from(stats.power_cooldown_ticks))
                .ok_or(SimulationError::NumericOverflow)?;
        }
        PlayerIntent::Jump => {
            let double_jump = &mut powers[Power::DoubleJump as usize];
            if runner.grounded || active(double_jump, tick) {
                if !runner.grounded {
                    double_jump.charges = 0;
                }
                runner.vy_subpixels_per_tick = RULES_V1.physics.jump_velocity_subpixels_per_tick;
                runner.grounded = false;
            }
        }
        PlayerIntent::Dash if tick >= runner.dash_ends_at_tick => {
            let extra_dash = &mut powers[Power::ExtraDash as usize];
            let regular = tick >= runner.dash_ready_at_tick;
            if regular || active(extra_dash, tick) {
                if regular {
                    runner.dash_ready_at_tick = tick
                        .checked_add(u64::from(stats.dash_cooldown_ticks))
                        .ok_or(SimulationError::NumericOverflow)?;
                } else {
                    extra_dash.charges = 0;
                }
                runner.dash_ends_at_tick = tick
                    .checked_add(u64::from(stats.dash_duration_ticks))
                    .ok_or(SimulationError::NumericOverflow)?;
            }
        }
        _ => {}
    }
    Ok(())
}

pub fn absorb_hit(
    runner: &mut RunnerState,
    powers: &mut [PowerState; 4],
    tick: u64,
) -> Result<bool, SimulationError> {
    if tick < runner.shield_contact_ends_at_tick {
        return Ok(true);
    }
    let shield = &mut powers[Power::Shield as usize];
    if !active(shield, tick) {
        return Ok(false);
    }
    shield.charges = 0;
    runner.shield_contact_ends_at_tick = tick
        .checked_add(u64::from(RULES_V1.shield_contact_ticks))
        .ok_or(SimulationError::NumericOverflow)?;
    Ok(true)
}

pub fn pickup_radius(powers: &[PowerState; 4], stats: &CatStats, tick: u64) -> i32 {
    if active(&powers[Power::Magnet as usize], tick) {
        stats.pickup_radius_subpixels.max(
            RULES_V1.physics.pickup_radius_subpixels * i32::from(CATALOG_V1.magnet_radius_bps)
                / 10_000,
        )
    } else {
        stats.pickup_radius_subpixels
    }
}
