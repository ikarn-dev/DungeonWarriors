pub mod lifecycle;

use anchor_lang::prelude::*;

use crate::{
    error::ErrorCode,
    protocol::{
        validate_intent_batch, AcceptedIntent, InputAxis, IntentContext, IntentEnvelope,
        PlayerIntent,
    },
    state::run::{RunGameState, MAX_QUEUED_INTENTS},
};

pub fn enqueue_intents(
    run: &mut RunGameState,
    signer: Pubkey,
    now_seconds: i64,
    intents: &[IntentEnvelope],
    counts_as_controls: bool,
) -> Result<()> {
    let capacity = run.intents.len();
    let head = usize::from(run.intent_head);
    let queued = usize::from(run.intent_count);
    require!(
        capacity == MAX_QUEUED_INTENTS
            && head < capacity
            && run.terminal.is_none()
            && run
                .last_accepted_sequence
                .checked_sub(run.last_processed_sequence)
                == Some(queued as u64)
            && now_seconds >= run.control_window_seconds,
        ErrorCode::InvalidRun
    );
    validate_intent_batch(
        intents,
        &run.snapshot.input_permission,
        &IntentContext {
            run: run.snapshot.run,
            owner: run.snapshot.owner,
            program: crate::ID,
            signer,
            rules_version: run.snapshot.rules_binding.version,
            phase: run.phase,
            now_seconds,
            revoked: run.input_key_revoked,
            last_accepted_sequence: run.last_accepted_sequence,
            queued_intents: queued,
            queue_capacity: usize::from(run.snapshot.rules.max_queued_intents),
        },
    )
    .map_err(|_| error!(ErrorCode::InvalidRunInput))?;
    let mut controls = if now_seconds == run.control_window_seconds {
        run.control_updates_in_window
    } else {
        0
    };
    if counts_as_controls {
        let inactive = (0..queued)
            .rev()
            .filter_map(|offset| run.intents[(head + offset) % capacity])
            .find_map(|entry| match entry.envelope.action {
                PlayerIntent::Heartbeat { active } => Some(!active),
                PlayerIntent::Inactive => Some(true),
                _ => None,
            })
            .unwrap_or(run.inactive_exit_tick.is_some());
        require!(
            !inactive
                || intents.iter().all(|entry| matches!(
                    entry.action,
                    PlayerIntent::CashOut | PlayerIntent::Surrender
                )),
            ErrorCode::InvalidRunInput
        );
        controls = controls
            .checked_add(intents.len() as u8)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        require!(
            controls <= run.snapshot.rules.max_control_updates_per_second,
            ErrorCode::ControlRateExceeded
        );
    }
    let order = run
        .last_accepted_order
        .checked_add(intents.len() as u64)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    let tick = run
        .active_ticks
        .checked_add(1)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    require!(
        (queued..queued + intents.len())
            .all(|offset| run.intents[(head + offset) % capacity].is_none()),
        ErrorCode::InvalidRun
    );
    for (offset, &envelope) in intents.iter().enumerate() {
        run.intents[(head + queued + offset) % capacity] = Some(AcceptedIntent {
            envelope,
            assigned_tick: tick,
            accepted_order: run.last_accepted_order + offset as u64 + 1,
        });
    }
    run.intent_count += intents.len() as u8;
    run.last_accepted_sequence = intents[intents.len() - 1].client_sequence;
    run.last_accepted_order = order;
    run.control_window_seconds = now_seconds;
    run.control_updates_in_window = controls;
    Ok(())
}

pub fn revoke_input_key(run: &mut RunGameState) -> Result<()> {
    let deadline = run
        .active_ticks
        .checked_add(u64::from(run.snapshot.rules.heartbeat_grace_ticks))
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    run.key_exit_tick = Some(
        run.key_exit_tick
            .map_or(deadline, |earlier| earlier.min(deadline)),
    );
    run.input_key_revoked = true;
    run.runner.axis = InputAxis::Neutral;
    Ok(())
}
