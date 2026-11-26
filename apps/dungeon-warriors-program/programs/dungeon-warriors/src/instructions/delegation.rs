use anchor_lang::{prelude::*, system_program};
use ephemeral_rollups_sdk::{
    anchor::DelegationProgram,
    consts::{DELEGATION_PROGRAM_ID, MAGIC_CONTEXT_ID, MAGIC_PROGRAM_ID},
    cpi::{delegate_account, undelegate_account, DelegateAccounts, DelegateConfig},
    pda::{
        delegation_metadata_pda_from_delegated_account,
        delegation_record_pda_from_delegated_account, undelegate_buffer_pda_from_delegated_account,
        DELEGATE_BUFFER_TAG,
    },
};

use super::{
    abort_reservation::activation_expired, run_crank::CRANK_RENT_HEADROOM,
    run_inputs::validate_input_snapshot,
};
use crate::{
    constants::*,
    error::ErrorCode,
    instruction_args::RunIdentityArgs,
    protocol::RunPhase,
    state::{
        config::GameConfig,
        economy::{EscrowStatus, RunEscrow},
        run::RunGameState,
    },
};

#[derive(Accounts)]
pub struct DelegateRun<'info> {
    #[account(seeds=[GAME_CONFIG_SEED],bump=config.bump,constraint=config.schema_version==SCHEMA_VERSION @ ErrorCode::InvalidConfiguration)]
    pub config: Box<Account<'info, GameConfig>>,
    #[account(mut,seeds=[RUN_ESCROW_SEED,escrow.snapshot.owner.as_ref(),&escrow.snapshot.nonce.to_le_bytes()],
        bump=escrow.bump,constraint=escrow.schema_version==SCHEMA_VERSION @ ErrorCode::InvalidRun)]
    pub escrow: Box<Account<'info, RunEscrow>>,
    /// CHECK: Pinned to the reservation. Deserialize before changing ownership through the SDK.
    #[account(mut,address=escrow.game_state @ ErrorCode::InvalidRun,owner=crate::ID)]
    pub run: UncheckedAccount<'info>,
    pub authority: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: The SDK uses this program to derive the signer and transfer ownership.
    #[account(address=crate::ID,executable)]
    pub owner_program: UncheckedAccount<'info>,
    /// CHECK: SDK allocates the exact temporary PDA.
    #[account(mut,seeds=[DELEGATE_BUFFER_TAG,run.key().as_ref()],bump)]
    pub buffer: UncheckedAccount<'info>,
    /// CHECK: Delegation Program allocates its canonical record and metadata.
    #[account(mut,address=delegation_record_pda_from_delegated_account(&run.key()))]
    pub delegation_record: UncheckedAccount<'info>,
    /// CHECK: Bound to the same run and validated by the Delegation Program.
    #[account(mut,address=delegation_metadata_pda_from_delegated_account(&run.key()))]
    pub delegation_metadata: UncheckedAccount<'info>,
    pub delegation_program: Program<'info, DelegationProgram>,
    pub system_program: Program<'info, System>,
}

pub fn handle_delegate_run(ctx: Context<DelegateRun>, args: RunIdentityArgs) -> Result<()> {
    let a = ctx.accounts;
    require!(a.config.allow_reservations, ErrorCode::AdmissionClosed);
    let escrow = &a.escrow;
    let snapshot = &escrow.snapshot;
    let now = Clock::get()?.unix_timestamp;
    let permitted = &snapshot.input_permission;
    require!(
        now < permitted.expires_at_seconds
            && (a.authority.key() == snapshot.owner || a.authority.key() == permitted.input_key),
        ErrorCode::InvalidSession
    );
    require!(
        args.nonce == snapshot.nonce
            && args.delegation_epoch == snapshot.delegation_epoch
            && escrow.status == EscrowStatus::Reserved
            && !escrow.delegation_initiated
            && escrow.receipt.is_none()
            && now < snapshot.activation_deadline_seconds,
        ErrorCode::InvalidRun
    );
    let nonce = snapshot.nonce.to_le_bytes();
    let key = a.run.key();
    let pda_seeds = &[RUN_GAME_SEED, snapshot.owner.as_ref(), &nonce];
    let (address, bump) = Pubkey::find_program_address(pda_seeds, &crate::ID);
    require_keys_eq!(address, key, ErrorCode::InvalidRun);
    {
        let data = a.run.try_borrow_data()?;
        let run = Box::new(RunGameState::try_deserialize(&mut data.as_ref())?);
        validate_input_snapshot(&run)?;
        require!(
            run.schema_version == SCHEMA_VERSION
                && run.bump == bump
                && snapshot.run == key
                && run.snapshot == *snapshot
                && run.escrow == escrow.key()
                && run.snapshot_hash == escrow.snapshot_hash
                && unplayed_reservation(&run),
            ErrorCode::InvalidRun
        );
    }
    let rent = Rent::get()?.minimum_balance(a.run.data_len());
    let headroom = a.run.lamports().saturating_sub(rent);
    if headroom < CRANK_RENT_HEADROOM {
        system_program::transfer(
            CpiContext::new(
                a.system_program.key(),
                system_program::Transfer {
                    from: a.payer.to_account_info(),
                    to: a.run.to_account_info(),
                },
            ),
            CRANK_RENT_HEADROOM - headroom,
        )?;
    }
    delegate_account(
        DelegateAccounts {
            payer: &a.payer.to_account_info(),
            pda: &a.run.to_account_info(),
            owner_program: &a.owner_program.to_account_info(),
            buffer: &a.buffer.to_account_info(),
            delegation_record: &a.delegation_record.to_account_info(),
            delegation_metadata: &a.delegation_metadata.to_account_info(),
            delegation_program: &a.delegation_program.to_account_info(),
            system_program: &a.system_program.to_account_info(),
        },
        pda_seeds,
        DelegateConfig {
            commit_frequency_ms: u32::MAX,
            validator: Some(snapshot.oracle.validator),
        },
    )?;
    a.escrow.delegation_initiated = true;
    Ok(())
}

pub(super) fn unplayed_reservation(run: &RunGameState) -> bool {
    run.phase == RunPhase::Ready
        && run.active_ticks == 0
        && run.score == 0
        && run.total_coins == 0
        && run.qualified_checkpoints == 0
        && run.last_accepted_sequence == 0
        && run.last_processed_sequence == 0
        && run.intent_count == 0
        && run.start_observation.is_none()
        && run.observation_count == 0
        && run.suspension.is_none()
        && run.terminal.is_none()
        && run.crank.task == Pubkey::default()
        && run.crank.generation == 0
        && run.crank.completion_attempts == 0
}

#[derive(Accounts)]
pub struct ExpireDelegatedActivation<'info> {
    #[account(seeds=[RUN_ESCROW_SEED,escrow.snapshot.owner.as_ref(),&escrow.snapshot.nonce.to_le_bytes()],
        bump=escrow.bump,constraint=escrow.schema_version==SCHEMA_VERSION @ ErrorCode::InvalidRun)]
    pub escrow: Box<Account<'info, RunEscrow>>,
    #[account(mut,address=escrow.game_state @ ErrorCode::InvalidRun,
        seeds=[RUN_GAME_SEED,escrow.snapshot.owner.as_ref(),&escrow.snapshot.nonce.to_le_bytes()],bump=run.bump)]
    pub run: Box<Account<'info, RunGameState>>,
    /// CHECK: This native Magic Context exists on the ER. It is never used as writable data here.
    #[account(address=MAGIC_CONTEXT_ID,owner=MAGIC_PROGRAM_ID)]
    pub magic_context: UncheckedAccount<'info>,
}

pub fn handle_expire_delegated_activation(ctx: Context<ExpireDelegatedActivation>) -> Result<()> {
    let a = ctx.accounts;
    let snapshot = &a.escrow.snapshot;
    validate_input_snapshot(&a.run)?;
    require!(
        a.escrow.delegation_initiated
            && a.escrow.status == EscrowStatus::Reserved
            && a.escrow.receipt.is_none()
            && snapshot.run == a.run.key()
            && a.run.schema_version == SCHEMA_VERSION
            && a.run.escrow == a.escrow.key()
            && a.run.snapshot == *snapshot
            && a.run.snapshot_hash == a.escrow.snapshot_hash
            && Clock::get()?.unix_timestamp >= snapshot.activation_deadline_seconds
            && unplayed_reservation(&a.run),
        ErrorCode::ReservationNotRefundable
    );
    a.run.terminal = Some(activation_expired(snapshot.stake_base_units));
    a.run.phase = RunPhase::TerminalRecorded;
    Ok(())
}

#[derive(Accounts)]
pub struct ReturnDelegatedRun<'info> {
    /// CHECK: The callback binds the run address to a program snapshot in the signed buffer.
    #[account(mut)]
    pub base_account: UncheckedAccount<'info>,
    /// CHECK: Only the Delegation Program can sign for this exact buffer.
    #[account(signer,owner=DELEGATION_PROGRAM_ID,
        address=undelegate_buffer_pda_from_delegated_account(&base_account.key()))]
    pub buffer: UncheckedAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handle_process_undelegation(
    ctx: Context<ReturnDelegatedRun>,
    account_seeds: Vec<Vec<u8>>,
) -> Result<()> {
    let a = ctx.accounts;
    {
        let data = a.buffer.try_borrow_data()?;
        if !super::dungeon_delivery::matches_dungeon_settlement(
            a.base_account.key(),
            &data,
            &account_seeds,
        ) {
            require!(
                data.len() == 8 + RunGameState::INIT_SPACE,
                ErrorCode::InvalidRun
            );
            let run = Box::new(RunGameState::try_deserialize(&mut data.as_ref())?);
            validate_input_snapshot(&run)?;
            let owner = run.snapshot.owner;
            let nonce = run.snapshot.nonce.to_le_bytes();
            let expected: &[&[u8]] = &[RUN_GAME_SEED, owner.as_ref(), &nonce];
            let (key, bump) = Pubkey::find_program_address(expected, &crate::ID);
            let escrow = Pubkey::find_program_address(
                &[RUN_ESCROW_SEED, owner.as_ref(), &nonce],
                &crate::ID,
            )
            .0;
            require!(
                run.schema_version == SCHEMA_VERSION
                    && key == a.base_account.key()
                    && key == run.snapshot.run
                    && run.bump == bump
                    && run.escrow == escrow
                    && account_seeds.len() == expected.len()
                    && account_seeds
                        .iter()
                        .zip(expected)
                        .all(|(actual, expected)| actual == *expected),
                ErrorCode::InvalidRun
            );
        }
    }
    undelegate_account(
        &a.base_account.to_account_info(),
        &crate::ID,
        &a.buffer.to_account_info(),
        &a.payer.to_account_info(),
        &a.system_program.to_account_info(),
        account_seeds,
    )?;
    Ok(())
}
