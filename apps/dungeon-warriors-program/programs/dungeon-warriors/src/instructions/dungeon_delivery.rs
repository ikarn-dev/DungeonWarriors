use super::dungeon_settle::*;
use crate::{
    constants::SCHEMA_VERSION,
    error::ErrorCode,
    state::{dungeon::DungeonStatus, records::Leaderboard},
};
use anchor_lang::{
    prelude::*, solana_program::instruction::get_stack_height, system_program, InstructionData,
};
use ephemeral_rollups_sdk::{
    anchor::{DelegationProgram, MagicProgram},
    consts::MAGIC_CONTEXT_ID,
    cpi::{delegate_account, DelegateAccounts, DelegateConfig},
    ephem::{FoldableIntentBuilder, MagicIntentBundleBuilder},
    pda::{
        delegation_metadata_pda_from_delegated_account,
        delegation_record_pda_from_delegated_account, DELEGATE_BUFFER_TAG,
    },
};
use hydra_api::{
    consts::ix::TRIGGER,
    cpi::base::native as hydra,
    instruction::{CreateArgs, SchedMeta, ScheduledIx},
};

use solana_instructions_sysvar::{load_current_index_checked, load_instruction_at_checked};

pub const DUNGEON_SETTLEMENT_SEED: &[u8] = b"dungeon-result";
pub const DUNGEON_LEADERBOARD_SEED: &[u8] = b"dungeon-leaderboard";

#[account]
#[derive(InitSpace)]
pub struct DungeonSettlement {
    pub expedition: Pubkey,
    pub verifier: Pubkey,
    pub crank: Pubkey,
    pub outcome: u8,
    pub result: Option<DungeonResult>,
}

#[derive(Accounts)]
pub struct PrepareDungeonSettlement<'info> {
    pub resolution: ResolveDungeon<'info>,
    #[account(address=resolution.expedition.verifier)]
    pub verifier: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: Initialized and serialized here, then ownership is given to Delegation.
    #[account(init, payer=payer, space=8+DungeonSettlement::INIT_SPACE,
        seeds=[DUNGEON_SETTLEMENT_SEED,resolution.expedition.key().as_ref()],bump)]
    pub settlement: UncheckedAccount<'info>,
    #[account(init_if_needed, payer=payer, space=8+Leaderboard::INIT_SPACE,
        seeds=[DUNGEON_LEADERBOARD_SEED],bump)]
    pub leaderboard: Box<Account<'info, Leaderboard>>,
    /// CHECK: The base Hydra program validates its canonical crank.
    #[account(mut)]
    pub crank: UncheckedAccount<'info>,
    /// CHECK: The SDK passes this pinned executable program to Delegation.
    #[account(address=crate::ID,executable)]
    pub owner_program: UncheckedAccount<'info>,
    /// CHECK: The delegation SDK creates this canonical buffer.
    #[account(mut,seeds=[DELEGATE_BUFFER_TAG,settlement.key().as_ref()],bump)]
    pub buffer: UncheckedAccount<'info>,
    /// CHECK: The delegation program creates its canonical record.
    #[account(mut,address=delegation_record_pda_from_delegated_account(&settlement.key()))]
    pub delegation_record: UncheckedAccount<'info>,
    /// CHECK: The delegation program creates its canonical metadata.
    #[account(mut,address=delegation_metadata_pda_from_delegated_account(&settlement.key()))]
    pub delegation_metadata: UncheckedAccount<'info>,
    pub delegation_program: Program<'info, DelegationProgram>,
    /// CHECK: Fixed executable base Hydra program for the CPI.
    #[account(address=hydra_api::base::ID,executable)]
    pub hydra_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handle_prepare_dungeon_settlement(
    ctx: Context<PrepareDungeonSettlement>,
    validator: Pubkey,
    outcome: u8,
    proof_hash: [u8; 32],
) -> Result<()> {
    let a = ctx.accounts;
    let expedition = &mut a.resolution.expedition;
    require!(outcome <= 2, ErrorCode::InvalidRun);
    require!(
        expedition.status == DungeonStatus::Ready
            && expedition.secret.is_none()
            && proof_hash != [0; 32],
        ErrorCode::InvalidRun
    );
    if a.leaderboard.schema_version == 0 {
        a.leaderboard.schema_version = SCHEMA_VERSION;
        a.leaderboard.bump = ctx.bumps.leaderboard;
    }
    let expedition_key = expedition.key();
    // Bind the terminal proof on base before delegating the writable receipt.
    expedition.secret = Some(proof_hash);
    DungeonSettlement {
        expedition: expedition_key,
        verifier: a.verifier.key(),
        crank: a.crank.key(),
        outcome,
        result: None,
    }
    .try_serialize(&mut &mut a.settlement.try_borrow_mut_data()?[..])?;
    schedule_settlement(a, outcome)?;
    delegate_account(
        DelegateAccounts {
            payer: &a.payer.to_account_info(),
            pda: &a.settlement.to_account_info(),
            owner_program: &a.owner_program.to_account_info(),
            buffer: &a.buffer.to_account_info(),
            delegation_record: &a.delegation_record.to_account_info(),
            delegation_metadata: &a.delegation_metadata.to_account_info(),
            delegation_program: &a.delegation_program.to_account_info(),
            system_program: &a.system_program.to_account_info(),
        },
        &[DUNGEON_SETTLEMENT_SEED, expedition_key.as_ref()],
        DelegateConfig {
            commit_frequency_ms: u32::MAX,
            validator: Some(validator),
        },
    )?;
    Ok(())
}

#[inline(never)]
fn schedule_settlement(a: &PrepareDungeonSettlement<'_>, outcome: u8) -> Result<()> {
    let fixed = &a.resolution;
    let metas = [
        SchedMeta::readonly(fixed.config.key().to_bytes()),
        SchedMeta::writable(fixed.expedition.key().to_bytes()),
        SchedMeta::writable(fixed.player.key().to_bytes()),
        SchedMeta::writable(fixed.house.key().to_bytes()),
        SchedMeta::readonly(fixed.vault.key().to_bytes()),
        SchedMeta::readonly(a.settlement.key().to_bytes()),
        SchedMeta::writable(a.leaderboard.key().to_bytes()),
        SchedMeta::readonly(solana_instructions_sysvar::ID.to_bytes()),
    ];
    let crank = hydra_api::state::find_base_crank_pda(
        &a.payer.key().to_bytes(),
        &a.settlement.key().to_bytes(),
    )
    .0;
    require_keys_eq!(a.crank.key(), crank, ErrorCode::InvalidCrank);
    let data = crate::instruction::FinalizeDungeonSettlement { outcome }.data();
    let reward = hydra_api::consts::base::CRANKER_REWARD;
    hydra::create(
        &a.payer.to_account_info(),
        &a.crank.to_account_info(),
        &a.system_program.to_account_info(),
        &CreateArgs {
            seed: a.settlement.key().to_bytes(),
            authority: a.payer.key().to_bytes(),
            // Allow the ER receipt to return before the cranker first attempts settlement.
            start_slot: Clock::get()?.slot.saturating_add(8),
            interval_slots: 1,
            remaining: 1,
            priority_tip: 0,
            cu_limit: 300_000,
            scheduled: &[ScheduledIx {
                program_id: crate::ID.to_bytes(),
                metas: &metas,
                data: &data,
            }],
        },
        &[],
    )?;
    let funding = reward
        .checked_add(
            Rent::get()?
                .minimum_balance(a.crank.data_len())
                .saturating_sub(a.crank.lamports()),
        )
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    system_program::transfer(
        CpiContext::new(
            a.system_program.key(),
            system_program::Transfer {
                from: a.payer.to_account_info(),
                to: a.crank.to_account_info(),
            },
        ),
        funding,
    )
}

#[derive(Accounts)]
pub struct RecordDungeonSettlement<'info> {
    /// CHECK: Owner, PDA and verifier are checked before the commit CPI.
    #[account(mut,owner=crate::ID)]
    pub settlement: UncheckedAccount<'info>,
    pub verifier: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: Fixed context used by the MagicBlock commit program.
    #[account(mut,address=MAGIC_CONTEXT_ID,owner=magic_program.key())]
    pub magic_context: UncheckedAccount<'info>,
    pub magic_program: Program<'info, MagicProgram>,
}

pub fn handle_record_dungeon_settlement(
    ctx: Context<RecordDungeonSettlement>,
    result: DungeonResult,
) -> Result<()> {
    let a = ctx.accounts;
    let mut receipt =
        DungeonSettlement::try_deserialize(&mut a.settlement.try_borrow_data()?.as_ref())?;
    let receipt_key = Pubkey::find_program_address(
        &[DUNGEON_SETTLEMENT_SEED, receipt.expedition.as_ref()],
        &crate::ID,
    )
    .0;
    require_keys_eq!(a.settlement.key(), receipt_key, ErrorCode::InvalidRun);
    require_keys_eq!(a.verifier.key(), receipt.verifier, ErrorCode::InvalidRun);
    require!(receipt.outcome == result.outcome, ErrorCode::InvalidRun);
    if let Some(saved) = &receipt.result {
        require!(*saved == result, ErrorCode::InvalidRun);
    } else {
        receipt.result = Some(result);
    }
    receipt.try_serialize(&mut &mut a.settlement.try_borrow_mut_data()?[..])?;
    MagicIntentBundleBuilder::new(
        a.payer.to_account_info(),
        a.magic_context.to_account_info(),
        a.magic_program.to_account_info(),
    )
    .commit_and_undelegate(&[a.settlement.to_account_info()])
    .build_and_invoke()?;
    Ok(())
}

#[derive(Accounts)]
pub struct FinalizeDungeonSettlement<'info> {
    pub resolution: ResolveDungeon<'info>,
    #[account(seeds=[DUNGEON_SETTLEMENT_SEED,resolution.expedition.key().as_ref()],bump,
        constraint=settlement.expedition==resolution.expedition.key() @ ErrorCode::InvalidRun,
        constraint=settlement.verifier==resolution.expedition.verifier @ ErrorCode::InvalidRun)]
    pub settlement: Account<'info, DungeonSettlement>,
    #[account(mut,seeds=[DUNGEON_LEADERBOARD_SEED],bump)]
    pub leaderboard: Box<Account<'info, Leaderboard>>,
    /// CHECK: Genuine sysvar for authenticating the preceding Hydra Trigger.
    #[account(address=solana_instructions_sysvar::ID)]
    pub instructions: UncheckedAccount<'info>,
}

pub fn handle_finalize_dungeon_settlement(
    ctx: Context<FinalizeDungeonSettlement>,
    outcome: u8,
) -> Result<()> {
    let a = ctx.accounts;
    let instructions = a.instructions.to_account_info();
    let index = load_current_index_checked(&instructions)?
        .checked_sub(1)
        .ok_or(ErrorCode::InvalidCrank)?;
    let trigger = load_instruction_at_checked(usize::from(index), &instructions)?;
    require!(
        get_stack_height() == 1
            && trigger.program_id == hydra_api::base::ID
            && trigger.data == [TRIGGER]
            && trigger.accounts.first().map(|meta| meta.pubkey) == Some(a.settlement.crank),
        ErrorCode::InvalidCrank
    );
    let result = a.settlement.result.clone().ok_or(ErrorCode::InvalidRun)?;
    require!(
        result.outcome == outcome && a.resolution.expedition.secret.is_some(),
        ErrorCode::InvalidRun
    );
    settle_dungeon_result(
        &mut a.resolution,
        &mut a.leaderboard,
        result,
        ctx.bumps.leaderboard,
    )
}

// The base delegation callback authenticates the signed buffer before this check.
pub fn matches_dungeon_settlement(key: Pubkey, data: &[u8], seeds: &[Vec<u8>]) -> bool {
    let Ok(settlement) = DungeonSettlement::try_deserialize(&mut data.as_ref()) else {
        return false;
    };
    let expected: &[&[u8]] = &[DUNGEON_SETTLEMENT_SEED, settlement.expedition.as_ref()];
    seeds.len() == expected.len()
        && seeds
            .iter()
            .zip(expected)
            .all(|(actual, expected)| actual == *expected)
        && Pubkey::find_program_address(expected, &crate::ID).0 == key
}
