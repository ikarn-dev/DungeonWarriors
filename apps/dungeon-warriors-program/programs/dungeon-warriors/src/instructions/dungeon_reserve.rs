use super::house::assert_vault;
use crate::{
    catalog::CatId,
    constants::*,
    dungeon::*,
    error::ErrorCode,
    state::{
        collection::{Collection, PlayerAccount},
        config::GameConfig,
        dungeon::{DungeonConfig, DungeonExpedition, DungeonStatus},
        economy::HouseState,
    },
};
use anchor_lang::prelude::*;
use anchor_spl::token::TokenAccount;
use ephemeral_rollups_sdk::vrf::{
    anchor::vrf,
    instructions::{create_request_randomness_ix, RequestRandomnessParams},
    types::SerializableAccountMeta,
};
use solana_sha256_hasher::hashv;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ReserveDungeonArgs {
    pub nonce: u64,
    pub rules_version: u32,
    pub cat: CatId,
    pub stake: u64,
    pub max_rooms: u8,
    pub commitment: [u8; 32],
    pub max_payer_debit_lamports: u64,
}
#[vrf]
#[derive(Accounts)]
#[instruction(args: ReserveDungeonArgs)]
pub struct ReserveDungeon<'info> {
    #[account(seeds=[GAME_CONFIG_SEED],bump=config.bump)]
    pub config: Box<Account<'info, GameConfig>>,
    #[account(seeds=[DUNGEON_CONFIG_SEED],bump=dungeon.bump)]
    pub dungeon: Box<Account<'info, DungeonConfig>>,
    pub owner: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut,seeds=[PLAYER_SEED,owner.key().as_ref()],bump=player.bump,has_one=owner)]
    pub player: Box<Account<'info, PlayerAccount>>,
    #[account(seeds=[COLLECTION_SEED,owner.key().as_ref()],bump=collection.bump,has_one=owner)]
    pub collection: Box<Account<'info, Collection>>,
    #[account(mut,seeds=[HOUSE_SEED],bump=house.bump,has_one=config)]
    pub house: Box<Account<'info, HouseState>>,
    #[account(address=house.vault)]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(init,payer=payer,space=8+DungeonExpedition::INIT_SPACE,
        seeds=[EXPEDITION_SEED,owner.key().as_ref(),&args.nonce.to_le_bytes()],bump)]
    pub expedition: Box<Account<'info, DungeonExpedition>>,
    /// CHECK: Frozen configuration and the VRF CPI validate this queue.
    #[account(mut,address=config.vrf_queue,owner=config.vrf_program)]
    pub oracle_queue: UncheckedAccount<'info>,
}
pub fn handle_reserve_dungeon(
    ctx: Context<ReserveDungeon>,
    args: ReserveDungeonArgs,
) -> Result<()> {
    let a = ctx.accounts;
    require!(
        a.dungeon.enabled && a.config.allow_reservations,
        ErrorCode::AdmissionClosed
    );
    require!(
        a.dungeon.rules.version == args.rules_version
            && a.dungeon.rules.content_hash()? == a.dungeon.rules_hash,
        ErrorCode::StaleVersion
    );
    require!(
        a.player.schema_version == SCHEMA_VERSION
            && a.collection.schema_version == SCHEMA_VERSION
            && a.house.schema_version == SCHEMA_VERSION,
        ErrorCode::InvalidConfiguration
    );
    require!(
        a.player.next_run_nonce == args.nonce && a.player.locked_stake_base_units == 0,
        ErrorCode::InvalidRun
    );
    let index = args.cat as usize;
    require!(
        index < 4
            && a.collection.owned_mask & (1 << index) != 0
            && a.collection.cats[index].is_some_and(|cat| cat.cat == args.cat),
        ErrorCode::InvalidInventory
    );
    require!(
        args.stake > 0
            && args.max_rooms > 0
            && args.max_rooms <= a.dungeon.rules.rooms
            && args.commitment != [0; 32],
        ErrorCode::InvalidAmount
    );
    let gross = dungeon_payout(args.stake, args.max_rooms, &a.dungeon.rules)?;
    require!(gross > args.stake, ErrorCode::InvalidAmount);
    assert_vault(a.house.key(), &a.house, &a.vault)?;
    a.player.available_base_units = a
        .player
        .available_base_units
        .checked_sub(args.stake)
        .ok_or(ErrorCode::InsufficientCredit)?;
    a.player.locked_stake_base_units = args.stake;
    a.player.next_run_nonce = a
        .player
        .next_run_nonce
        .checked_add(1)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    a.house.total_available_base_units = a
        .house
        .total_available_base_units
        .checked_sub(args.stake)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    a.house.total_max_gross_base_units = a
        .house
        .total_max_gross_base_units
        .checked_add(gross)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    assert_vault(a.house.key(), &a.house, &a.vault)?;
    let now = Clock::get()?;
    let key = a.expedition.key();
    let seed = hashv(&[
        b"purrps:dungeon-request:v1",
        crate::ID.as_ref(),
        key.as_ref(),
        &args.commitment,
        &now.slot.to_le_bytes(),
    ])
    .to_bytes();
    a.expedition.set_inner(DungeonExpedition {
        schema_version: SCHEMA_VERSION,
        bump: ctx.bumps.expedition,
        owner: a.owner.key(),
        nonce: args.nonce,
        cat: args.cat,
        verifier: a.dungeon.verifier,
        rules: a.dungeon.rules,
        rules_hash: a.dungeon.rules_hash,
        stake: args.stake,
        max_rooms: args.max_rooms,
        max_gross: gross,
        commitment: args.commitment,
        vrf_program: a.config.vrf_program,
        vrf_queue: a.config.vrf_queue,
        callback_authority: a.config.vrf_callback_authority,
        request_seed: seed,
        requested_at: now.unix_timestamp,
        randomness_deadline: now
            .unix_timestamp
            .checked_add(i64::from(a.dungeon.rules.vrf_timeout_seconds))
            .ok_or(ErrorCode::ArithmeticOverflow)?,
        randomness: None,
        status: DungeonStatus::AwaitingRandomness,
        secret: None,
        gates: [255; MAX_ROOMS],
        gate_count: 0,
        cleared: 0,
        payout: 0,
        completed_at: None,
    });
    let ix = create_request_randomness_ix(RequestRandomnessParams {
        payer: a.payer.key(),
        oracle_queue: a.oracle_queue.key(),
        callback_program_id: crate::ID,
        callback_discriminator: crate::instruction::FulfillDungeon::DISCRIMINATOR.to_vec(),
        accounts_metas: Some(vec![SerializableAccountMeta {
            pubkey: key,
            is_signer: false,
            is_writable: true,
        }]),
        caller_seed: seed,
        callback_args: Some(seed.to_vec()),
    });
    let before = a.payer.lamports();
    a.invoke_signed_vrf(&a.payer.to_account_info(), &ix)?;
    let cost = before
        .saturating_sub(a.payer.lamports())
        .checked_add(Rent::get()?.minimum_balance(8 + DungeonExpedition::INIT_SPACE))
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    require!(
        cost <= args.max_payer_debit_lamports,
        ErrorCode::InvalidSponsorBudget
    );
    Ok(())
}
