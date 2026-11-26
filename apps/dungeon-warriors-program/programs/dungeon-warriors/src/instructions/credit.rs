use super::{
    game_device::{GameDevice, GAME_DEVICE_SEED},
    house::assert_vault,
};
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
    /// CHECK: Credit accounts bind this owner, and each instruction checks authority.
    pub owner: UncheckedAccount<'info>,
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
    require!(ctx.accounts.owner.is_signer, ErrorCode::InvalidOwner);
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

#[derive(Accounts)]
pub struct WithdrawWithDevice<'info> {
    pub credit: TransferCredit<'info>,
    pub device: Signer<'info>,
    #[account(mut,seeds=[GAME_DEVICE_SEED,credit.owner.key().as_ref()],bump,
        constraint=access.owner==credit.owner.key() @ ErrorCode::InvalidSession,
        has_one=device @ ErrorCode::InvalidSession)]
    pub access: Account<'info, GameDevice>,
}

pub fn handle_withdraw_with_device(
    ctx: Context<WithdrawWithDevice>,
    args: AmountArgs,
    nonce: u64,
) -> Result<()> {
    let a = ctx.accounts;
    require!(a.access.next_withdrawal == nonce, ErrorCode::InvalidSession);
    let destination = anchor_spl::associated_token::get_associated_token_address(
        &a.credit.owner.key(),
        &a.credit.usdc_mint.key(),
    );
    require_keys_eq!(
        a.credit.owner_tokens.key(),
        destination,
        ErrorCode::InvalidOwner
    );
    a.access.next_withdrawal = nonce.checked_add(1).ok_or(ErrorCode::ArithmeticOverflow)?;
    withdraw(&mut a.credit, args)
}

pub fn handle_withdraw(ctx: Context<TransferCredit>, args: AmountArgs) -> Result<()> {
    require!(ctx.accounts.owner.is_signer, ErrorCode::InvalidOwner);
    withdraw(ctx.accounts, args)
}

fn withdraw(credit: &mut TransferCredit<'_>, args: AmountArgs) -> Result<()> {
    let amount = args.amount_base_units;
    require!(amount > 0, ErrorCode::InvalidAmount);
    assert_vault(credit.house.key(), &credit.house, &credit.vault)?;
    let available = credit
        .player
        .available_base_units
        .checked_sub(amount)
        .ok_or(ErrorCode::InsufficientCredit)?;
    let total = credit
        .house
        .total_available_base_units
        .checked_sub(amount)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    let bump = [credit.house.bump];
    let seeds: &[&[u8]] = &[HOUSE_SEED, &bump];
    token::transfer_checked(
        CpiContext::new(
            credit.token_program.key(),
            TransferChecked {
                from: credit.vault.to_account_info(),
                mint: credit.usdc_mint.to_account_info(),
                to: credit.owner_tokens.to_account_info(),
                authority: credit.house.to_account_info(),
            },
        )
        .with_signer(&[seeds]),
        amount,
        6,
    )?;
    credit.player.available_base_units = available;
    credit.house.total_available_base_units = total;
    credit.vault.reload()?;
    assert_vault(credit.house.key(), &credit.house, &credit.vault)
}
