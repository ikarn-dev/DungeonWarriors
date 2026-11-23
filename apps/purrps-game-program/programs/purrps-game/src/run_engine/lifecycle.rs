use anchor_lang::prelude::*;

use crate::{
    economy::capped_gross_payout,
    error::ErrorCode,
    oracle::InspectedOracle,
    protocol::{FaultReason, InputAxis, PlayerIntent, RunPhase, TerminalReason},
    simulation::{
        command_terminal,
        world::{initialize_world_for_rules, step_world_for_rules, PriceSample, WorldState},
        SimulationFrame,
    },
    state::run::{OracleObservation, RunGameState, RunTerminal, Suspension},
};

fn frame(run: &RunGameState) -> SimulationFrame {
    SimulationFrame {
        phase: run.phase,
        active_ticks: run.active_ticks,
        runner: run.runner,
        powers: run.powers,
        score: run.score,
        total_coins: run.total_coins,
        designated_coin_mask: run.designated_coin_mask,
        qualified_checkpoints: run.qualified_checkpoints,
        terminal_reason: run.terminal.map(|terminal| terminal.reason),
    }
}

fn save_world(run: &mut RunGameState, world: WorldState) {
    run.phase = world.frame.phase;
    run.active_ticks = world.frame.active_ticks;
    run.runner = world.frame.runner;
    run.powers = world.frame.powers;
    run.score = world.frame.score;
    run.total_coins = world.frame.total_coins;
    run.designated_coin_mask = world.frame.designated_coin_mask;
    run.qualified_checkpoints = world.frame.qualified_checkpoints;
    run.entity_count = world.entities.len() as u8;
    run.entities[..world.entities.len()].copy_from_slice(&world.entities);
    run.world_generation = world.generation;
    run.world_origin_pixels = world.world_origin_pixels;
    run.next_entity_id = world.next_entity_id;
}

fn append_observation(run: &mut RunGameState, observation: OracleObservation) {
    let capacity = run.observations.len();
    let head = usize::from(run.observation_head);
    let count = usize::from(run.observation_count);
    run.observations[(head + count) % capacity] = observation;
    if count == capacity {
        run.observation_head = ((head + 1) % capacity) as u8;
    } else {
        run.observation_count += 1;
    }
}

fn sample(previous: OracleObservation, current: OracleObservation) -> PriceSample {
    PriceSample {
        previous_price: previous.price,
        previous_exponent: previous.exponent,
        price: current.price,
        exponent: current.exponent,
    }
}

// Activation and task registration commit atomically in the ER handler.
pub fn activate_world(run: &mut RunGameState, oracle: &InspectedOracle, now: i64) -> Result<()> {
    require!(
        run.phase == RunPhase::Ready
            && run.start_observation.is_none()
            && run.latest_observation()?.is_none()
            && now < run.snapshot.activation_deadline_seconds
            && now < run.snapshot.input_permission.expires_at_seconds
            && !run.input_key_revoked,
        ErrorCode::InvalidRun
    );
    let observation = oracle.next_observation(None)?;
    let mut initial = frame(run);
    initial.phase = RunPhase::Active;
    let world = initialize_world_for_rules(
        initial,
        &run.snapshot.cat.stats,
        sample(observation, observation),
        &run.snapshot.rules,
    )
    .map_err(|_| error!(ErrorCode::InvalidRunWorld))?;
    save_world(run, world);
    append_observation(run, observation);
    run.start_observation = Some(observation);
    Ok(())
}

struct Liveness {
    heartbeat: u64,
    inactive: Option<u64>,
    key: Option<u64>,
    grace: u64,
}

impl Liveness {
    fn deadline(&self) -> Result<u64> {
        let missing = self
            .heartbeat
            .checked_add(self.grace)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        Ok(self
            .inactive
            .into_iter()
            .chain(self.key)
            .fold(missing, u64::min))
    }

    fn accept(&mut self, action: PlayerIntent, tick: u64) -> Result<()> {
        match action {
            PlayerIntent::Heartbeat { active: true } if self.key.is_none() => {
                self.heartbeat = tick;
                self.inactive = None;
            }
            PlayerIntent::Inactive | PlayerIntent::Heartbeat { active: false } => {
                let deadline = tick
                    .checked_add(self.grace)
                    .ok_or(ErrorCode::ArithmeticOverflow)?;
                self.inactive = Some(
                    self.inactive
                        .map_or(deadline, |earlier| earlier.min(deadline)),
                );
            }
            _ => {}
        }
        Ok(())
    }
}

fn terminal(
    run: &RunGameState,
    frame: SimulationFrame,
    sequence: u64,
    last_observation: OracleObservation,
    reason: TerminalReason,
    fault: Option<FaultReason>,
) -> Result<RunTerminal> {
    let stake = run.snapshot.stake_base_units;
    let payout = match reason {
        TerminalReason::CashOut | TerminalReason::AutoCashOut => capped_gross_payout(
            stake,
            frame.qualified_checkpoints,
            run.snapshot.max_gross_base_units,
            &run.snapshot.rules,
        )
        .map_err(|_| error!(ErrorCode::InvalidRun))?,
        _ => 0,
    };
    Ok(RunTerminal {
        reason,
        fault,
        active_ticks: frame.active_ticks,
        qualified_checkpoints: frame.qualified_checkpoints,
        score: frame.score,
        coins: frame.total_coins,
        processed_sequence: sequence,
        final_observation: Some(last_observation),
        gross_payout_base_units: payout,
        refund_base_units: if reason == TerminalReason::TechnicalAbort {
            stake
        } else {
            0
        },
    })
}

fn automatic_exit(frame: SimulationFrame) -> TerminalReason {
    if frame.qualified_checkpoints > 0 {
        TerminalReason::AutoCashOut
    } else {
        TerminalReason::Surrender
    }
}

// Advances one tick. Only an authenticated scheduler with verified budget may call
// this when wired into a chain instruction; clock seconds here govern only session expiry.
pub fn advance_tick(run: &mut RunGameState, oracle: &InspectedOracle, now: i64) -> Result<()> {
    require!(
        run.phase == RunPhase::Active && run.terminal.is_none(),
        ErrorCode::InvalidRun
    );
    let count = usize::from(run.intent_count);
    let capacity = run.intents.len();
    let head = usize::from(run.intent_head);
    require!(
        head < capacity
            && count <= capacity
            && run
                .last_accepted_sequence
                .checked_sub(run.last_processed_sequence)
                == Some(count as u64),
        ErrorCode::InvalidRun
    );
    let last = run.latest_observation()?.ok_or(ErrorCode::InvalidRun)?;
    let current = oracle.next_observation(Some(last))?;
    let previous = if run.snapshot.rules.rules_version >= 2 {
        run.observations[usize::from(run.observation_head)]
    } else if current == last && run.observation_count > 1 {
        let end = usize::from(run.observation_head) + usize::from(run.observation_count);
        run.observations[(end - 2) % run.observations.len()]
    } else {
        last
    };
    let tick = run
        .active_ticks
        .checked_add(1)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    let mut liveness = Liveness {
        heartbeat: run.last_heartbeat_tick,
        inactive: run.inactive_exit_tick,
        key: run.key_exit_tick,
        grace: u64::from(run.snapshot.rules.heartbeat_grace_ticks),
    };
    if liveness.key.is_none()
        && (run.input_key_revoked || now >= run.snapshot.input_permission.expires_at_seconds)
    {
        liveness.key = Some(
            run.active_ticks
                .checked_add(liveness.grace)
                .ok_or(ErrorCode::ArithmeticOverflow)?,
        );
    }
    let mut initial = frame(run);
    if run.active_ticks >= liveness.deadline()? {
        run.terminal = Some(terminal(
            run,
            initial,
            run.last_processed_sequence,
            last,
            automatic_exit(initial),
            None,
        )?);
        run.phase = RunPhase::TerminalRecorded;
        return Ok(());
    }
    if liveness.key.is_some() || liveness.inactive.is_some() {
        initial.runner.axis = InputAxis::Neutral;
    }

    let mut actions = Vec::with_capacity(count);
    for offset in 0..count {
        let intent = run.intents[(head + offset) % capacity].ok_or(ErrorCode::InvalidRun)?;
        require!(
            intent.assigned_tick == tick
                && intent.envelope.client_sequence
                    == run.last_processed_sequence + offset as u64 + 1,
            ErrorCode::InvalidRun
        );
        let action = intent.envelope.action;
        liveness.accept(action, tick)?;
        actions.push(action);
        if command_terminal(&action, run.qualified_checkpoints).is_some() {
            break;
        }
    }
    let entities = run
        .entities
        .get(..usize::from(run.entity_count))
        .ok_or(ErrorCode::InvalidRun)?;
    let world = WorldState {
        frame: initial,
        entities: entities.to_vec(),
        generation: run.world_generation,
        world_origin_pixels: run.world_origin_pixels,
        next_entity_id: run.next_entity_id,
    };
    let mut next = step_world_for_rules(
        &world,
        &run.snapshot.cat.stats,
        &actions,
        sample(previous, current),
        &run.snapshot.rules,
    )
    .map_err(|_| error!(ErrorCode::InvalidRunWorld))?;
    let sequence = run.last_processed_sequence + actions.len() as u64;
    if next.frame.terminal_reason.is_none() && next.frame.active_ticks >= liveness.deadline()? {
        next.frame.terminal_reason = Some(automatic_exit(next.frame));
        next.frame.phase = RunPhase::TerminalRecorded;
    }
    let result = next
        .frame
        .terminal_reason
        .map(|reason| terminal(run, next.frame, sequence, current, reason, None))
        .transpose()?;

    save_world(run, next);
    if current != last {
        append_observation(run, current);
    }
    for offset in 0..actions.len() {
        run.intents[(head + offset) % capacity] = None;
    }
    run.intent_head = ((head + actions.len()) % capacity) as u8;
    run.intent_count -= actions.len() as u8;
    run.last_processed_sequence = sequence;
    run.last_heartbeat_tick = liveness.heartbeat;
    run.inactive_exit_tick = liveness.inactive;
    run.key_exit_tick = liveness.key;
    run.terminal = result;
    Ok(())
}

pub fn suspend(run: &mut RunGameState, reason: FaultReason, now: i64) -> Result<()> {
    require!(
        run.phase == RunPhase::Active
            && run.terminal.is_none()
            && reason != FaultReason::ActivationExpired,
        ErrorCode::InvalidRun
    );
    run.phase = RunPhase::Suspended;
    run.runner.axis = InputAxis::Neutral;
    run.suspension = Some(Suspension {
        reason,
        started_at_seconds: now,
    });
    Ok(())
}

pub fn expire_suspension(run: &mut RunGameState, now: i64) -> Result<bool> {
    let suspension = run.suspension.ok_or(ErrorCode::InvalidRun)?;
    require!(
        run.phase == RunPhase::Suspended
            && run.terminal.is_none()
            && now >= suspension.started_at_seconds,
        ErrorCode::InvalidRun
    );
    let age = now
        .checked_sub(suspension.started_at_seconds)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    if age < i64::from(run.snapshot.rules.suspension_timeout_seconds) {
        return Ok(false);
    }
    let observation = run.latest_observation()?.ok_or(ErrorCode::InvalidRun)?;
    run.terminal = Some(terminal(
        run,
        frame(run),
        run.last_processed_sequence,
        observation,
        TerminalReason::TechnicalAbort,
        Some(suspension.reason),
    )?);
    run.phase = RunPhase::TerminalRecorded;
    run.suspension = None;
    Ok(true)
}

pub fn resume_oracle(run: &mut RunGameState, oracle: &InspectedOracle, now: i64) -> Result<()> {
    require!(
        run.phase == RunPhase::Suspended
            && run.terminal.is_none()
            && run.suspension.is_some_and(|s| matches!(
                s.reason,
                FaultReason::OracleInvalid | FaultReason::OracleStale | FaultReason::SchedulerGap
            )),
        ErrorCode::InvalidRun
    );
    let origin = u64::try_from(now).map_err(|_| error!(ErrorCode::InvalidCrank))?;
    let last = run.latest_observation()?.ok_or(ErrorCode::InvalidRun)?;
    let next = oracle.next_observation(Some(last))?;
    if next != last {
        append_observation(run, next);
    }
    run.phase = RunPhase::Active;
    run.suspension = None;
    run.crank.clock_origin_seconds = origin;
    run.crank.consumed_elapsed_ms = 0;
    Ok(())
}
