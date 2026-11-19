use anchor_lang::prelude::*;

use super::abort_reservation::*;
use crate::{
    constants::{LEADERBOARD_SEED, SCHEMA_VERSION},
    economy::gross_payout,
    error::ErrorCode,
    protocol::{FaultReason, RunPhase, TerminalReason},
    state::{
        economy::EscrowStatus,
        records::{Leaderboard, LeaderboardEntry},
        run::{RunGameState, RunTerminal},
    },
};

#[derive(Accounts)]
pub struct SettleReturnedRun<'info> {
    pub settlement: AbortUndelegatedReservation<'info>,
    #[account(init_if_needed, payer=settlement.payer, space=8+Leaderboard::INIT_SPACE,
        seeds=[LEADERBOARD_SEED, &[settlement.escrow.snapshot.market as u8]], bump)]
    pub leaderboard: Box<Account<'info, Leaderboard>>,
    pub system_program: Program<'info, System>,
}

pub fn handle_settle_returned_run(ctx: Context<SettleReturnedRun>) -> Result<()> {
    let a = &mut ctx.accounts.settlement;
    a.validate_open_reservation()?;
    // The typed account requires Purrps program ownership, which a delegated
    // base mirror lacks. READY or ACTIVE state cannot settle on return.
    require!(
        a.escrow.delegation_initiated
            && matches!(
                a.run.phase,
                RunPhase::TerminalRecorded | RunPhase::CompletionRequested
            ),
        ErrorCode::InvalidRun
    );
    let terminal = a.run.terminal.ok_or(ErrorCode::InvalidRun)?;
    let status = validate_terminal(&a.run, &terminal)?;
    let board = &mut ctx.accounts.leaderboard;
    let snapshot = &a.escrow.snapshot;
    if board.schema_version == 0 {
        board.set_inner(Leaderboard {
            schema_version: SCHEMA_VERSION,
            bump: ctx.bumps.leaderboard,
            market: snapshot.market,
            count: 0,
            entries: Box::new([None; 20]),
        });
    }
    require!(
        board.schema_version == SCHEMA_VERSION
            && board.market == snapshot.market
            && board.bump == ctx.bumps.leaderboard,
        ErrorCode::InvalidRun
    );
    if status != EscrowStatus::RefundedTechnical {
        insert_score(
            board,
            LeaderboardEntry {
                run: snapshot.run,
                owner: snapshot.owner,
                nonce: snapshot.nonce,
                score: terminal.score,
            },
        )?;
    }
    a.finish(
        terminal,
        status,
        ctx.bumps.settlement.receipt,
        Clock::get()?,
    )
}

fn validate_terminal(run: &RunGameState, terminal: &RunTerminal) -> Result<EscrowStatus> {
    let stake = run.snapshot.stake_base_units;
    let checkpoint_ticks = u64::from(run.snapshot.rules.checkpoint_ticks);
    require!(
        checkpoint_ticks > 0
            && terminal.active_ticks == run.active_ticks
            && terminal.qualified_checkpoints == run.qualified_checkpoints
            && terminal.qualified_checkpoints <= terminal.active_ticks / checkpoint_ticks
            && terminal.score == run.score
            && terminal.coins == run.total_coins
            && terminal.processed_sequence == run.last_processed_sequence
            && run.last_processed_sequence <= run.last_accepted_sequence,
        ErrorCode::InvalidRun
    );
    let unactivated = terminal.fault == Some(FaultReason::ActivationExpired);
    if unactivated {
        require!(
            run.observation_count == 0
                && run.start_observation.is_none()
                && terminal.final_observation.is_none()
                && terminal.active_ticks == 0
                && terminal.score == 0
                && terminal.coins == 0
                && terminal.processed_sequence == 0
                && run.last_accepted_sequence == 0,
            ErrorCode::InvalidRun
        );
    } else {
        let start = run.start_observation.ok_or(ErrorCode::InvalidRun)?;
        let count = usize::from(run.observation_count);
        let head = usize::from(run.observation_head);
        let capacity = run.observations.len();
        require!(
            count > 0 && count <= capacity && head < capacity,
            ErrorCode::InvalidRun
        );
        let last = run.observations[(head + count - 1) % capacity];
        require!(
            terminal.final_observation == Some(last)
                && last.sequence >= start.sequence
                && last.posted_slot >= start.posted_slot
                && last.published_at_seconds >= start.published_at_seconds,
            ErrorCode::InvalidRun
        );
    }
    let (status, payout, refund) = match terminal.reason {
        TerminalReason::CashOut | TerminalReason::AutoCashOut if terminal.fault.is_none() => (
            EscrowStatus::SettledWin,
            gross_payout(stake, terminal.qualified_checkpoints)
                .map_err(|_| error!(ErrorCode::InvalidRun))?,
            0,
        ),
        TerminalReason::Crash | TerminalReason::Surrender if terminal.fault.is_none() => {
            (EscrowStatus::SettledLoss, 0, 0)
        }
        TerminalReason::TechnicalAbort if terminal.fault.is_some() => {
            (EscrowStatus::RefundedTechnical, 0, stake)
        }
        _ => return err!(ErrorCode::InvalidRun),
    };
    require!(
        terminal.gross_payout_base_units == payout && terminal.refund_base_units == refund,
        ErrorCode::InvalidRun
    );
    Ok(status)
}

fn insert_score(board: &mut Leaderboard, entry: LeaderboardEntry) -> Result<()> {
    let count = usize::from(board.count);
    require!(count <= board.entries.len(), ErrorCode::InvalidRun);
    let mut index = count;
    for (i, current) in board.entries[..count].iter().enumerate() {
        let current = current.ok_or(ErrorCode::InvalidRun)?;
        require!(current.run != entry.run, ErrorCode::InvalidRun);
        if index == count
            && (entry.score > current.score
                || (entry.score == current.score && entry.run.to_bytes() < current.run.to_bytes()))
        {
            index = i;
        }
    }
    if index < board.entries.len() {
        let limit = (count + 1).min(board.entries.len());
        board.entries.copy_within(index..limit - 1, index + 1);
        board.entries[index] = Some(entry);
        board.count = limit as u8;
    }
    Ok(())
}
