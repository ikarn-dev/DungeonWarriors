use anchor_lang::{prelude::*, solana_program::program::invoke_signed};
use ephemeral_rollups_sdk::{
    anchor::DelegationProgram, instruction_builder::close_ephemeral_balance,
};

use super::completion::{completion_balance, COMPLETION_ESCROW_INDEX};
use crate::{
    constants::*,
    error::ErrorCode,
    state::{
        economy::{EscrowStatus, RunEscrow, SponsorBudget, SponsorPurpose},
        run::RunGameState,
    },
};

#[derive(Accounts)]
pub struct FundRunCompletion<'info> {
    #[account(seeds=[RUN_ESCROW_SEED,run_escrow.snapshot.owner.as_ref(),&run_escrow.snapshot.nonce.to_le_bytes()],
        bump=run_escrow.bump, constraint=run_escrow.schema_version == SCHEMA_VERSION @ ErrorCode::InvalidRun)]
    pub run_escrow: Box<Account<'info, RunEscrow>>,
    #[account(mut, address=run_escrow.sponsor_budget @ ErrorCode::InvalidSponsorBudget,
        seeds=[SPONSOR_SEED,run_escrow.game_state.as_ref()],bump=budget.bump)]
    pub budget: Box<Account<'info, SponsorBudget>>,
    #[account(address=budget.authority @ ErrorCode::InvalidSponsorBudget)]
    pub sponsor: Signer<'info>,
    #[account(mut,address=completion_balance(run_escrow.game_state) @ ErrorCode::InvalidSponsorBudget)]
    pub action_balance: SystemAccount<'info>,
}

pub fn handle_fund_run_completion(ctx: Context<FundRunCompletion>) -> Result<()> {
    let a = ctx.accounts;
    let budget = &mut a.budget;
    let amount = budget.reserved_completion_lamports;
    let remaining = budget
        .get_lamports()
        .saturating_sub(Rent::get()?.minimum_balance(budget.to_account_info().data_len()));
    require!(
        a.run_escrow.status == EscrowStatus::Reserved
            && a.run_escrow.receipt.is_none()
            && budget.schema_version == SCHEMA_VERSION
            && budget.purpose == SponsorPurpose::RunCompletion
            && budget.operation == a.run_escrow.game_state
            && budget.beneficiary == a.run_escrow.snapshot.owner
            && budget.spent_lamports == 0
            && amount > 0
            && amount <= budget.limit_lamports
            && amount <= remaining
            && a.action_balance.data_is_empty(),
        ErrorCode::InvalidSponsorBudget
    );
    budget.sub_lamports(amount)?;
    a.action_balance.add_lamports(amount)?;
    budget.spent_lamports = amount;
    Ok(())
}

#[derive(Accounts)]
pub struct ReclaimCompletionBalance<'info> {
    #[account(seeds=[RUN_ESCROW_SEED,run_escrow.snapshot.owner.as_ref(),&run_escrow.snapshot.nonce.to_le_bytes()],
        bump=run_escrow.bump, constraint=run_escrow.schema_version == SCHEMA_VERSION @ ErrorCode::InvalidRun)]
    pub run_escrow: Box<Account<'info, RunEscrow>>,
    #[account(mut,address=run_escrow.sponsor_budget @ ErrorCode::InvalidSponsorBudget,
        seeds=[SPONSOR_SEED,run.key().as_ref()],bump=budget.bump)]
    pub budget: Box<Account<'info, SponsorBudget>>,
    #[account(mut,address=run_escrow.game_state @ ErrorCode::InvalidRun,
        seeds=[RUN_GAME_SEED,run_escrow.snapshot.owner.as_ref(),&run_escrow.snapshot.nonce.to_le_bytes()],bump=run.bump)]
    pub run: Box<Account<'info, RunGameState>>,
    #[account(mut,address=budget.authority @ ErrorCode::InvalidSponsorBudget)]
    pub sponsor: SystemAccount<'info>,
    #[account(mut,address=completion_balance(run.key()) @ ErrorCode::InvalidSponsorBudget)]
    pub action_balance: SystemAccount<'info>,
    pub delegation_program: Program<'info, DelegationProgram>,
    pub system_program: Program<'info, System>,
}

pub fn handle_reclaim_completion_balance(ctx: Context<ReclaimCompletionBalance>) -> Result<()> {
    let a = ctx.accounts;
    require!(
        a.run_escrow.status != EscrowStatus::Reserved
            && a.run_escrow.receipt.is_some()
            && a.run.escrow == a.run_escrow.key()
            && a.budget.schema_version == SCHEMA_VERSION
            && a.budget.purpose == SponsorPurpose::RunCompletion
            && a.budget.operation == a.run.key()
            && a.budget.beneficiary == a.run_escrow.snapshot.owner,
        ErrorCode::InvalidSponsorBudget
    );
    if a.action_balance.get_lamports() > 0 {
        let snapshot = &a.run_escrow.snapshot;
        let nonce = snapshot.nonce.to_le_bytes();
        let bump = [a.run.bump];
        let seeds: &[&[u8]] = &[RUN_GAME_SEED, snapshot.owner.as_ref(), &nonce, &bump];
        let ix = close_ephemeral_balance(a.run.key(), COMPLETION_ESCROW_INDEX);
        let before = a.run.get_lamports();
        invoke_signed(
            &ix,
            &[
                a.run.to_account_info(),
                a.action_balance.to_account_info(),
                a.system_program.to_account_info(),
                a.delegation_program.to_account_info(),
            ],
            &[seeds],
        )?;
        let returned = a
            .run
            .get_lamports()
            .checked_sub(before)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        a.run.sub_lamports(returned)?;
        a.sponsor.add_lamports(returned)?;
    }
    let rent = Rent::get()?.minimum_balance(a.budget.to_account_info().data_len());
    let unused = a.budget.get_lamports().saturating_sub(rent);
    a.budget.sub_lamports(unused)?;
    a.sponsor.add_lamports(unused)?;
    Ok(())
}
