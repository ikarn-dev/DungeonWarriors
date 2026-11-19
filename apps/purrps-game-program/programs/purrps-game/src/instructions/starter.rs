use crate::{
    constants::*,
    draw::{eligible_weights, grant_starter},
    error::ErrorCode,
    instruction_args::{RequestCapsuleArgs, SelectCatArgs, SetAdmissionArgs},
    state::{
        collection::{Collection, PlayerAccount, StarterClaim},
        config::{CatalogVersion, GameConfig},
        draws::{CapsuleDraw, CapsuleKind, DrawStatus},
    },
};
use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::vrf::{
    anchor::{vrf, vrf_callback},
    instructions::{create_request_randomness_ix, RequestRandomnessParams},
    types::SerializableAccountMeta,
};
use solana_sha256_hasher::hashv;

#[vrf]
#[derive(Accounts)]
#[instruction(args:RequestCapsuleArgs)]
pub struct ClaimStarter<'info> {
    #[account(seeds=[GAME_CONFIG_SEED],bump=config.bump,constraint=config.schema_version==SCHEMA_VERSION @ ErrorCode::InvalidConfiguration)]
    pub config: Box<Account<'info, GameConfig>>,
    pub owner: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut,seeds=[PLAYER_SEED,owner.key().as_ref()],bump=player.bump,has_one=owner,constraint=player.schema_version==SCHEMA_VERSION @ ErrorCode::InvalidConfiguration)]
    pub player: Box<Account<'info, PlayerAccount>>,
    #[account(mut,seeds=[COLLECTION_SEED,owner.key().as_ref()],bump=collection.bump,has_one=owner,constraint=collection.schema_version==SCHEMA_VERSION @ ErrorCode::InvalidConfiguration)]
    pub collection: Box<Account<'info, Collection>>,
    #[account(seeds=[CATALOG_SEED,&args.expected_catalog_version.to_le_bytes()],bump=catalog.bump,constraint=catalog.schema_version==SCHEMA_VERSION @ ErrorCode::InvalidConfiguration)]
    pub catalog: Box<Account<'info, CatalogVersion>>,
    #[account(init,payer=payer,space=8+CapsuleDraw::INIT_SPACE,seeds=[DRAW_SEED,owner.key().as_ref(),&args.expected_draw_nonce.to_le_bytes()],bump)]
    pub draw: Box<Account<'info, CapsuleDraw>>,
    /// CHECK: Fixed configured VRF queue; the VRF CPI validates its data/owner.
    #[account(mut,address=config.vrf_queue,owner=config.vrf_program)]
    pub oracle_queue: UncheckedAccount<'info>,
}
pub fn handle_claim_starter(ctx: Context<ClaimStarter>, args: RequestCapsuleArgs) -> Result<()> {
    require!(
        ctx.accounts.config.allow_starter,
        ErrorCode::AdmissionClosed
    );
    require!(
        args.kind == CapsuleKind::StarterCat
            && ctx.accounts.config.catalog == Some(ctx.accounts.catalog.binding),
        ErrorCode::InvalidInventory
    );
    let collection = &mut ctx.accounts.collection;
    require!(
        collection.starter == StarterClaim::Unclaimed && collection.pending_draw.is_none(),
        ErrorCode::StarterAlreadyClaimed
    );
    require!(
        collection.inventory_version == args.expected_inventory_version
            && ctx.accounts.player.next_draw_nonce == args.expected_draw_nonce,
        ErrorCode::InvalidInventory
    );
    let (weights, total) = eligible_weights(&ctx.accounts.catalog.catalog, collection.owned_mask)?;
    let nonce = ctx
        .accounts
        .player
        .next_draw_nonce
        .checked_add(1)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    let clock = Clock::get()?;
    let key = ctx.accounts.draw.key();
    let seed = hashv(&[
        b"purrps:starter-request:v1",
        crate::ID.as_ref(),
        key.as_ref(),
        &ctx.accounts.catalog.binding.content_hash,
        &clock.slot.to_le_bytes(),
    ])
    .to_bytes();
    ctx.accounts.draw.set_inner(CapsuleDraw {
        schema_version: SCHEMA_VERSION,
        bump: ctx.bumps.draw,
        owner: ctx.accounts.owner.key(),
        nonce: args.expected_draw_nonce,
        kind: CapsuleKind::StarterCat,
        status: DrawStatus::Pending,
        catalog: ctx.accounts.catalog.binding,
        inventory_version: collection.inventory_version,
        eligible_mask: !collection.owned_mask & 15,
        weights,
        total_weight: total,
        price_base_units: 0,
        vrf_program: ctx.accounts.config.vrf_program,
        vrf_queue: ctx.accounts.config.vrf_queue,
        callback_authority: ctx.accounts.config.vrf_callback_authority,
        committed_seed_hash: seed,
        requested_at_seconds: clock.unix_timestamp,
        paid_deadline_seconds: None,
        result: None,
        completed_at_seconds: None,
    });
    collection.starter = StarterClaim::Pending;
    collection.pending_draw = Some(key);
    ctx.accounts.player.next_draw_nonce = nonce;
    let ix = create_request_randomness_ix(RequestRandomnessParams {
        payer: ctx.accounts.payer.key(),
        oracle_queue: ctx.accounts.oracle_queue.key(),
        callback_program_id: crate::ID,
        callback_discriminator: crate::instruction::FulfillStarter::DISCRIMINATOR.to_vec(),
        accounts_metas: Some(vec![
            SerializableAccountMeta {
                pubkey: ctx.accounts.config.key(),
                is_signer: false,
                is_writable: false,
            },
            SerializableAccountMeta {
                pubkey: key,
                is_signer: false,
                is_writable: true,
            },
            SerializableAccountMeta {
                pubkey: ctx.accounts.collection.key(),
                is_signer: false,
                is_writable: true,
            },
            SerializableAccountMeta {
                pubkey: ctx.accounts.catalog.key(),
                is_signer: false,
                is_writable: false,
            },
        ]),
        caller_seed: seed,
        callback_args: Some(seed.to_vec()),
    });
    let before = ctx.accounts.payer.lamports();
    ctx.accounts
        .invoke_signed_vrf(&ctx.accounts.payer.to_account_info(), &ix)?;
    let debit = before
        .saturating_sub(ctx.accounts.payer.lamports())
        .checked_add(Rent::get()?.minimum_balance(8 + CapsuleDraw::INIT_SPACE))
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    require!(
        debit <= args.max_payer_debit_lamports,
        ErrorCode::InvalidSponsorBudget
    );
    Ok(())
}

#[vrf_callback]
#[derive(Accounts)]
pub struct FulfillStarter<'info> {
    #[account(seeds=[GAME_CONFIG_SEED],bump=config.bump,constraint=config.schema_version==SCHEMA_VERSION @ ErrorCode::InvalidConfiguration)]
    pub config: Box<Account<'info, GameConfig>>,
    #[account(mut,seeds=[DRAW_SEED,draw.owner.as_ref(),&draw.nonce.to_le_bytes()],bump=draw.bump,constraint=draw.schema_version==SCHEMA_VERSION @ ErrorCode::InvalidConfiguration)]
    pub draw: Box<Account<'info, CapsuleDraw>>,
    #[account(mut,seeds=[COLLECTION_SEED,draw.owner.as_ref()],bump=collection.bump,constraint=collection.schema_version==SCHEMA_VERSION @ ErrorCode::InvalidConfiguration)]
    pub collection: Box<Account<'info, Collection>>,
    #[account(seeds=[CATALOG_SEED,&draw.catalog.version.to_le_bytes()],bump=catalog.bump,constraint=catalog.schema_version==SCHEMA_VERSION @ ErrorCode::InvalidConfiguration)]
    pub catalog: Box<Account<'info, CatalogVersion>>,
}
pub fn handle_fulfill_starter(
    ctx: Context<FulfillStarter>,
    randomness: [u8; 32],
    seed: [u8; 32],
) -> Result<()> {
    let draw = &ctx.accounts.draw;
    require!(
        draw.vrf_program == ctx.accounts.config.vrf_program
            && draw.vrf_queue == ctx.accounts.config.vrf_queue
            && draw.callback_authority == ctx.accounts.vrf_program_identity.key(),
        ErrorCode::InvalidCallback
    );
    grant_starter(
        draw.key(),
        &mut ctx.accounts.draw,
        &mut ctx.accounts.collection,
        &ctx.accounts.catalog,
        randomness,
        seed,
        Clock::get()?.unix_timestamp,
    )
}

#[derive(Accounts)]
pub struct SelectCat<'info> {
    pub owner: Signer<'info>,
    #[account(mut,seeds=[COLLECTION_SEED,owner.key().as_ref()],bump=collection.bump,has_one=owner,constraint=collection.schema_version==SCHEMA_VERSION @ ErrorCode::InvalidConfiguration)]
    pub collection: Box<Account<'info, Collection>>,
}
pub fn handle_select_cat(ctx: Context<SelectCat>, args: SelectCatArgs) -> Result<()> {
    let c = &mut ctx.accounts.collection;
    let index = args.cat as usize;
    require!(
        c.inventory_version == args.expected_inventory_version
            && c.pending_draw.is_none()
            && c.owned_mask & (1 << index) != 0
            && c.cats[index].is_some_and(|cat| cat.cat == args.cat),
        ErrorCode::InvalidInventory
    );
    c.inventory_version = c
        .inventory_version
        .checked_add(1)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    c.selected_cat = Some(args.cat);
    Ok(())
}

#[derive(Accounts)]
pub struct SetAdmission<'info> {
    #[account(mut,seeds=[GAME_CONFIG_SEED],bump=config.bump,has_one=admin,constraint=config.schema_version==SCHEMA_VERSION @ ErrorCode::InvalidConfiguration)]
    pub config: Box<Account<'info, GameConfig>>,
    pub admin: Signer<'info>,
}
pub fn handle_set_admission(ctx: Context<SetAdmission>, args: SetAdmissionArgs) -> Result<()> {
    // Run admission remains closed until delegation and settlement exist.
    require!(!args.reservations, ErrorCode::AdmissionClosed);
    if args.starter || args.purchases {
        require!(
            ctx.accounts.config.catalog.is_some() && ctx.accounts.config.rules.is_some(),
            ErrorCode::InvalidConfiguration
        );
    }
    ctx.accounts.config.allow_starter = args.starter;
    ctx.accounts.config.allow_purchases = args.purchases;
    ctx.accounts.config.allow_reservations = false;
    Ok(())
}
