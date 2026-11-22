use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::consts::{MAGIC_CONTEXT_ID, MAGIC_PROGRAM_ID};

use super::{
    run_crank::{CLOCK_CREDIT_MS, MAX_CLOCK_BACKLOG_MS},
    run_inputs::validate_input_snapshot,
};
use crate::{
    constants::{RUN_GAME_SEED, SCHEMA_VERSION},
    error::ErrorCode,
    oracle::inspect_account,
    protocol::{FaultReason, RunPhase},
    run_engine::lifecycle::{expire_suspension, resume_oracle, suspend},
    state::run::RunGameState,
};

#[derive(Accounts)]
pub struct RecoverRunOracle<'info> {
    #[account(mut, seeds=[RUN_GAME_SEED,run.snapshot.owner.as_ref(),&run.snapshot.nonce.to_le_bytes()],
        bump=run.bump, constraint=run.schema_version == SCHEMA_VERSION @ ErrorCode::InvalidRun,
        constraint=run.snapshot.run == run.key() @ ErrorCode::InvalidRun)]
    pub run: Box<Account<'info, RunGameState>>,
    /// CHECK: Pin address before classifying an oracle failure. A payer cannot substitute a missing feed.
    #[account(address = run.snapshot.oracle.account @ ErrorCode::InvalidOracleData)]
    pub price_update: UncheckedAccount<'info>,
    /// CHECK: Fixed MagicBlock native account. Base Solana lacks the ER context.
    #[account(address=MAGIC_CONTEXT_ID,owner=MAGIC_PROGRAM_ID)]
    pub magic_context: UncheckedAccount<'info>,
}

pub fn handle_recover_run_oracle(
    ctx: Context<RecoverRunOracle>,
    expected_suspension: Option<i64>,
) -> Result<()> {
    let a = ctx.accounts;
    let run = &mut a.run;
    validate_input_snapshot(run)?;
    require!(
        matches!(run.phase, RunPhase::Active | RunPhase::Suspended) && run.terminal.is_none(),
        ErrorCode::InvalidRun
    );
    let clock = Clock::get()?;
    if let Some(expected) = expected_suspension {
        let [play_key] = ctx.remaining_accounts else {
            return err!(ErrorCode::InvalidSession);
        };
        let permission = &run.snapshot.input_permission;
        require!(
            play_key.is_signer
                && play_key.key() == permission.input_key
                && !run.input_key_revoked
                && clock.unix_timestamp < permission.expires_at_seconds,
            ErrorCode::InvalidSession
        );
        let suspension = run.suspension.ok_or(ErrorCode::InvalidRun)?;
        require!(
            run.phase == RunPhase::Suspended
                && suspension.started_at_seconds == expected
                && clock.unix_timestamp > expected
                && clock.unix_timestamp.saturating_sub(expected)
                    < i64::from(run.snapshot.rules.suspension_timeout_seconds),
            ErrorCode::InvalidRun
        );
        let oracle = read_quote(run, &a.price_update, &clock)?;
        return resume_oracle(run, &oracle, clock.unix_timestamp);
    }
    if run.phase == RunPhase::Active && run.crank.generation > 0 {
        // Clock credit trails by one second, and the backlog must exceed the limit.
        let fault_at = run.crank.clock_origin_seconds.saturating_add(
            2 + run
                .crank
                .consumed_elapsed_ms
                .saturating_add(MAX_CLOCK_BACKLOG_MS)
                / CLOCK_CREDIT_MS,
        );
        let deadline =
            fault_at.saturating_add(u64::from(run.snapshot.rules.suspension_timeout_seconds));
        if u64::try_from(clock.unix_timestamp).is_ok_and(|now| now >= deadline) {
            suspend(
                run,
                FaultReason::SchedulerGap,
                i64::try_from(fault_at).map_err(|_| error!(ErrorCode::ArithmeticOverflow))?,
            )?;
            expire_suspension(run, clock.unix_timestamp)?;
            return Ok(());
        }
    }
    if run.phase == RunPhase::Suspended {
        expire_suspension(run, clock.unix_timestamp)?;
        return Ok(());
    }
    if let Err(error) = read_quote(run, &a.price_update, &clock) {
        let fault = if matches!(error, anchor_lang::error::Error::AnchorError(ref e) if e.error_name == "StaleOracle")
        {
            FaultReason::OracleStale
        } else {
            FaultReason::OracleInvalid
        };
        suspend(run, fault, clock.unix_timestamp)?;
    }
    Ok(())
}

fn read_quote(
    run: &RunGameState,
    price_update: &UncheckedAccount,
    clock: &Clock,
) -> Result<crate::oracle::InspectedOracle> {
    let last = run.latest_observation()?.ok_or(ErrorCode::InvalidRun)?;
    let data = price_update.try_borrow_data()?;
    let oracle = inspect_account(
        price_update.key,
        price_update.owner,
        &data,
        &run.snapshot.oracle,
        run.snapshot.market,
        clock.unix_timestamp,
        clock.slot,
    )?;
    oracle.next_observation(Some(last))?;
    Ok(oracle)
}
