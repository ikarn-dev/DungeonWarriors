use anchor_lang::prelude::*;
use anchor_spl::token::TokenAccount;

use super::{delegation::unplayed_reservation, house::assert_vault};
use crate::{
    constants::*,
    contracts::snapshot_hash,
    economy::valid_gross_cap,
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

impl AbortUndelegatedReservation<'_> {
    pub(super) fn validate_open_reservation(&self) -> Result<()> {
        let snapshot = &self.escrow.snapshot;
        let hash = snapshot_hash(snapshot)?;
        require!(
            snapshot.protocol_version == PROTOCOL_VERSION
                && snapshot.run == self.run.key()
                && self.run.escrow == self.escrow.key()
                && self.run.snapshot == *snapshot
                && self.escrow.snapshot_hash == hash
                && self.run.snapshot_hash == hash
                && self.escrow.status == EscrowStatus::Reserved
                && self.escrow.receipt.is_none()
                && valid_gross_cap(
                    snapshot.stake_base_units,
                    snapshot.max_gross_base_units,
                    snapshot.rules.max_multiplier_bps,
                ),
            ErrorCode::InvalidRun
        );
        Ok(())
    }

    pub(super) fn finish(
        &mut self,
        terminal: RunTerminal,
        status: EscrowStatus,
        receipt_bump: u8,
        clock: Clock,
    ) -> Result<()> {
        let snapshot = &self.escrow.snapshot;
        let credit = terminal
            .gross_payout_base_units
            .checked_add(terminal.refund_base_units)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        require!(
            credit <= snapshot.max_gross_base_units,
            ErrorCode::InvalidRun
        );
        assert_vault(self.house.key(), &self.house, &self.vault)?;
        self.player.available_base_units = self
            .player
            .available_base_units
            .checked_add(credit)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        self.player.locked_stake_base_units = self
            .player
            .locked_stake_base_units
            .checked_sub(snapshot.stake_base_units)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        self.player.settled_runs = self
            .player
            .settled_runs
            .checked_add(1)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        let counter = match status {
            EscrowStatus::SettledWin => &mut self.player.wins,
            EscrowStatus::SettledLoss => &mut self.player.losses,
            EscrowStatus::RefundedTechnical => &mut self.player.technical_refunds,
            EscrowStatus::Reserved => return err!(ErrorCode::InvalidRun),
        };
        *counter = counter
            .checked_add(1)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        self.house.total_available_base_units = self
            .house
            .total_available_base_units
            .checked_add(credit)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        self.house.total_max_gross_base_units = self
            .house
            .total_max_gross_base_units
            .checked_sub(snapshot.max_gross_base_units)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        assert_vault(self.house.key(), &self.house, &self.vault)?;
        self.receipt.set_inner(ResultReceipt {
            schema_version: SCHEMA_VERSION,
            bump: receipt_bump,
            run: snapshot.run,
            owner: snapshot.owner,
            nonce: snapshot.nonce,
            market: snapshot.market,
            snapshot_hash: self.escrow.snapshot_hash,
            rules: snapshot.rules_binding,
            cat: snapshot.cat,
            oracle: snapshot.oracle,
            start_observation: self.run.start_observation,
            stake_base_units: snapshot.stake_base_units,
            terminal,
            settled_at_slot: clock.slot,
            settled_at_seconds: clock.unix_timestamp,
        });
        self.escrow.receipt = Some(self.receipt.key());
        self.escrow.status = status;
        Ok(())
    }
}

pub fn handle_abort_undelegated_reservation(
    ctx: Context<AbortUndelegatedReservation>,
) -> Result<()> {
    let a = ctx.accounts;
    let clock = Clock::get()?;
    a.validate_open_reservation()?;
    // Base time cannot determine whether a delegated run earned progress.
    require!(
        !a.escrow.delegation_initiated
            && clock.unix_timestamp >= a.escrow.snapshot.activation_deadline_seconds
            && unplayed_reservation(&a.run),
        ErrorCode::ReservationNotRefundable
    );
    let terminal = activation_expired(a.escrow.snapshot.stake_base_units);
    a.finish(
        terminal,
        EscrowStatus::RefundedTechnical,
        ctx.bumps.receipt,
        clock,
    )?;
    a.run.terminal = Some(terminal);
    a.run.phase = RunPhase::TerminalRecorded;
    Ok(())
}

pub(super) fn activation_expired(stake: u64) -> RunTerminal {
    RunTerminal {
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
    }
}
