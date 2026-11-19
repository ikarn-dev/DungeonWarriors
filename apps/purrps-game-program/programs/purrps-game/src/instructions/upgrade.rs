use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::ErrorCode,
    instruction_args::ApplyUpgradeArgs,
    publication::catalog_binding,
    state::{collection::Collection, config::CatalogVersion},
};

#[derive(Accounts)]
#[instruction(args: ApplyUpgradeArgs)]
pub struct ApplyUpgrade<'info> {
    pub owner: Signer<'info>,
    #[account(mut,seeds=[COLLECTION_SEED,owner.key().as_ref()],bump=collection.bump,has_one=owner,
        constraint=collection.schema_version==SCHEMA_VERSION @ ErrorCode::InvalidConfiguration)]
    pub collection: Box<Account<'info, Collection>>,
    #[account(seeds=[CATALOG_SEED,&args.expected_defining_catalog_version.to_le_bytes()],bump=catalog.bump,
        constraint=catalog.schema_version==SCHEMA_VERSION @ ErrorCode::InvalidConfiguration)]
    pub catalog: Box<Account<'info, CatalogVersion>>,
}

pub fn handle_apply_upgrade(ctx: Context<ApplyUpgrade>, args: ApplyUpgradeArgs) -> Result<()> {
    let c = &mut ctx.accounts.collection;
    let catalog = &ctx.accounts.catalog;
    let i = args.cat as usize;
    let grade = args.grade as usize;
    require!(
        c.pending_draw.is_none()
            && c.inventory_version == args.expected_inventory_version
            && c.owned_mask & (1 << i) != 0,
        ErrorCode::InvalidInventory
    );
    let mut owned = c.cats[i].ok_or(ErrorCode::InvalidInventory)?;
    require!(
        owned.cat == args.cat
            && owned.defining_catalog == catalog.binding
            && catalog.binding.version == args.expected_defining_catalog_version
            && catalog_binding(&catalog.catalog, &catalog.asset_manifest)? == catalog.binding
            && owned.rarity == catalog.catalog.cats[i].rarity
            && catalog.catalog.cats[i].id == args.cat
            && owned.level == args.expected_cat_level
            && (1..catalog.catalog.max_cat_level).contains(&owned.level),
        ErrorCode::InvalidInventory
    );
    let item = catalog.catalog.upgrades[grade];
    require!(
        item.rarity == args.grade && item.level_gain > 0,
        ErrorCode::InvalidCatalog
    );
    let remaining = c.upgrade_quantities[grade]
        .checked_sub(1)
        .ok_or(ErrorCode::InvalidInventory)?;
    let version = c
        .inventory_version
        .checked_add(1)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    owned.level = owned
        .level
        .checked_add(item.level_gain)
        .ok_or(ErrorCode::ArithmeticOverflow)?
        .min(catalog.catalog.max_cat_level);
    c.cats[i] = Some(owned);
    c.upgrade_quantities[grade] = remaining;
    c.inventory_version = version;
    Ok(())
}
