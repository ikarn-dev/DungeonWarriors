use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::consts::{MAGIC_CONTEXT_ID, MAGIC_PROGRAM_ID};
use super::run_inputs::validate_input_snapshot;
use crate::{
    constants::{GAME_CONFIG_SEED, RUN_GAME_SEED, SCHEMA_VERSION},
    economy::capped_gross_payout, error::ErrorCode, protocol::{FaultReason, RunPhase, TerminalReason}, rules::RULES_V4,
    state::{config::GameConfig, run::{OracleObservation, RunGameState, RunTerminal}},
};
pub const BROWSER_VERIFIER_SEED: &[u8] = b"browser-verifier";

// Explicitly trusted to replay witnessed prices and timed inputs. No withdrawal
// permission. Results remain bounded by each previously reserved escrow.
#[account]
#[derive(InitSpace)]
pub struct BrowserVerifier { pub authority: Pubkey }

#[derive(Accounts)]
pub struct ConfigureBrowserVerifier<'info> {
    #[account(seeds=[GAME_CONFIG_SEED],bump=config.bump,has_one=admin)]
    pub config: Account<'info, GameConfig>,
    #[account(mut)] pub admin: Signer<'info>,
    #[account(init,payer=admin,space=8+BrowserVerifier::INIT_SPACE,seeds=[BROWSER_VERIFIER_SEED],bump)]
    pub browser_verifier: Account<'info, BrowserVerifier>,
    pub system_program: Program<'info, System>,
}
pub fn configure(ctx: Context<ConfigureBrowserVerifier>, authority: Pubkey) -> Result<()> {
    require!(authority != Pubkey::default() && authority != ctx.accounts.admin.key(), ErrorCode::InvalidRun);
    ctx.accounts.browser_verifier.authority = authority;
    Ok(())
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct BrowserResult {
    pub snapshot_hash: [u8; 32], pub reason: TerminalReason, pub active_ticks: u64,
    pub score: u64, pub coins: u64, pub qualified_checkpoints: u64,
    pub final_observation: OracleObservation,
}
#[derive(Accounts)]
pub struct RecordBrowserResult<'info> {
    #[account(mut,seeds=[RUN_GAME_SEED,run.snapshot.owner.as_ref(),&run.snapshot.nonce.to_le_bytes()],
        bump=run.bump,constraint=run.schema_version==SCHEMA_VERSION @ ErrorCode::InvalidRun)]
    pub run: Box<Account<'info, RunGameState>>,
    #[account(seeds=[BROWSER_VERIFIER_SEED],bump,has_one=authority)]
    pub browser_verifier: Account<'info, BrowserVerifier>,
    pub authority: Signer<'info>,
    /// CHECK: Only the native rollup context can record results.
    #[account(address=MAGIC_CONTEXT_ID,owner=MAGIC_PROGRAM_ID)]
    pub magic_context: UncheckedAccount<'info>,
}
pub fn record(ctx: Context<RecordBrowserResult>, args: BrowserResult) -> Result<()> {
    let run = &mut ctx.accounts.run;
    validate_input_snapshot(run)?;
    let start = run.start_observation.ok_or(ErrorCode::InvalidRun)?;
    let current = args.final_observation;
    let origin = i64::try_from(run.crank.clock_origin_seconds).map_err(|_| error!(ErrorCode::InvalidRun))?;
    let elapsed = Clock::get()?.unix_timestamp.min(run.snapshot.input_permission.expires_at_seconds)
        .checked_sub(origin).ok_or(ErrorCode::InvalidRun)?;
    let max_ticks = u64::try_from(elapsed).map_err(|_| error!(ErrorCode::InvalidRun))?
        .checked_mul(u64::from(RULES_V4.ticks_per_second)).ok_or(ErrorCode::ArithmeticOverflow)?;
    require!(
        run.snapshot.rules_binding.version==RULES_V4.rules_version
        && run.snapshot_hash==args.snapshot_hash && run.snapshot.run==run.key()
        && run.phase==RunPhase::Active && run.terminal.is_none() && run.crank.generation==0
        && origin>0 && args.active_ticks<=max_ticks
        && args.qualified_checkpoints<=args.active_ticks/u64::from(RULES_V4.checkpoint_ticks)
        && current.sequence>=start.sequence && current.posted_slot>=start.posted_slot
        && current.published_at_seconds>=start.published_at_seconds
        && current.exponent==start.exponent && current.price>0,
        ErrorCode::InvalidRun
    );
    let gross=match args.reason {
        TerminalReason::CashOut|TerminalReason::AutoCashOut=>
            capped_gross_payout(run.snapshot.stake_base_units,args.qualified_checkpoints,
                run.snapshot.max_gross_base_units,&run.snapshot.rules).map_err(|_| error!(ErrorCode::InvalidRun))?,
        TerminalReason::Crash|TerminalReason::Surrender=>0,
        TerminalReason::TechnicalAbort => {
            require!(args.active_ticks==0 && args.score==0 && args.coins==0
                && args.qualified_checkpoints==0, ErrorCode::InvalidRun);
            0
        },
    };
    run.observations[0]=current; run.observation_head=0; run.observation_count=1;
    run.phase=RunPhase::TerminalRecorded; run.entity_count=0; run.active_ticks=args.active_ticks;
    run.score=args.score; run.total_coins=args.coins; run.qualified_checkpoints=args.qualified_checkpoints;
    run.terminal=Some(RunTerminal {
        reason:args.reason,fault:(args.reason==TerminalReason::TechnicalAbort).then_some(FaultReason::SchedulerGap),active_ticks:args.active_ticks,
        qualified_checkpoints:args.qualified_checkpoints,score:args.score,coins:args.coins,
        processed_sequence:0,final_observation:Some(current),
        gross_payout_base_units:gross,refund_base_units:if args.reason==TerminalReason::TechnicalAbort { run.snapshot.stake_base_units } else { 0 },
    });
    Ok(())
}
