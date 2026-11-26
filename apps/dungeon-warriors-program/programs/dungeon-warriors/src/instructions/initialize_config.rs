use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token};
use ephemeral_rollups_sdk::vrf::consts::{scoped_vrf_identity, DEFAULT_QUEUE, VRF_PROGRAM_ID};

use crate::{
    constants::*, contracts::Market, error::ErrorCode, instruction_args::InitializeConfigArgs,
    publication::validate_oracle_binding, state::config::GameConfig,
};

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(
        constraint = program.programdata_address()? == Some(program_data.key()) @ ErrorCode::InvalidUpgradeAuthority
    )]
    pub program: Program<'info, crate::program::DungeonWarriors>,
    #[account(
        constraint = program_data.upgrade_authority_address == Some(admin.key()) @ ErrorCode::InvalidUpgradeAuthority
    )]
    pub program_data: Account<'info, ProgramData>,
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(init, payer = admin, space = 8 + GameConfig::INIT_SPACE, seeds = [GAME_CONFIG_SEED], bump)]
    pub config: Account<'info, GameConfig>,
    #[account(address = USDC_MINT @ ErrorCode::InvalidMint, constraint = usdc_mint.decimals == 6 @ ErrorCode::InvalidMint)]
    pub usdc_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handle_initialize_config(
    ctx: Context<InitializeConfig>,
    args: InitializeConfigArgs,
) -> Result<()> {
    for (binding, market) in
        args.oracle_bindings
            .iter()
            .zip([Market::Btc, Market::Eth, Market::Sol])
    {
        validate_oracle_binding(binding, market)?;
    }
    ctx.accounts.config.set_inner(GameConfig {
        schema_version: SCHEMA_VERSION,
        bump: ctx.bumps.config,
        admin: ctx.accounts.admin.key(),
        usdc_mint: ctx.accounts.usdc_mint.key(),
        token_program: ctx.accounts.token_program.key(),
        usdc_decimals: ctx.accounts.usdc_mint.decimals,
        rules: None,
        catalog: None,
        oracle_bindings: args.oracle_bindings,
        vrf_program: VRF_PROGRAM_ID,
        vrf_queue: DEFAULT_QUEUE,
        vrf_callback_authority: scoped_vrf_identity(&crate::ID),
        // Publication and connectivity alone never authorize economic entry.
        allow_starter: false,
        allow_purchases: false,
        allow_reservations: false,
    });
    Ok(())
}
