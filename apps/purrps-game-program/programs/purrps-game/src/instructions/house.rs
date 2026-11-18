use crate::{
    constants::*,
    economy::required_vault_balance,
    error::ErrorCode,
    instruction_args::AmountArgs,
    state::{config::GameConfig, economy::HouseState},
};
use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, TokenAccount, TransferChecked},
};

#[derive(Accounts)]
pub struct InitializeHouse<'info> {
    #[account(seeds=[GAME_CONFIG_SEED], bump=config.bump,
        constraint=config.schema_version==SCHEMA_VERSION @ ErrorCode::InvalidConfiguration,
        has_one=admin @ ErrorCode::InvalidAdmin)]
    pub config: Box<Account<'info, GameConfig>>,
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(init,payer=admin,space=8+HouseState::INIT_SPACE,seeds=[HOUSE_SEED],bump)]
    pub house: Box<Account<'info, HouseState>>,
    #[account(init,payer=admin,associated_token::mint=usdc_mint,associated_token::authority=house,
        associated_token::token_program=token_program)]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(address=USDC_MINT @ ErrorCode::InvalidMint,constraint=usdc_mint.decimals==6 @ ErrorCode::InvalidMint)]
    pub usdc_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_initialize_house(ctx: Context<InitializeHouse>) -> Result<()> {
    ctx.accounts.house.set_inner(HouseState {
        schema_version: SCHEMA_VERSION,
        bump: ctx.bumps.house,
        config: ctx.accounts.config.key(),
        usdc_mint: USDC_MINT,
        vault: ctx.accounts.vault.key(),
        total_available_base_units: 0,
        total_purchase_escrow_base_units: 0,
        total_max_gross_base_units: 0,
        buffer_base_units: 0,
    });
    Ok(())
}

pub fn assert_vault(key: Pubkey, house: &HouseState, vault: &TokenAccount) -> Result<()> {
    require!(
        house.usdc_mint == USDC_MINT
            && vault.mint == USDC_MINT
            && vault.owner == key
            && vault.delegate.is_none()
            && vault.close_authority.is_none(),
        ErrorCode::InvalidVault
    );
    let required = required_vault_balance(
        house.total_available_base_units,
        house.total_purchase_escrow_base_units,
        house.total_max_gross_base_units,
        house.buffer_base_units,
    )
    .map_err(|_| error!(ErrorCode::ArithmeticOverflow))?;
    require!(vault.amount >= required, ErrorCode::InsolventHouse);
    Ok(())
}

#[derive(Accounts)]
pub struct ManageHouse<'info> {
    #[account(seeds=[GAME_CONFIG_SEED],bump=config.bump,
        constraint=config.schema_version==SCHEMA_VERSION @ ErrorCode::InvalidConfiguration,
        has_one=admin @ ErrorCode::InvalidAdmin)]
    pub config: Box<Account<'info, GameConfig>>,
    pub admin: Signer<'info>,
    #[account(mut,seeds=[HOUSE_SEED],bump=house.bump,has_one=config,
        constraint=house.schema_version==SCHEMA_VERSION @ ErrorCode::InvalidConfiguration)]
    pub house: Box<Account<'info, HouseState>>,
    #[account(mut,address=house.vault @ ErrorCode::InvalidVault)]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(mut,token::mint=usdc_mint,token::authority=admin)]
    pub admin_tokens: Box<Account<'info, TokenAccount>>,
    #[account(address=USDC_MINT @ ErrorCode::InvalidMint,constraint=usdc_mint.decimals==6 @ ErrorCode::InvalidMint)]
    pub usdc_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}

pub fn handle_fund_house(ctx: Context<ManageHouse>, args: AmountArgs) -> Result<()> {
    require!(args.amount_base_units > 0, ErrorCode::InvalidAmount);
    assert_vault(
        ctx.accounts.house.key(),
        &ctx.accounts.house,
        &ctx.accounts.vault,
    )?;
    token::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.admin_tokens.to_account_info(),
                mint: ctx.accounts.usdc_mint.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.admin.to_account_info(),
            },
        ),
        args.amount_base_units,
        6,
    )?;
    ctx.accounts.vault.reload()?;
    assert_vault(
        ctx.accounts.house.key(),
        &ctx.accounts.house,
        &ctx.accounts.vault,
    )
}

pub fn handle_withdraw_surplus(ctx: Context<ManageHouse>, args: AmountArgs) -> Result<()> {
    require!(args.amount_base_units > 0, ErrorCode::InvalidAmount);
    assert_vault(
        ctx.accounts.house.key(),
        &ctx.accounts.house,
        &ctx.accounts.vault,
    )?;
    let remaining = ctx
        .accounts
        .vault
        .amount
        .checked_sub(args.amount_base_units)
        .ok_or(ErrorCode::InsolventHouse)?;
    let required = required_vault_balance(
        ctx.accounts.house.total_available_base_units,
        ctx.accounts.house.total_purchase_escrow_base_units,
        ctx.accounts.house.total_max_gross_base_units,
        ctx.accounts.house.buffer_base_units,
    )
    .map_err(|_| error!(ErrorCode::ArithmeticOverflow))?;
    require!(remaining >= required, ErrorCode::InsolventHouse);
    let bump = [ctx.accounts.house.bump];
    let seeds: &[&[u8]] = &[HOUSE_SEED, &bump];
    token::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.vault.to_account_info(),
                mint: ctx.accounts.usdc_mint.to_account_info(),
                to: ctx.accounts.admin_tokens.to_account_info(),
                authority: ctx.accounts.house.to_account_info(),
            },
        )
        .with_signer(&[seeds]),
        args.amount_base_units,
        6,
    )?;
    ctx.accounts.vault.reload()?;
    assert_vault(
        ctx.accounts.house.key(),
        &ctx.accounts.house,
        &ctx.accounts.vault,
    )
}

#[derive(Accounts)]
pub struct SetHouseBuffer<'info> {
    #[account(seeds=[GAME_CONFIG_SEED],bump=config.bump,
        constraint=config.schema_version==SCHEMA_VERSION @ ErrorCode::InvalidConfiguration,
        has_one=admin @ ErrorCode::InvalidAdmin)]
    pub config: Box<Account<'info, GameConfig>>,
    pub admin: Signer<'info>,
    #[account(mut,seeds=[HOUSE_SEED],bump=house.bump,has_one=config,
        constraint=house.schema_version==SCHEMA_VERSION @ ErrorCode::InvalidConfiguration)]
    pub house: Box<Account<'info, HouseState>>,
    #[account(address=house.vault @ ErrorCode::InvalidVault)]
    pub vault: Box<Account<'info, TokenAccount>>,
}

pub fn handle_set_house_buffer(ctx: Context<SetHouseBuffer>, args: AmountArgs) -> Result<()> {
    assert_vault(
        ctx.accounts.house.key(),
        &ctx.accounts.house,
        &ctx.accounts.vault,
    )?;
    ctx.accounts.house.buffer_base_units = args.amount_base_units;
    assert_vault(
        ctx.accounts.house.key(),
        &ctx.accounts.house,
        &ctx.accounts.vault,
    )
}
