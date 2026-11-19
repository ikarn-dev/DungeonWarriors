use anchor_lang::prelude::*;
use anchor_spl::token::TokenAccount;

use super::house::assert_vault;
use crate::{
    constants::*,
    contracts::snapshot_hash,
    economy::max_gross_reservation,
    error::ErrorCode,
    protocol::{FaultReason, RunPhase, TerminalReason, PROTOCOL_VERSION},
    state::{
        collection::PlayerAccount,
        economy::{EscrowStatus, HouseState, RunEscrow},
        records::ResultReceipt,
        run::{RunGameState, RunTerminal},
    },
};

#[derive(Accounts)]
pub struct AbortUndelegatedReservation<'info> {
    #[account(mut, seeds=[RUN_ESCROW_SEED, escrow.snapshot.owner.as_ref(), &escrow.snapshot.nonce.to_le_bytes()],
        bump=escrow.bump, constraint=escrow.schema_version == SCHEMA_VERSION @ ErrorCode::InvalidRun)]
    pub escrow: Box<Account<'info, RunEscrow>>,
    #[account(mut, seeds=[RUN_GAME_SEED, escrow.snapshot.owner.as_ref(), &escrow.snapshot.nonce.to_le_bytes()],
        bump=run.bump, address=escrow.game_state, constraint=run.schema_version == SCHEMA_VERSION @ ErrorCode::InvalidRun)]
    pub run: Box<Account<'info, RunGameState>>,
    #[account(mut, seeds=[PLAYER_SEED, escrow.snapshot.owner.as_ref()], bump=player.bump,
        constraint=player.owner == escrow.snapshot.owner @ ErrorCode::InvalidOwner,
        constraint=player.schema_version == SCHEMA_VERSION @ ErrorCode::InvalidConfiguration)]
    pub player: Box<Account<'info, PlayerAccount>>,
    #[account(mut, seeds=[HOUSE_SEED], bump=house.bump,
        constraint=house.schema_version == SCHEMA_VERSION @ ErrorCode::InvalidConfiguration)]
    pub house: Box<Account<'info, HouseState>>,
    #[account(address=house.vault @ ErrorCode::InvalidVault)]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(init, payer=payer, space=8+ResultReceipt::INIT_SPACE,
        seeds=[RESULT_SEED, escrow.snapshot.owner.as_ref(), &escrow.snapshot.nonce.to_le_bytes()], bump)]
    pub receipt: Box<Account<'info, ResultReceipt>>,
    pub system_program: Program<'info, System>,
}

pub fn handle_abort_undelegated_reservation(
    ctx: Context<AbortUndelegatedReservation>,
) -> Result<()> {
    let a = ctx.accounts;
    let clock = Clock::get()?;
    let snapshot = &a.escrow.snapshot;
    let hash = snapshot_hash(snapshot)?;
    require!(
        snapshot.protocol_version == PROTOCOL_VERSION
            && snapshot.run == a.run.key()
            && a.run.escrow == a.escrow.key()
            && a.run.snapshot == *snapshot
            && a.escrow.snapshot_hash == hash
            && a.run.snapshot_hash == hash,
        ErrorCode::InvalidRun
    );
    // An expired deadline on base never overrides a run that entered delegation.
    require!(
        !a.escrow.delegation_initiated
            && a.escrow.status == EscrowStatus::Reserved
            && a.escrow.receipt.is_none()
            && clock.unix_timestamp >= snapshot.activation_deadline_seconds
            && a.run.phase == RunPhase::Ready
            && a.run.active_ticks == 0
            && a.run.terminal.is_none()
            && a.run.start_observation.is_none()
            && a.run.observation_count == 0
            && a.run.crank.task == Pubkey::default()
            && a.run.crank.generation == 0,
        ErrorCode::ReservationNotRefundable
    );
    let stake = snapshot.stake_base_units;
    require!(
        max_gross_reservation(stake).ok() == Some(snapshot.max_gross_base_units),
        ErrorCode::InvalidRun
    );
    assert_vault(a.house.key(), &a.house, &a.vault)?;
    a.player.available_base_units = a
        .player
        .available_base_units
        .checked_add(stake)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    a.player.locked_stake_base_units = a
        .player
        .locked_stake_base_units
        .checked_sub(stake)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    a.player.settled_runs = a
        .player
        .settled_runs
        .checked_add(1)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    a.player.technical_refunds = a
        .player
        .technical_refunds
        .checked_add(1)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    a.house.total_available_base_units = a
        .house
        .total_available_base_units
        .checked_add(stake)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    a.house.total_max_gross_base_units = a
        .house
        .total_max_gross_base_units
        .checked_sub(snapshot.max_gross_base_units)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    assert_vault(a.house.key(), &a.house, &a.vault)?;

    let terminal = RunTerminal {
        reason: TerminalReason::TechnicalAbort,
        fault: Some(FaultReason::ActivationExpired),
        active_ticks: 0,
        qualified_checkpoints: 0,
        score: 0,
        coins: 0,
        processed_sequence: 0,
        final_observation: None,
        gross_payout_base_units: 0,
        refund_base_units: stake,
    };
    a.receipt.set_inner(ResultReceipt {
        schema_version: SCHEMA_VERSION,
        bump: ctx.bumps.receipt,
        run: snapshot.run,
        owner: snapshot.owner,
        nonce: snapshot.nonce,
        market: snapshot.market,
        snapshot_hash: hash,
        rules: snapshot.rules_binding,
        cat: snapshot.cat,
        oracle: snapshot.oracle,
        start_observation: None,
        stake_base_units: stake,
        terminal,
        settled_at_slot: clock.slot,
        settled_at_seconds: clock.unix_timestamp,
    });
    a.run.terminal = Some(terminal);
    a.run.phase = RunPhase::TerminalRecorded;
    a.escrow.receipt = Some(a.receipt.key());
    a.escrow.status = EscrowStatus::RefundedTechnical;
    Ok(())
}
