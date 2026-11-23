use anchor_lang::{prelude::*, solana_program::instruction::get_stack_height, InstructionData};
use ephemeral_rollups_sdk::{
    anchor::MagicProgram,
    consts::{EPHEMERAL_VAULT_ID, MAGIC_CONTEXT_ID, MAGIC_PROGRAM_ID},
    crank::hydra::{ephemeral, CreateArgs},
};
use hydra_api::{
    consts::{ephemeral::ID as HYDRA_ID, ix::TRIGGER, CRANK_HEADER_SIZE, CRANK_SEED_PREFIX},
    instruction::{SchedMeta, ScheduledIx},
    state::Crank,
};
use solana_instructions_sysvar::{load_current_index_checked, load_instruction_at_checked};

use super::{delegation::unplayed_reservation, run_inputs::validate_input_snapshot};
use crate::{
    constants::*,
    error::ErrorCode,
    instruction_args::{AdvanceRunArgs, RunIdentityArgs},
    oracle::{inspect_account, InspectedOracle},
    protocol::{FaultReason, RunPhase},
    run_engine::lifecycle::{activate_world, advance_tick, expire_suspension, suspend},
    state::{
        economy::{EscrowStatus, RunEscrow},
        run::RunGameState,
    },
};

const GENERATION: u64 = 1;
pub(super) const CLOCK_CREDIT_MS: u64 = 1_000;
pub(super) const MAX_CLOCK_BACKLOG_MS: u64 = 2 * CLOCK_CREDIT_MS;
pub const CRANK_RENT_HEADROOM: u64 = 32_000;

pub struct HydraProgram;
impl Id for HydraProgram {
    fn id() -> Pubkey {
        HYDRA_ID
    }
}

fn task_seed(run: Pubkey) -> [u8; 32] {
    solana_sha256_hasher::hashv(&[b"purrps:crank:v1", run.as_ref()]).to_bytes()
}

pub fn task_address(run: Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[CRANK_SEED_PREFIX, run.as_ref(), &task_seed(run)],
        &HYDRA_ID,
    )
    .0
}

#[derive(Accounts)]
pub struct ActivateRun<'info> {
    #[account(seeds=[RUN_ESCROW_SEED,escrow.snapshot.owner.as_ref(),&escrow.snapshot.nonce.to_le_bytes()],
        bump=escrow.bump,constraint=escrow.schema_version==SCHEMA_VERSION @ ErrorCode::InvalidRun)]
    pub escrow: Box<Account<'info, RunEscrow>>,
    #[account(mut,address=escrow.game_state @ ErrorCode::InvalidRun,
        seeds=[RUN_GAME_SEED,escrow.snapshot.owner.as_ref(),&escrow.snapshot.nonce.to_le_bytes()],bump=run.bump)]
    pub run: Box<Account<'info, RunGameState>>,
    #[account(address=run.snapshot.input_permission.input_key @ ErrorCode::InvalidSession)]
    pub play_key: Signer<'info>,
    /// CHECK: Validated against the run's immutable binding before activation.
    #[account(address=run.snapshot.oracle.account @ ErrorCode::InvalidOracleData)]
    pub price_update: UncheckedAccount<'info>,
    /// CHECK: Hydra creates only this canonical PDA.
    #[account(mut,address=task_address(run.key()) @ ErrorCode::InvalidCrank)]
    pub crank: UncheckedAccount<'info>,
    /// CHECK: Native ER identity and context.
    #[account(address=MAGIC_CONTEXT_ID,owner=MAGIC_PROGRAM_ID)]
    pub magic_context: UncheckedAccount<'info>,
    /// CHECK: Hydra pays temporary rent from its run sponsor to this vault.
    #[account(mut,address=EPHEMERAL_VAULT_ID)]
    pub rent_vault: UncheckedAccount<'info>,
    pub hydra_program: Program<'info, HydraProgram>,
    pub magic_program: Program<'info, MagicProgram>,
}

fn read_oracle(
    run: &RunGameState,
    quote: &UncheckedAccount<'_>,
    clock: &Clock,
) -> Result<InspectedOracle> {
    inspect_account(
        quote.key,
        quote.owner,
        &quote.try_borrow_data()?,
        &run.snapshot.oracle,
        run.snapshot.market,
        clock.unix_timestamp,
        clock.slot,
    )
}

pub fn handle_activate_run(ctx: Context<ActivateRun>, args: RunIdentityArgs) -> Result<()> {
    let a = ctx.accounts;
    let run = &mut a.run;
    let escrow = &a.escrow;
    let snapshot = &escrow.snapshot;
    validate_input_snapshot(run)?;
    require!(
        escrow.delegation_initiated
            && escrow.status == EscrowStatus::Reserved
            && escrow.receipt.is_none()
            && run.schema_version == SCHEMA_VERSION
            && run.snapshot == *snapshot
            && run.snapshot_hash == escrow.snapshot_hash
            && run.escrow == escrow.key()
            && snapshot.run == run.key()
            && args.nonce == snapshot.nonce
            && args.delegation_epoch == snapshot.delegation_epoch
            && unplayed_reservation(run),
        ErrorCode::InvalidRun
    );
    let clock = Clock::get()?;
    let oracle = read_oracle(run, &a.price_update, &clock)?;
    if run.snapshot.rules.rules_version == crate::rules::RULES_V4.rules_version {
        activate_world(run, &oracle, clock.unix_timestamp)?;
        run.crank.clock_origin_seconds = u64::try_from(clock.unix_timestamp)
            .map_err(|_| error!(ErrorCode::InvalidRun))?;
        return Ok(());
    }
    let before = run.get_lamports();
    let rent = Rent::get()?.minimum_balance(run.to_account_info().data_len());
    require!(
        before.saturating_sub(rent) >= CRANK_RENT_HEADROOM,
        ErrorCode::InvalidSponsorBudget
    );
    activate_world(run, &oracle, clock.unix_timestamp)?;
    register_crank(a, &clock)?;
    let debit = before.saturating_sub(a.run.get_lamports());
    require!(
        debit <= CRANK_RENT_HEADROOM && a.run.get_lamports() >= rent,
        ErrorCode::InvalidSponsorBudget
    );
    a.run.crank.task = a.crank.key();
    a.run.crank.generation = GENERATION;
    // Both values are new for an activated run. The origin field replaces the
    // unused trusted-elapsed field without shifting the account's Borsh layout.
    a.run.crank.clock_origin_seconds =
        u64::try_from(clock.unix_timestamp).map_err(|_| error!(ErrorCode::InvalidCrank))?;
    Ok(())
}

#[inline(never)]
fn register_crank(a: &ActivateRun<'_>, clock: &Clock) -> Result<()> {
    let run = &a.run;
    let eligible = &run.snapshot;
    let nonce = eligible.nonce.to_le_bytes();
    let bump = [run.bump];
    let seeds: &[&[u8]] = &[RUN_GAME_SEED, eligible.owner.as_ref(), &nonce, &bump];
    let data = crate::instruction::AdvanceRun {
        args: AdvanceRunArgs {
            delegation_epoch: eligible.delegation_epoch,
            task_generation: GENERATION,
        },
    }
    .data();
    let metas = [
        (run.key(), true),
        (a.price_update.key(), false),
        (a.crank.key(), true),
        (MAGIC_CONTEXT_ID, false),
        (solana_instructions_sysvar::ID, false),
    ]
    .map(|(key, is_writable)| SchedMeta {
        pubkey: key.to_bytes(),
        is_writable,
    });
    // Poll each slot so clock credits can drain despite missed callbacks.
    let interval = 1;
    let start_slot = clock
        .slot
        .checked_add(interval)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    ephemeral::create(
        &run.to_account_info(),
        &a.crank.to_account_info(),
        &a.rent_vault.to_account_info(),
        &a.magic_program.to_account_info(),
        &CreateArgs {
            seed: task_seed(run.key()),
            authority: run.key().to_bytes(),
            start_slot,
            interval_slots: interval,
            remaining: 0,
            priority_tip: 0,
            cu_limit: 600_000,
            scheduled: &[ScheduledIx {
                program_id: crate::ID.to_bytes(),
                metas: &metas,
                data: &data,
            }],
        },
        &[seeds],
    )?;
    Ok(())
}

#[derive(Accounts)]
pub struct AdvanceRun<'info> {
    #[account(mut,seeds=[RUN_GAME_SEED,run.snapshot.owner.as_ref(),&run.snapshot.nonce.to_le_bytes()],
        bump=run.bump,constraint=run.schema_version==SCHEMA_VERSION @ ErrorCode::InvalidRun,
        constraint=run.snapshot.run==run.key() @ ErrorCode::InvalidRun)]
    pub run: Box<Account<'info, RunGameState>>,
    /// CHECK: Exact price account and contents are checked against the snapshot.
    #[account(address=run.snapshot.oracle.account @ ErrorCode::InvalidOracleData)]
    pub price_update: UncheckedAccount<'info>,
    /// CHECK: Hydra owns and advances the ordinal in this canonical task.
    #[account(mut,address=run.crank.task @ ErrorCode::InvalidCrank,owner=HYDRA_ID)]
    pub crank: UncheckedAccount<'info>,
    /// CHECK: Native ER identity and context.
    #[account(address=MAGIC_CONTEXT_ID,owner=MAGIC_PROGRAM_ID)]
    pub magic_context: UncheckedAccount<'info>,
    /// CHECK: Genuine instructions sysvar for checking the preceding Trigger.
    #[account(address=solana_instructions_sysvar::ID)]
    pub instructions: UncheckedAccount<'info>,
}

fn authenticate_trigger(a: &AdvanceRun<'_>, args: &AdvanceRunArgs) -> Result<u64> {
    require!(
        get_stack_height() == 1
            && args.delegation_epoch == a.run.snapshot.delegation_epoch
            && args.task_generation == GENERATION
            && a.run.crank.generation == GENERATION
            && task_address(a.run.key()) == a.crank.key(),
        ErrorCode::InvalidCrank
    );
    let info = a.instructions.to_account_info();
    let index = load_current_index_checked(&info)?
        .checked_sub(1)
        .ok_or(ErrorCode::InvalidCrank)?;
    let trigger = load_instruction_at_checked(usize::from(index), &info)?;
    require!(
        trigger.program_id == HYDRA_ID
            && trigger.data == [TRIGGER]
            && trigger.accounts.len() == 3
            && trigger.accounts[0].pubkey == a.crank.key()
            && trigger.accounts[2].pubkey == solana_instructions_sysvar::ID,
        ErrorCode::InvalidCrank
    );
    let data = a.crank.try_borrow_data()?;
    require!(data.len() >= CRANK_HEADER_SIZE, ErrorCode::InvalidCrank);
    let exec = core::mem::offset_of!(Crank, executed);
    let ordinal = u64::from_le_bytes(data[exec..exec + 8].try_into().unwrap());
    require!(
        data[..32] == a.run.crank.cancel_authority.to_bytes()
            && data[32..64] == task_seed(a.run.key())
            && data[core::mem::offset_of!(Crank, authority_signer)] == 1
            && a.run.crank.last_execution_ordinal.checked_add(1) == Some(ordinal),
        ErrorCode::InvalidCrank
    );
    Ok(ordinal)
}

pub fn handle_advance_run(ctx: Context<AdvanceRun>, args: AdvanceRunArgs) -> Result<()> {
    let a = ctx.accounts;
    let ordinal = authenticate_trigger(a, &args)?;
    validate_input_snapshot(&a.run)?;
    let clock = Clock::get()?;
    if a.run.phase == RunPhase::Suspended {
        let run = &mut a.run;
        let suspension = run.suspension.ok_or(ErrorCode::InvalidRun)?;
        if clock.unix_timestamp >= suspension.started_at_seconds {
            expire_suspension(run, clock.unix_timestamp)?;
        }
        run.crank.last_execution_ordinal = ordinal;
        return Ok(());
    }
    let quote = read_oracle(&a.run, &a.price_update, &clock).and_then(|oracle| {
        oracle.next_observation(a.run.latest_observation()?)?;
        Ok(oracle)
    });
    let run = &mut a.run;
    require!(run.terminal.is_none(), ErrorCode::InvalidRun);
    run.crank.last_execution_ordinal = ordinal;
    require!(run.phase == RunPhase::Active, ErrorCode::InvalidRun);
    let now = u64::try_from(clock.unix_timestamp).map_err(|_| error!(ErrorCode::InvalidCrank))?;
    let Some(elapsed) = now.checked_sub(run.crank.clock_origin_seconds) else {
        return suspend(run, FaultReason::SchedulerGap, clock.unix_timestamp);
    };
    let earned = elapsed
        .saturating_sub(1)
        .checked_mul(CLOCK_CREDIT_MS)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    let Some(available) = earned.checked_sub(run.crank.consumed_elapsed_ms) else {
        return suspend(run, FaultReason::SchedulerGap, clock.unix_timestamp);
    };
    if available > MAX_CLOCK_BACKLOG_MS {
        return suspend(run, FaultReason::SchedulerGap, clock.unix_timestamp);
    }
    let quote = match quote {
        Ok(oracle) => oracle,
        Err(error) => {
            let fault = if matches!(error, anchor_lang::error::Error::AnchorError(ref e) if e.error_name == "StaleOracle")
            {
                FaultReason::OracleStale
            } else {
                FaultReason::OracleInvalid
            };
            return suspend(run, fault, clock.unix_timestamp);
        }
    };
    let cost = u64::from(run.snapshot.rules.crank_interval_ms);
    if available < cost {
        return Ok(());
    }
    run.crank.consumed_elapsed_ms += cost;
    for _ in 0..run.snapshot.rules.max_ticks_per_crank {
        if advance_tick(run, &quote, clock.unix_timestamp).is_err() {
            return suspend(run, FaultReason::UnsafeWorld, clock.unix_timestamp);
        }
        if run.terminal.is_some() {
            break;
        }
    }
    Ok(())
}
