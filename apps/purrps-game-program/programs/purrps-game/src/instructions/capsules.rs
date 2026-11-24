use anchor_lang::prelude::*;
use anchor_spl::token::TokenAccount;
use ephemeral_rollups_sdk::vrf::{
    anchor::{vrf, vrf_callback},
    instructions::{create_request_randomness_ix, RequestRandomnessParams},
    types::SerializableAccountMeta,
};
use solana_sha256_hasher::hashv;

use super::house::assert_vault;
use crate::{
    constants::*,
    draw::{grant_paid, paid_deadline, paid_pool},
    error::ErrorCode,
    instruction_args::RequestCapsuleArgs,
    publication::catalog_binding,
    rules::RULES_V1,
    state::{
        collection::{Collection, PlayerAccount},
        config::{CatalogVersion, GameConfig},
        draws::{CapsuleDraw, CapsuleKind, DrawStatus},
        economy::HouseState,
    },
};

#[vrf]
#[derive(Accounts)]
#[instruction(args: RequestCapsuleArgs)]
pub struct PurchaseCapsule<'info> {
    #[account(seeds=[GAME_CONFIG_SEED],bump=config.bump,constraint=config.schema_version==SCHEMA_VERSION @ ErrorCode::InvalidConfiguration)]
    pub config: Box<Account<'info, GameConfig>>,
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut,seeds=[PLAYER_SEED,owner.key().as_ref()],bump=player.bump,has_one=owner,constraint=player.schema_version==SCHEMA_VERSION @ ErrorCode::InvalidConfiguration)]
    pub player: Box<Account<'info, PlayerAccount>>,
    #[account(mut,seeds=[COLLECTION_SEED,owner.key().as_ref()],bump=collection.bump,has_one=owner,constraint=collection.schema_version==SCHEMA_VERSION @ ErrorCode::InvalidConfiguration)]
    pub collection: Box<Account<'info, Collection>>,
    #[account(seeds=[CATALOG_SEED,&args.expected_catalog_version.to_le_bytes()],bump=catalog.bump,constraint=catalog.schema_version==SCHEMA_VERSION @ ErrorCode::InvalidConfiguration)]
    pub catalog: Box<Account<'info, CatalogVersion>>,
    #[account(mut,seeds=[HOUSE_SEED],bump=house.bump,has_one=config,constraint=house.schema_version==SCHEMA_VERSION @ ErrorCode::InvalidConfiguration)]
    pub house: Box<Account<'info, HouseState>>,
    #[account(address=house.vault @ ErrorCode::InvalidVault)]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(init,payer=owner,space=8+CapsuleDraw::INIT_SPACE,seeds=[DRAW_SEED,owner.key().as_ref(),&args.expected_draw_nonce.to_le_bytes()],bump)]
    pub draw: Box<Account<'info, CapsuleDraw>>,
    /// CHECK: Config pins the queue and CPI validates its layout.
    #[account(mut,address=config.vrf_queue,owner=config.vrf_program)]
    pub oracle_queue: UncheckedAccount<'info>,
}

pub fn handle_purchase_capsule(
    ctx: Context<PurchaseCapsule>,
    args: RequestCapsuleArgs,
) -> Result<()> {
    let a = ctx.accounts;
    require!(a.config.allow_purchases, ErrorCode::AdmissionClosed);
    require!(
        args.kind == CapsuleKind::PaidCat,
        ErrorCode::AdmissionClosed
    );
    require!(
        a.config.rules.is_some()
            && a.config.catalog == Some(a.catalog.binding)
            && a.catalog.binding.version == args.expected_catalog_version
            && catalog_binding(&a.catalog.catalog, &a.catalog.asset_manifest)? == a.catalog.binding,
        ErrorCode::StaleVersion
    );
    require!(
        a.collection.pending_draw.is_none()
            && a.collection.inventory_version == args.expected_inventory_version
            && a.player.next_draw_nonce == args.expected_draw_nonce
            && a.player.purchase_escrow_base_units == 0,
        ErrorCode::InvalidInventory
    );
    let (mask, weights, total, price) = paid_pool(args.kind, &a.collection, &a.catalog.catalog)?;
    require!(price > 0, ErrorCode::InvalidAmount);
    assert_vault(a.house.key(), &a.house, &a.vault)?;
    a.player.available_base_units = a
        .player
        .available_base_units
        .checked_sub(price)
        .ok_or(ErrorCode::InsufficientCredit)?;
    a.player.purchase_escrow_base_units = price;
    a.house.total_available_base_units = a
        .house
        .total_available_base_units
        .checked_sub(price)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    a.house.total_purchase_escrow_base_units = a
        .house
        .total_purchase_escrow_base_units
        .checked_add(price)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    assert_vault(a.house.key(), &a.house, &a.vault)?;
    a.player.next_draw_nonce = a
        .player
        .next_draw_nonce
        .checked_add(1)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    let clock = Clock::get()?;
    let key = a.draw.key();
    let seed = hashv(&[
        b"purrps:paid-request:v1",
        crate::ID.as_ref(),
        key.as_ref(),
        &[args.kind as u8],
        &a.catalog.binding.content_hash,
        &clock.slot.to_le_bytes(),
    ])
    .to_bytes();
    let deadline = clock
        .unix_timestamp
        .checked_add(i64::from(RULES_V1.paid_draw_timeout_seconds))
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    a.draw.set_inner(CapsuleDraw {
        schema_version: SCHEMA_VERSION,
        bump: ctx.bumps.draw,
        owner: a.owner.key(),
        nonce: args.expected_draw_nonce,
        kind: args.kind,
        status: DrawStatus::Pending,
        catalog: a.catalog.binding,
        inventory_version: a.collection.inventory_version,
        eligible_mask: mask,
        weights,
        total_weight: total,
        price_base_units: price,
        vrf_program: a.config.vrf_program,
        vrf_queue: a.config.vrf_queue,
        callback_authority: a.config.vrf_callback_authority,
        committed_seed_hash: seed,
        requested_at_seconds: clock.unix_timestamp,
        paid_deadline_seconds: Some(deadline),
        result: None,
        completed_at_seconds: None,
    });
    a.collection.pending_draw = Some(key);
    let callback = [
        (a.config.key(), false),
        (key, true),
        (a.collection.key(), true),
        (a.player.key(), true),
        (a.house.key(), true),
        (a.vault.key(), false),
        (a.catalog.key(), false),
    ];
    let ix = create_request_randomness_ix(RequestRandomnessParams {
        payer: a.owner.key(),
        oracle_queue: a.oracle_queue.key(),
        callback_program_id: crate::ID,
        callback_discriminator: crate::instruction::FulfillCapsule::DISCRIMINATOR.to_vec(),
        accounts_metas: Some(
            callback
                .into_iter()
                .map(|(pubkey, is_writable)| SerializableAccountMeta {
                    pubkey,
                    is_signer: false,
                    is_writable,
                })
                .collect(),
        ),
        caller_seed: seed,
        callback_args: Some(seed.to_vec()),
    });
    let before = a.owner.lamports();
    a.invoke_signed_vrf(&a.owner.to_account_info(), &ix)?;
    let debit = before
        .saturating_sub(a.owner.lamports())
        .checked_add(Rent::get()?.minimum_balance(8 + CapsuleDraw::INIT_SPACE))
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    require!(
        debit <= args.max_payer_debit_lamports,
        ErrorCode::InvalidSponsorBudget
    );
    Ok(())
}

#[derive(Accounts)]
pub struct ResolveCapsule<'info> {
    #[account(seeds=[GAME_CONFIG_SEED],bump=config.bump,constraint=config.schema_version==SCHEMA_VERSION @ ErrorCode::InvalidConfiguration)]
    pub config: Box<Account<'info, GameConfig>>,
    #[account(mut,seeds=[DRAW_SEED,draw.owner.as_ref(),&draw.nonce.to_le_bytes()],bump=draw.bump,constraint=draw.schema_version==SCHEMA_VERSION @ ErrorCode::InvalidConfiguration)]
    pub draw: Box<Account<'info, CapsuleDraw>>,
    #[account(mut,seeds=[COLLECTION_SEED,draw.owner.as_ref()],bump=collection.bump,constraint=collection.schema_version==SCHEMA_VERSION @ ErrorCode::InvalidConfiguration)]
    pub collection: Box<Account<'info, Collection>>,
    #[account(mut,seeds=[PLAYER_SEED,draw.owner.as_ref()],bump=player.bump,
        constraint=player.owner==draw.owner @ ErrorCode::InvalidOwner,
        constraint=player.schema_version==SCHEMA_VERSION @ ErrorCode::InvalidConfiguration)]
    pub player: Box<Account<'info, PlayerAccount>>,
    #[account(mut,seeds=[HOUSE_SEED],bump=house.bump,has_one=config,constraint=house.schema_version==SCHEMA_VERSION @ ErrorCode::InvalidConfiguration)]
    pub house: Box<Account<'info, HouseState>>,
    #[account(address=house.vault @ ErrorCode::InvalidVault)]
    pub vault: Box<Account<'info, TokenAccount>>,
}

impl ResolveCapsule<'_> {
    fn release_purchase(&mut self, refund: bool) -> Result<()> {
        let price = self.draw.price_base_units;
        require!(
            self.player.purchase_escrow_base_units == price,
            ErrorCode::InvalidInventory
        );
        assert_vault(self.house.key(), &self.house, &self.vault)?;
        self.house.total_purchase_escrow_base_units = self
            .house
            .total_purchase_escrow_base_units
            .checked_sub(price)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        self.player.purchase_escrow_base_units = 0;
        if refund {
            self.player.available_base_units = self
                .player
                .available_base_units
                .checked_add(price)
                .ok_or(ErrorCode::ArithmeticOverflow)?;
            self.house.total_available_base_units = self
                .house
                .total_available_base_units
                .checked_add(price)
                .ok_or(ErrorCode::ArithmeticOverflow)?;
        }
        assert_vault(self.house.key(), &self.house, &self.vault)
    }
}

#[vrf_callback]
#[derive(Accounts)]
pub struct FulfillCapsule<'info> {
    pub payment: ResolveCapsule<'info>,
    #[account(seeds=[CATALOG_SEED,&payment.draw.catalog.version.to_le_bytes()],bump=catalog.bump,
        constraint=catalog.schema_version==SCHEMA_VERSION @ ErrorCode::InvalidConfiguration)]
    pub catalog: Box<Account<'info, CatalogVersion>>,
}

pub fn handle_fulfill_capsule(
    ctx: Context<FulfillCapsule>,
    randomness: [u8; 32],
    seed: [u8; 32],
) -> Result<()> {
    let a = &mut ctx.accounts.payment;
    require!(
        a.draw.vrf_program == a.config.vrf_program
            && a.draw.vrf_queue == a.config.vrf_queue
            && a.draw.callback_authority == ctx.accounts.vrf_program_identity.key(),
        ErrorCode::InvalidCallback
    );
    grant_paid(
        a.draw.key(),
        &mut a.draw,
        &mut a.collection,
        &ctx.accounts.catalog,
        randomness,
        seed,
        Clock::get()?.unix_timestamp,
    )?;
    // The vault stays fixed; the released escrow becomes house equity.
    a.release_purchase(false)
}

pub fn handle_refund_capsule(ctx: Context<ResolveCapsule>) -> Result<()> {
    let a = ctx.accounts;
    let now = Clock::get()?.unix_timestamp;
    require!(
        now >= paid_deadline(a.draw.key(), &a.draw, &a.collection)?,
        ErrorCode::DrawNotExpired
    );
    a.release_purchase(true)?;
    a.collection.pending_draw = None;
    a.draw.status = DrawStatus::Refunded;
    a.draw.completed_at_seconds = Some(now);
    Ok(())
}
