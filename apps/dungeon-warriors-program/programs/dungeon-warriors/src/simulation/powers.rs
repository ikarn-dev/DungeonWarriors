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

fn arm_native(power: &mut PowerState, stats: &CatStats, tick: u64) -> Result<(), SimulationError> {
    if tick >= power.ready_at_tick {
        refresh(power, tick)?;
        power.ready_at_tick = tick
            .checked_add(u64::from(stats.power_cooldown_ticks))
            .ok_or(SimulationError::NumericOverflow)?;
    }
    Ok(())
}

fn jump(runner: &mut RunnerState, power: &mut PowerState, tick: u64) {
    if runner.grounded || active(power, tick) {
        if !runner.grounded {
            power.charges = 0;
        }
        runner.vy_subpixels_per_tick = RULES_V1.physics.jump_velocity_subpixels_per_tick;
        runner.grounded = false;
    }
}

pub fn command(
    runner: &mut RunnerState,
    powers: &mut [PowerState; 4],
    stats: &CatStats,
    tick: u64,
    action: &PlayerIntent,
    intuitive_powers: bool,
) -> Result<(), SimulationError> {
    let already_jumped = !runner.grounded
        && runner.vy_subpixels_per_tick == RULES_V1.physics.jump_velocity_subpixels_per_tick;
    match action {
        PlayerIntent::Move { axis } => runner.axis = *axis,
        PlayerIntent::Inactive | PlayerIntent::Heartbeat { active: false } => {
            runner.axis = InputAxis::Neutral
        }
        PlayerIntent::Boost if tick >= powers[stats.power as usize].ready_at_tick => {
            let power = &mut powers[stats.power as usize];
            arm_native(power, stats, tick)?;
            if intuitive_powers
                && stats.power == Power::DoubleJump
                && !runner.grounded
                && !already_jumped
            {
                jump(runner, power, tick);
            }
        }
        PlayerIntent::Jump => {
            let double_jump = &mut powers[Power::DoubleJump as usize];
            if intuitive_powers && already_jumped {
                return Ok(());
            }
            if intuitive_powers
                && !runner.grounded
                && stats.power == Power::DoubleJump
                && !active(double_jump, tick)
            {
                arm_native(double_jump, stats, tick)?;
            }
            jump(runner, double_jump, tick);
        }
        PlayerIntent::Dash if tick >= runner.dash_ends_at_tick => {
            let extra_dash = &mut powers[Power::ExtraDash as usize];
            let regular = tick >= runner.dash_ready_at_tick;
            if intuitive_powers
                && !regular
                && stats.power == Power::ExtraDash
                && !active(extra_dash, tick)
            {
                arm_native(extra_dash, stats, tick)?;
            }
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
