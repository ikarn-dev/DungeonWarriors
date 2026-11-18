use super::{house::assert_vault, session::validate_token};
use crate::{
    constants::*,
    contracts::{snapshot_hash, CatSnapshot, RunSnapshot},
    economy::{max_gross_reservation, required_vault_balance},
    error::ErrorCode,
    instruction_args::ReserveRunArgs,
    protocol::{InputPermission, PROTOCOL_VERSION},
    publication::{catalog_binding, rules_binding},
    state::{
        collection::{Collection, PlayerAccount, SessionAuthorization},
        config::{CatalogVersion, GameConfig, GameRulesVersion},
        economy::{
            EscrowStatus, HouseState, RunEscrow, SponsorBudget, SponsorPolicy, SponsorPurpose,
        },
        run::RunGameState,
    },
};
use anchor_lang::prelude::*;
use anchor_spl::token::TokenAccount;
use session_keys::SessionToken;

#[derive(Accounts)]
pub struct ReserveRun<'info> {
    #[account(seeds=[GAME_CONFIG_SEED],bump=config.bump,constraint=config.schema_version==SCHEMA_VERSION @ ErrorCode::InvalidConfiguration)]
    pub config: Box<Account<'info, GameConfig>>,
    pub allocation: ReservationAllocation<'info>,
    pub authority: Signer<'info>,
    #[account(mut,seeds=[SESSION_SEED,allocation.owner.key().as_ref(),&authorization.nonce.to_le_bytes()],bump=authorization.bump,constraint=authorization.owner==allocation.owner.key() @ ErrorCode::InvalidOwner,constraint=authorization.schema_version==SCHEMA_VERSION @ ErrorCode::InvalidConfiguration)]
    pub authorization: Box<Account<'info, SessionAuthorization>>,
    #[account(address=authorization.session_token)]
    pub session_token: Box<Account<'info, SessionToken>>,
    #[account(mut,seeds=[PLAYER_SEED,allocation.owner.key().as_ref()],bump=player.bump,constraint=player.owner==allocation.owner.key() @ ErrorCode::InvalidOwner,constraint=player.schema_version==SCHEMA_VERSION @ ErrorCode::InvalidConfiguration)]
    pub player: Box<Account<'info, PlayerAccount>>,
    #[account(seeds=[COLLECTION_SEED,allocation.owner.key().as_ref()],bump=collection.bump,constraint=collection.owner==allocation.owner.key() @ ErrorCode::InvalidOwner,constraint=collection.schema_version==SCHEMA_VERSION @ ErrorCode::InvalidConfiguration)]
    pub collection: Box<Account<'info, Collection>>,
    #[account(seeds=[RULES_SEED,&rules.binding.version.to_le_bytes()],bump=rules.bump,constraint=rules.schema_version==SCHEMA_VERSION @ ErrorCode::InvalidConfiguration)]
    pub rules: Box<Account<'info, GameRulesVersion>>,
    #[account(seeds=[CATALOG_SEED,&catalog.binding.version.to_le_bytes()],bump=catalog.bump,constraint=catalog.schema_version==SCHEMA_VERSION @ ErrorCode::InvalidConfiguration)]
    pub catalog: Box<Account<'info, CatalogVersion>>,
    #[account(seeds=[CATALOG_SEED,&defining_catalog.binding.version.to_le_bytes()],bump=defining_catalog.bump,constraint=defining_catalog.schema_version==SCHEMA_VERSION @ ErrorCode::InvalidConfiguration)]
    pub defining_catalog: Box<Account<'info, CatalogVersion>>,
    #[account(mut,seeds=[HOUSE_SEED],bump=house.bump,has_one=config,constraint=house.schema_version==SCHEMA_VERSION @ ErrorCode::InvalidConfiguration)]
    pub house: Box<Account<'info, HouseState>>,
    #[account(address=house.vault @ ErrorCode::InvalidVault)]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(seeds=[SPONSOR_POLICY_SEED],bump=policy.bump,has_one=config,constraint=policy.schema_version==SCHEMA_VERSION @ ErrorCode::InvalidConfiguration)]
    pub policy: Box<Account<'info, SponsorPolicy>>,
    #[account(seeds=[SPONSOR_SEED,allocation.run.key().as_ref()],bump=budget.bump,constraint=budget.schema_version==SCHEMA_VERSION @ ErrorCode::InvalidConfiguration)]
    pub budget: Box<Account<'info, SponsorBudget>>,
}

// Keep both init CPIs in a separate Accounts frame to stay within the SBF stack limit.
#[derive(Accounts)]
#[instruction(args:ReserveRunArgs)]
pub struct ReservationAllocation<'info> {
    /// CHECK: identity only; the parent checks the scoped authority.
    pub owner: UncheckedAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(init,payer=payer,space=8+RunEscrow::INIT_SPACE,seeds=[RUN_ESCROW_SEED,owner.key().as_ref(),&args.expected_run_nonce.to_le_bytes()],bump)]
    pub escrow: Box<Account<'info, RunEscrow>>,
    /// CHECK: init enforces owner/space/PDA. Serialize once below; zero-filled init cannot pass the strict fixed-buffer decoder.
    #[account(init,payer=payer,space=8+RunGameState::INIT_SPACE,seeds=[RUN_GAME_SEED,owner.key().as_ref(),&args.expected_run_nonce.to_le_bytes()],bump)]
    pub run: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handle_reserve_run(ctx: Context<ReserveRun>, args: ReserveRunArgs) -> Result<()> {
    let a = ctx.accounts;
    require!(a.config.allow_reservations, ErrorCode::AdmissionClosed);
    let now = Clock::get()?.unix_timestamp;
    require!(
        a.authority.key() == a.allocation.owner.key()
            || a.authority.key() == a.authorization.input_key,
        ErrorCode::InvalidSession
    );
    require!(
        !a.authorization.revoked
            && a.authorization.program == crate::ID
            && a.authorization.nonce == args.session_nonce,
        ErrorCode::InvalidSession
    );
    validate_token(
        a.session_token.key(),
        &a.session_token,
        a.allocation.owner.key(),
        a.authorization.input_key,
        a.authorization.expires_at_seconds,
        now,
    )?;
    let spent = a
        .authorization
        .spent_base_units
        .checked_add(args.stake_base_units)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    require!(
        spent <= a.authorization.allowance_base_units,
        ErrorCode::InvalidSession
    );
    require!(
        args.expected_run_nonce == a.player.next_run_nonce,
        ErrorCode::InvalidRun
    );
    require!(
        args.expected_inventory_version == a.collection.inventory_version
            && a.collection.selected_cat == Some(args.cat)
            && a.collection.owned_mask & (1 << args.cat as u8) != 0,
        ErrorCode::InvalidInventory
    );
    let owned = a.collection.cats[args.cat as usize].ok_or(ErrorCode::InvalidInventory)?;
    require!(
        owned.cat == args.cat
            && owned.defining_catalog == a.defining_catalog.binding
            && (1..=a.defining_catalog.catalog.max_cat_level).contains(&owned.level),
        ErrorCode::InvalidInventory
    );
    require!(
        a.config.rules == Some(a.rules.binding)
            && a.rules.binding.version == args.expected_rules_version
            && rules_binding(&a.rules.rules)? == a.rules.binding
            && a.config.catalog == Some(a.catalog.binding)
            && a.catalog.binding.version == args.expected_catalog_version
            && catalog_binding(&a.catalog.catalog, &a.catalog.asset_manifest)? == a.catalog.binding
            && catalog_binding(
                &a.defining_catalog.catalog,
                &a.defining_catalog.asset_manifest
            )? == a.defining_catalog.binding,
        ErrorCode::StaleVersion
    );
    let definition = a.defining_catalog.catalog.cats[args.cat as usize];
    require!(
        definition.id == args.cat && definition.rarity == owned.rarity,
        ErrorCode::InvalidInventory
    );
    let stats = crate::catalog::cat_stats(args.cat, owned.level)
        .map_err(|_| error!(ErrorCode::InvalidInventory))?;
    require!(args.stake_base_units > 0, ErrorCode::InvalidAmount);
    let max_gross = max_gross_reservation(args.stake_base_units)
        .map_err(|_| error!(ErrorCode::ArithmeticOverflow))?;
    assert_vault(a.house.key(), &a.house, &a.vault)?;
    let available = a
        .player
        .available_base_units
        .checked_sub(args.stake_base_units)
        .ok_or(ErrorCode::InsufficientCredit)?;
    let locked = a
        .player
        .locked_stake_base_units
        .checked_add(args.stake_base_units)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    let total_available = a
        .house
        .total_available_base_units
        .checked_sub(args.stake_base_units)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    let total_gross = a
        .house
        .total_max_gross_base_units
        .checked_add(max_gross)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    let required = required_vault_balance(
        total_available,
        a.house.total_purchase_escrow_base_units,
        total_gross,
        a.house.buffer_base_units,
    )
    .map_err(|_| error!(ErrorCode::ArithmeticOverflow))?;
    require!(a.vault.amount >= required, ErrorCode::InsolventHouse);
    let next_nonce = a
        .player
        .next_run_nonce
        .checked_add(1)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    let deadline = now
        .checked_add(i64::from(a.rules.rules.activation_timeout_seconds))
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    let policy = &a.policy;
    let budget = &a.budget;
    let remaining = budget
        .limit_lamports
        .checked_sub(budget.spent_lamports)
        .ok_or(ErrorCode::InvalidSponsorBudget)?;
    let funded = Rent::get()?
        .minimum_balance(budget.to_account_info().data_len())
        .checked_add(remaining)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    require!(
        !policy.paused
            && budget.operation == a.allocation.run.key()
            && budget.beneficiary == a.allocation.owner.key()
            && budget.purpose == SponsorPurpose::RunCompletion
            && budget.authority == policy.authority
            && budget.fee_payer == policy.authority
            && budget.limit_lamports <= policy.max_operation_lamports
            && budget.reserved_completion_lamports >= policy.min_completion_lamports
            && remaining >= budget.reserved_completion_lamports
            && budget.max_attempts > 0
            && budget.max_attempts <= policy.max_attempts
            && budget.attempts < budget.max_attempts
            && budget.expires_at_seconds >= deadline
            && budget.to_account_info().lamports() >= funded,
        ErrorCode::InvalidSponsorBudget
    );
    let snapshot = RunSnapshot {
        protocol_version: PROTOCOL_VERSION,
        run: a.allocation.run.key(),
        owner: a.allocation.owner.key(),
        nonce: args.expected_run_nonce,
        market: args.market,
        stake_base_units: args.stake_base_units,
        max_gross_base_units: max_gross,
        rules_binding: a.rules.binding,
        rules: a.rules.rules,
        cat: CatSnapshot {
            definition,
            defining_catalog: owned.defining_catalog,
            level: owned.level,
            stats,
        },
        oracle: a.config.oracle_bindings[args.market as usize],
        input_permission: InputPermission {
            owner: a.allocation.owner.key(),
            input_key: a.authorization.input_key,
            program: crate::ID,
            session_token: a.authorization.session_token,
            expires_at_seconds: a.authorization.expires_at_seconds,
        },
        asset_manifest: a.defining_catalog.asset_manifest,
        activation_deadline_seconds: deadline,
        delegation_epoch: 1,
    };
    let hash = snapshot_hash(&snapshot)?;
    a.allocation.escrow.set_inner(RunEscrow {
        schema_version: SCHEMA_VERSION,
        bump: ctx.bumps.allocation.escrow,
        game_state: a.allocation.run.key(),
        snapshot,
        snapshot_hash: hash,
        sponsor_budget: a.budget.key(),
        delegation_initiated: false,
        status: EscrowStatus::Reserved,
        receipt: None,
    });
    RunGameState::ready(
        ctx.bumps.allocation.run,
        a.allocation.escrow.key(),
        snapshot,
        hash,
    )
    .try_serialize(&mut &mut a.allocation.run.try_borrow_mut_data()?[..])?;
    a.authorization.spent_base_units = spent;
    a.player.available_base_units = available;
    a.player.locked_stake_base_units = locked;
    a.player.next_run_nonce = next_nonce;
    a.house.total_available_base_units = total_available;
    a.house.total_max_gross_base_units = total_gross;
    Ok(())
}
