pub use crate::contracts::snapshot_hash;
use crate::{
    constants::*,
    error::ErrorCode,
    protocol::{RunPhase, PROTOCOL_VERSION},
    state::{economy::RunEscrow, run::RunGameState},
};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct InspectRun<'info> {
    #[account(seeds=[RUN_GAME_SEED,run.snapshot.owner.as_ref(),&run.snapshot.nonce.to_le_bytes()],bump=run.bump,
        constraint=run.schema_version==SCHEMA_VERSION @ ErrorCode::InvalidRun,
        constraint=run.snapshot.run==run.key() @ ErrorCode::InvalidRun)]
    pub run: Box<Account<'info, RunGameState>>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct RunStatusView {
    pub phase: RunPhase,
    pub active_ticks: u64,
    pub accepted_sequence: u64,
    pub processed_sequence: u64,
}

pub fn handle_inspect_run(ctx: Context<InspectRun>) -> Result<RunStatusView> {
    let run = &ctx.accounts.run;
    require!(
        run.snapshot.protocol_version == PROTOCOL_VERSION
            && run.snapshot_hash == snapshot_hash(&run.snapshot)?
            && run.last_processed_sequence <= run.last_accepted_sequence,
        ErrorCode::InvalidRun
    );
    let escrow = Pubkey::find_program_address(
        &[
            RUN_ESCROW_SEED,
            run.snapshot.owner.as_ref(),
            &run.snapshot.nonce.to_le_bytes(),
        ],
        &crate::ID,
    )
    .0;
    require_keys_eq!(run.escrow, escrow, ErrorCode::InvalidRun);
    Ok(RunStatusView {
        phase: run.phase,
        active_ticks: run.active_ticks,
        accepted_sequence: run.last_accepted_sequence,
        processed_sequence: run.last_processed_sequence,
    })
}

#[derive(Accounts)]
pub struct InspectRunEscrow<'info> {
    #[account(seeds=[RUN_ESCROW_SEED,escrow.snapshot.owner.as_ref(),&escrow.snapshot.nonce.to_le_bytes()],bump=escrow.bump,
        constraint=escrow.schema_version==SCHEMA_VERSION @ ErrorCode::InvalidRun)]
    pub escrow: Box<Account<'info, RunEscrow>>,
}

pub fn handle_inspect_run_escrow(ctx: Context<InspectRunEscrow>) -> Result<()> {
    let escrow = &ctx.accounts.escrow;
    let run = Pubkey::find_program_address(
        &[
            RUN_GAME_SEED,
            escrow.snapshot.owner.as_ref(),
            &escrow.snapshot.nonce.to_le_bytes(),
        ],
        &crate::ID,
    )
    .0;
    require!(
        escrow.snapshot.protocol_version == PROTOCOL_VERSION
            && escrow.snapshot_hash == snapshot_hash(&escrow.snapshot)?
            && escrow.game_state == run
            && escrow.snapshot.run == run,
        ErrorCode::InvalidRun
    );
    Ok(())
}
