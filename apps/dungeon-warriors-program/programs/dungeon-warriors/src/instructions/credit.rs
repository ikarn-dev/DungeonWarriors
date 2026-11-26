use super::house::assert_vault;
use crate::{
    constants::*,
    error::ErrorCode,
    instruction_args::AmountArgs,
    state::{collection::PlayerAccount, config::GameConfig, economy::HouseState},
};
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

#[derive(Accounts)]
pub struct TransferCredit<'info> {
    #[account(seeds=[GAME_CONFIG_SEED],bump=config.bump,
        constraint=config.schema_version==SCHEMA_VERSION @ ErrorCode::InvalidConfiguration)]
    pub config: Box<Account<'info, GameConfig>>,
    pub owner: Signer<'info>,
    #[account(mut,seeds=[PLAYER_SEED,owner.key().as_ref()],bump=player.bump,
        has_one=owner @ ErrorCode::InvalidOwner,
        constraint=player.schema_version==SCHEMA_VERSION @ ErrorCode::InvalidConfiguration)]
    pub player: Box<Account<'info, PlayerAccount>>,
    #[account(mut,seeds=[HOUSE_SEED],bump=house.bump,has_one=config,
        constraint=house.schema_version==SCHEMA_VERSION @ ErrorCode::InvalidConfiguration)]
    pub house: Box<Account<'info, HouseState>>,
    #[account(mut,address=house.vault @ ErrorCode::InvalidVault)]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(mut,token::mint=usdc_mint,token::authority=owner)]
    pub owner_tokens: Box<Account<'info, TokenAccount>>,
    #[account(address=USDC_MINT @ ErrorCode::InvalidMint,constraint=usdc_mint.decimals==6 @ ErrorCode::InvalidMint)]
    pub usdc_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}

pub fn handle_deposit(ctx: Context<TransferCredit>, args: AmountArgs) -> Result<()> {
    let amount = args.amount_base_units;
    require!(amount > 0, ErrorCode::InvalidAmount);
    assert_vault(
        ctx.accounts.house.key(),
        &ctx.accounts.house,
        &ctx.accounts.vault,
    )?;
    let available = ctx
        .accounts
        .player
        .available_base_units
        .checked_add(amount)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    let total = ctx
        .accounts
        .house
        .total_available_base_units
        .checked_add(amount)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    token::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.owner_tokens.to_account_info(),
                mint: ctx.accounts.usdc_mint.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.owner.to_account_info(),
            },
        ),
        amount,
        6,
    )?;
    ctx.accounts.player.available_base_units = available;
    ctx.accounts.house.total_available_base_units = total;
    ctx.accounts.vault.reload()?;
    assert_vault(
        ctx.accounts.house.key(),
        &ctx.accounts.house,
        &ctx.accounts.vault,
    )
}

pub fn handle_withdraw(ctx: Context<TransferCredit>, args: AmountArgs) -> Result<()> {
    let amount = args.amount_base_units;
    require!(amount > 0, ErrorCode::InvalidAmount);
    assert_vault(
        ctx.accounts.house.key(),
        &ctx.accounts.house,
        &ctx.accounts.vault,
    )?;
    let available = ctx
        .accounts
        .player
        .available_base_units
        .checked_sub(amount)
        .ok_or(ErrorCode::InsufficientCredit)?;
    let total = ctx
        .accounts
        .house
        .total_available_base_units
        .checked_sub(amount)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    let bump = [ctx.accounts.house.bump];
    let seeds: &[&[u8]] = &[HOUSE_SEED, &bump];
    token::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.vault.to_account_info(),
                mint: ctx.accounts.usdc_mint.to_account_info(),
                to: ctx.accounts.owner_tokens.to_account_info(),
                authority: ctx.accounts.house.to_account_info(),
            },
        )
        .with_signer(&[seeds]),
        amount,
        6,
    )?;
    ctx.accounts.player.available_base_units = available;
    ctx.accounts.house.total_available_base_units = total;
    ctx.accounts.vault.reload()?;
    assert_vault(
        ctx.accounts.house.key(),
        &ctx.accounts.house,
        &ctx.accounts.vault,
    )
}
