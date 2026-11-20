use anchor_lang::{prelude::*, system_program, InstructionData};
use ephemeral_rollups_sdk::{
    anchor::{action, MagicProgram},
    consts::{DELEGATION_PROGRAM_ID, EPHEMERAL_VAULT_ID, MAGIC_CONTEXT_ID},
    crank::hydra::ephemeral,
    dlp_api::discriminator::DlpDiscriminator,
    ephem::{CallHandler, FoldableIntentBuilder, MagicIntentBundleBuilder},
    pda::ephemeral_balance_pda_from_payer,
    ActionArgs, ShortAccountMeta,
};
use solana_instructions_sysvar::{load_current_index_checked, load_instruction_at_checked};

use super::{
    abort_reservation::*,
    run_crank::{task_address, HydraProgram},
    run_inputs::validate_input_snapshot,
    settle_returned::*,
};
use crate::{
    constants::*,
    error::ErrorCode,
    protocol::RunPhase,
    state::{
        economy::{EscrowStatus, RunEscrow, SponsorBudget, SponsorPurpose},
        records::{Leaderboard, ResultReceipt},
        run::RunGameState,
    },
};

pub const COMPLETION_ESCROW_INDEX: u8 = 255;
const COMPLETION_ACTION_COMPUTE_UNITS: u32 = 350_000;

pub fn completion_balance(run: Pubkey) -> Pubkey {
    ephemeral_balance_pda_from_payer(&run, COMPLETION_ESCROW_INDEX)
}

#[derive(Accounts)]
pub struct RequestCompletion<'info> {
    #[account(seeds=[RUN_ESCROW_SEED,run_escrow.snapshot.owner.as_ref(),&run_escrow.snapshot.nonce.to_le_bytes()],
        bump=run_escrow.bump, constraint=run_escrow.schema_version == SCHEMA_VERSION @ ErrorCode::InvalidRun)]
    pub run_escrow: Box<Account<'info, RunEscrow>>,
    /// CHECK: Deserialized before committing. MagicBlock changes ownership during the CPI.
    #[account(mut, address=run_escrow.game_state @ ErrorCode::InvalidRun, owner=crate::ID)]
    pub run: UncheckedAccount<'info>,
    #[account(address=run_escrow.sponsor_budget @ ErrorCode::InvalidSponsorBudget,
        seeds=[SPONSOR_SEED,run.key().as_ref()],bump=budget.bump)]
    pub budget: Box<Account<'info, SponsorBudget>>,
    #[account(address=completion_balance(run.key()) @ ErrorCode::InvalidSponsorBudget)]
    pub action_balance: SystemAccount<'info>,
    /// CHECK: The canonical leaderboard may be uninitialized.
    #[account(seeds=[LEADERBOARD_SEED],bump)]
    pub leaderboard: UncheckedAccount<'info>,
    #[account(mut, owner=system_program::ID)]
    pub payer: Signer<'info>,
    /// CHECK: The provider validates the context data; its address and owner are fixed.
    #[account(mut,address=MAGIC_CONTEXT_ID,owner=magic_program.key())]
    pub magic_context: UncheckedAccount<'info>,
    pub magic_program: Program<'info, MagicProgram>,
    /// CHECK: Required for an activated run and pinned to its recorded task.
    #[account(mut)]
    pub crank: Option<UncheckedAccount<'info>>,
    /// CHECK: Fixed native rent vault. Used only when cancelling an active task.
    #[account(mut, address=EPHEMERAL_VAULT_ID)]
    pub rent_vault: Option<UncheckedAccount<'info>>,
    pub hydra_program: Option<Program<'info, HydraProgram>>,
}

fn completion_metas(
    escrow: &RunEscrow,
    escrow_key: Pubkey,
    payer: Pubkey,
    leaderboard: Pubkey,
) -> Vec<ShortAccountMeta> {
    let owner = escrow.snapshot.owner;
    let nonce = escrow.snapshot.nonce.to_le_bytes();
    let player = Pubkey::find_program_address(&[PLAYER_SEED, owner.as_ref()], &crate::ID).0;
    let house = Pubkey::find_program_address(&[HOUSE_SEED], &crate::ID).0;
    let vault = anchor_spl::associated_token::get_associated_token_address(&house, &USDC_MINT);
    let receipt =
        Pubkey::find_program_address(&[RESULT_SEED, owner.as_ref(), &nonce], &crate::ID).0;
    [
        (escrow_key, true),
        (escrow.game_state, true),
        (player, true),
        (house, true),
        (vault, false),
        (payer, true),
        (receipt, true),
        (system_program::ID, false),
        (leaderboard, true),
        (system_program::ID, false),
        (solana_instructions_sysvar::ID, false),
    ]
    .into_iter()
    .map(|(pubkey, is_writable)| ShortAccountMeta {
        pubkey,
        is_writable,
    })
    .collect()
}

pub fn handle_request_completion(
    ctx: Context<RequestCompletion>,
    expected_attempt: u16,
) -> Result<()> {
    let a = ctx.accounts;
    let mut run = {
        let data = a.run.try_borrow_data()?;
        Box::new(RunGameState::try_deserialize(&mut data.as_ref())?)
    };
    let escrow = &a.run_escrow;
    let snapshot = &escrow.snapshot;
    let budget = &a.budget;
    validate_input_snapshot(&run)?;
    require!(
        run.schema_version == SCHEMA_VERSION
            && run.snapshot == *snapshot
            && run.snapshot_hash == escrow.snapshot_hash
            && run.escrow == escrow.key()
            && snapshot.run == a.run.key()
            && escrow.delegation_initiated
            && escrow.status == EscrowStatus::Reserved
            && escrow.receipt.is_none()
            && matches!(
                run.phase,
                RunPhase::TerminalRecorded | RunPhase::CompletionRequested
            ),
        ErrorCode::InvalidRun
    );
    let seeds = [
        RUN_GAME_SEED,
        snapshot.owner.as_ref(),
        &snapshot.nonce.to_le_bytes(),
        &[run.bump],
    ];
    require!(
        Pubkey::create_program_address(&seeds, &crate::ID).ok() == Some(a.run.key()),
        ErrorCode::InvalidRun
    );
    validate_terminal(&run, &run.terminal.ok_or(ErrorCode::InvalidRun)?)?;
    require!(
        budget.schema_version == SCHEMA_VERSION
            && budget.operation == a.run.key()
            && budget.beneficiary == snapshot.owner
            && budget.purpose == SponsorPurpose::RunCompletion
            && run.crank.completion_attempts == expected_attempt
            && expected_attempt < budget.max_attempts
            && (expected_attempt == 0 || a.payer.key() == budget.authority),
        ErrorCode::InvalidSponsorBudget
    );
    let rent = Rent::get()?;
    let board_rent = if a.leaderboard.owner == &crate::ID {
        0
    } else {
        rent.minimum_balance(8 + Leaderboard::INIT_SPACE)
    };
    let action_rent = rent
        .minimum_balance(8 + ResultReceipt::INIT_SPACE)
        .checked_add(board_rent)
        .and_then(|lamports| lamports.checked_add(rent.minimum_balance(0)))
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    let funded = a.action_balance.lamports() >= action_rent;
    cancel_crank(a, &run, &seeds)?;
    run.crank.completion_attempts += 1;
    run.phase = RunPhase::CompletionRequested;
    // The provider changes ownership during this call. Persist the immutable
    // result and request metadata before CPI and let Solana roll back on error.
    run.try_serialize(&mut &mut a.run.try_borrow_mut_data()?[..])?;
    schedule_completion(a, &seeds, funded)
}

#[inline(never)]
fn cancel_crank(a: &RequestCompletion<'_>, run: &RunGameState, seeds: &[&[u8]]) -> Result<()> {
    if run.crank.task == Pubkey::default() {
        return Ok(());
    }
    let crank = a.crank.as_ref().ok_or(ErrorCode::InvalidCrank)?;
    require!(
        crank.key() == run.crank.task && crank.key() == task_address(a.run.key()),
        ErrorCode::InvalidCrank
    );
    if crank.data_is_empty() && *crank.owner == system_program::ID {
        // A prior completion request already closed it.
        return Ok(());
    }
    let vault = a.rent_vault.as_ref().ok_or(ErrorCode::InvalidCrank)?;
    let _hydra = a.hydra_program.as_ref().ok_or(ErrorCode::InvalidCrank)?;
    require_keys_eq!(*crank.owner, HydraProgram::id(), ErrorCode::InvalidCrank);
    let run = a.run.to_account_info();
    ephemeral::cancel(
        &run,
        &crank.to_account_info(),
        &run,
        &vault.to_account_info(),
        &a.magic_program.to_account_info(),
        &[seeds],
    )?;
    Ok(())
}

#[inline(never)]
fn schedule_completion(a: &RequestCompletion<'_>, seeds: &[&[u8]], funded: bool) -> Result<()> {
    let escrow = &a.run_escrow;
    let mut run_account = a.run.to_account_info();
    run_account.is_signer = funded;
    let builder = MagicIntentBundleBuilder::new(
        a.payer.to_account_info(),
        a.magic_context.to_account_info(),
        a.magic_program.to_account_info(),
    )
    .commit_and_undelegate(&[run_account.clone()]);
    if funded {
        let action = CallHandler {
            args: ActionArgs::new(crate::instruction::SettleRunAction {}.data()),
            compute_units: COMPLETION_ACTION_COMPUTE_UNITS,
            escrow_authority: run_account,
            destination_program: crate::ID,
            accounts: completion_metas(
                escrow,
                escrow.key(),
                a.action_balance.key(),
                a.leaderboard.key(),
            ),
        };
        builder
            .add_post_undelegate_actions([action])
            .build_and_invoke_signed(&[seeds])?;
    } else {
        // Returning the terminal still allows any payer to settle it on base.
        builder.build_and_invoke()?;
    }
    Ok(())
}

#[action]
#[derive(Accounts)]
pub struct SettleRunAction<'info> {
    pub settlement: AbortUndelegatedReservation<'info>,
    #[account(init_if_needed, payer=settlement.payer, space=8+Leaderboard::INIT_SPACE,
        seeds=[LEADERBOARD_SEED], bump)]
    pub leaderboard: Box<Account<'info, Leaderboard>>,
    pub system_program: Program<'info, System>,
    /// CHECK: Use the genuine Instructions sysvar to pin the dispatching validator.
    #[account(address=solana_instructions_sysvar::ID)]
    pub instructions: UncheckedAccount<'info>,
    // Provider-injected accounts live in the suffix. V2 includes the source
    // program before the two V1 accounts, so authenticate the dispatch first.
}

pub fn handle_settle_run_action(ctx: Context<SettleRunAction>) -> Result<()> {
    let a = ctx.accounts;
    let sysvar = a.instructions.to_account_info();
    let index = load_current_index_checked(&sysvar)?;
    let dispatch = load_instruction_at_checked(usize::from(index), &sysvar)?;
    let snapshot = &a.settlement.escrow.snapshot;
    require!(
        dispatch.program_id == DELEGATION_PROGRAM_ID
            && dispatch
                .accounts
                .first()
                .is_some_and(|validator| validator.is_signer
                    && validator.pubkey == snapshot.oracle.validator)
            && dispatch
                .accounts
                .get(2)
                .is_some_and(|target| target.pubkey == crate::ID)
            && a.settlement.run.phase == RunPhase::CompletionRequested,
        ErrorCode::InvalidCompletionAction
    );
    let (auth, payer, signed) = if dispatch
        .data
        .starts_with(&DlpDiscriminator::CallHandlerV2.to_vec())
    {
        // The #[action] macro reads the first two injected accounts. In v2
        // those are the source program and authority, followed by the signer.
        let [payer] = ctx.remaining_accounts else {
            return err!(ErrorCode::InvalidCompletionAction);
        };
        require_keys_eq!(
            a.escrow_auth.key(),
            crate::ID,
            ErrorCode::InvalidCompletionAction
        );
        (a.escrow.key(), *payer.key, payer.is_signer)
    } else {
        require!(
            dispatch
                .data
                .starts_with(&DlpDiscriminator::CallHandler.to_vec())
                && ctx.remaining_accounts.is_empty(),
            ErrorCode::InvalidCompletionAction
        );
        (a.escrow_auth.key(), a.escrow.key(), a.escrow.is_signer)
    };
    require!(
        auth == snapshot.run
            && signed
            && payer == completion_balance(snapshot.run)
            && payer == a.settlement.payer.key(),
        ErrorCode::InvalidCompletionAction
    );
    settle_returned(
        &mut a.settlement,
        &mut a.leaderboard,
        ctx.bumps.leaderboard,
        ctx.bumps.settlement.receipt,
    )
}
