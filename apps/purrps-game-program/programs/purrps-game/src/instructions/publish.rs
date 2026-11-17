use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::ErrorCode,
    instruction_args::{PublishCatalogArgs, PublishRulesArgs},
    publication,
    state::config::{CatalogVersion, GameConfig, GameRulesVersion},
};

#[derive(Accounts)]
#[instruction(args: PublishRulesArgs)]
pub struct PublishRules<'info> {
    #[account(mut, seeds = [GAME_CONFIG_SEED], bump = config.bump,
        has_one = admin @ ErrorCode::InvalidAdmin,
        constraint = config.schema_version == SCHEMA_VERSION @ ErrorCode::InvalidConfiguration)]
    pub config: Account<'info, GameConfig>,
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(init, payer = admin, space = 8 + GameRulesVersion::INIT_SPACE,
        seeds = [RULES_SEED, &args.rules.rules_version.to_le_bytes()], bump)]
    pub rules: Account<'info, GameRulesVersion>,
    pub system_program: Program<'info, System>,
}

pub fn handle_publish_rules(ctx: Context<PublishRules>, args: PublishRulesArgs) -> Result<()> {
    let current = ctx
        .accounts
        .config
        .rules
        .map_or(0, |binding| binding.version);
    publication::validate_rules(&args.rules, current, args.expected_current_version)?;
    let binding = publication::rules_binding(&args.rules)?;
    ctx.accounts.rules.set_inner(GameRulesVersion {
        schema_version: SCHEMA_VERSION,
        bump: ctx.bumps.rules,
        binding,
        rules: args.rules,
    });
    ctx.accounts.config.rules = Some(binding);
    Ok(())
}

#[derive(Accounts)]
#[instruction(args: PublishCatalogArgs)]
pub struct PublishCatalog<'info> {
    #[account(mut, seeds = [GAME_CONFIG_SEED], bump = config.bump,
        has_one = admin @ ErrorCode::InvalidAdmin,
        constraint = config.schema_version == SCHEMA_VERSION @ ErrorCode::InvalidConfiguration)]
    pub config: Account<'info, GameConfig>,
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(init, payer = admin, space = 8 + CatalogVersion::INIT_SPACE,
        seeds = [CATALOG_SEED, &args.catalog.catalog_version.to_le_bytes()], bump)]
    pub catalog: Account<'info, CatalogVersion>,
    pub system_program: Program<'info, System>,
}

pub fn handle_publish_catalog(
    ctx: Context<PublishCatalog>,
    args: PublishCatalogArgs,
) -> Result<()> {
    let current = ctx
        .accounts
        .config
        .catalog
        .map_or(0, |binding| binding.version);
    publication::validate_catalog(
        &args.catalog,
        &args.asset_manifest,
        current,
        args.expected_current_version,
    )?;
    let binding = publication::catalog_binding(&args.catalog, &args.asset_manifest)?;
    ctx.accounts.catalog.set_inner(CatalogVersion {
        schema_version: SCHEMA_VERSION,
        bump: ctx.bumps.catalog,
        binding,
        catalog: args.catalog,
        asset_manifest: args.asset_manifest,
    });
    ctx.accounts.config.catalog = Some(binding);
    Ok(())
}
