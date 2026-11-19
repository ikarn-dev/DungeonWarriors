use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::consts::{MAGIC_CONTEXT_ID, MAGIC_PROGRAM_ID};

use super::run_inputs::validate_input_snapshot;
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

pub fn handle_recover_run_oracle(ctx: Context<RecoverRunOracle>) -> Result<()> {
    let a = ctx.accounts;
    let run = &mut a.run;
    validate_input_snapshot(run)?;
    require!(
        matches!(run.phase, RunPhase::Active | RunPhase::Suspended) && run.terminal.is_none(),
        ErrorCode::InvalidRun
    );
    let clock = Clock::get()?;
    if run.phase == RunPhase::Suspended && expire_suspension(run, clock.unix_timestamp)? {
        return Ok(());
    }
    let last = run.latest_observation()?.ok_or(ErrorCode::InvalidRun)?;
    let data = a.price_update.try_borrow_data()?;
    let quote = inspect_account(
        a.price_update.key,
        a.price_update.owner,
        &data,
        &run.snapshot.oracle,
        run.snapshot.market,
        clock.unix_timestamp,
        clock.slot,
    )
    .and_then(|oracle| {
        oracle.next_observation(Some(last))?;
        Ok(oracle)
    });
    match (run.phase, quote) {
        (RunPhase::Suspended, Ok(oracle))
            if run.suspension.is_some_and(|s| {
                matches!(
                    s.reason,
                    FaultReason::OracleInvalid | FaultReason::OracleStale
                )
            }) =>
        {
            resume_oracle(run, &oracle, clock.unix_timestamp)
        }
        (RunPhase::Active, Err(error)) => {
            let fault = if matches!(error, anchor_lang::error::Error::AnchorError(ref e) if e.error_name == "StaleOracle")
            {
                FaultReason::OracleStale
            } else {
                FaultReason::OracleInvalid
            };
            suspend(run, fault, clock.unix_timestamp)
        }
        _ => Ok(()),
    }
}
