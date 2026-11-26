use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::consts::{MAGIC_CONTEXT_ID, MAGIC_PROGRAM_ID};

use crate::{
    constants::{RUN_GAME_SEED, SCHEMA_VERSION},
    contracts::snapshot_hash,
    error::ErrorCode,
    instruction_args::SubmitIntentsArgs,
    protocol::{IntentEnvelope, PlayerIntent, RunPhase, PROTOCOL_VERSION},
    run_engine::{enqueue_intents, revoke_input_key},
    state::run::RunGameState,
};

#[derive(Accounts)]
pub struct RunInput<'info> {
    #[account(mut, seeds=[RUN_GAME_SEED,run.snapshot.owner.as_ref(),&run.snapshot.nonce.to_le_bytes()],
        bump=run.bump, constraint=run.schema_version == SCHEMA_VERSION @ ErrorCode::InvalidRun,
        constraint=run.snapshot.run == run.key() @ ErrorCode::InvalidRun)]
    pub run: Box<Account<'info, RunGameState>>,
    pub authority: Signer<'info>,
    /// CHECK: Fixed MagicBlock native account. Base Solana lacks the ER context.
    #[account(address=MAGIC_CONTEXT_ID,owner=MAGIC_PROGRAM_ID)]
    pub magic_context: UncheckedAccount<'info>,
}

pub(super) fn validate_input_snapshot(run: &RunGameState) -> Result<()> {
    require!(
        run.snapshot.protocol_version == PROTOCOL_VERSION
            && run.snapshot_hash == snapshot_hash(&run.snapshot)?,
        ErrorCode::InvalidRun
    );
    Ok(())
}

pub fn handle_submit_intents(ctx: Context<RunInput>, args: SubmitIntentsArgs) -> Result<()> {
    let run = &mut ctx.accounts.run;
    validate_input_snapshot(run)?;
    require!(
        run.snapshot.rules.rules_version < crate::rules::RULES_V4.rules_version
            && args.intents.iter().all(|entry| {
            !matches!(
                entry.action,
                PlayerIntent::Heartbeat { .. } | PlayerIntent::Inactive
            )
        }),
        ErrorCode::InvalidRunInput
    );
    enqueue_intents(
        run,
        ctx.accounts.authority.key(),
        Clock::get()?.unix_timestamp,
        &args.intents,
        true,
    )
}

pub fn handle_heartbeat(ctx: Context<RunInput>, intent: IntentEnvelope) -> Result<()> {
    let run = &mut ctx.accounts.run;
    validate_input_snapshot(run)?;
    require!(
        run.snapshot.rules.rules_version < crate::rules::RULES_V4.rules_version
            && matches!(
            intent.action,
            PlayerIntent::Heartbeat { .. } | PlayerIntent::Inactive
        ),
        ErrorCode::InvalidRunInput
    );
    enqueue_intents(
        run,
        ctx.accounts.authority.key(),
        Clock::get()?.unix_timestamp,
        &[intent],
        false,
    )
}

pub fn handle_revoke_run_input_key(ctx: Context<RunInput>) -> Result<()> {
    let run = &mut ctx.accounts.run;
    validate_input_snapshot(run)?;
    require_keys_eq!(
        ctx.accounts.authority.key(),
        run.snapshot.owner,
        ErrorCode::InvalidOwner
    );
    require!(
        matches!(run.phase, RunPhase::Active | RunPhase::Suspended) && run.terminal.is_none(),
        ErrorCode::InvalidRun
    );
    revoke_input_key(run)
}
