use crate::{
    constants::*,
    error::ErrorCode,
    instruction_args::{ConfigureSponsorshipArgs, FundSponsorshipArgs},
    state::{
        config::GameConfig,
        economy::{SponsorBudget, SponsorPolicy, SponsorPurpose},
    },
};
use anchor_lang::{
    prelude::*,
    system_program::{self, Transfer},
};

#[derive(Accounts)]
pub struct ConfigureSponsorship<'info> {
    #[account(seeds=[GAME_CONFIG_SEED],bump=config.bump,has_one=admin,constraint=config.schema_version==SCHEMA_VERSION @ ErrorCode::InvalidConfiguration)]
    pub config: Box<Account<'info, GameConfig>>,
    #[account(mut)]
    pub admin: Signer<'info>,
    // This mutable admin policy can rotate keys; published rules/catalogs never use init_if_needed.
    #[account(init_if_needed,payer=admin,space=8+SponsorPolicy::INIT_SPACE,seeds=[SPONSOR_POLICY_SEED],bump)]
    pub policy: Box<Account<'info, SponsorPolicy>>,
    pub system_program: Program<'info, System>,
}
pub fn handle_configure_sponsorship(
    ctx: Context<ConfigureSponsorship>,
    args: ConfigureSponsorshipArgs,
) -> Result<()> {
    require!(
        args.authority.is_on_curve()
            && args.authority != ctx.accounts.admin.key()
            && args.max_operation_lamports > 0
            && args.min_completion_lamports > 0
            && args.min_completion_lamports <= args.max_operation_lamports
            && args.max_attempts > 0,
        ErrorCode::InvalidSponsorBudget
    );
    require!(
        ctx.accounts.policy.schema_version == 0
            || (ctx.accounts.policy.schema_version == SCHEMA_VERSION
                && ctx.accounts.policy.config == ctx.accounts.config.key()
                && ctx.accounts.policy.bump == ctx.bumps.policy),
        ErrorCode::InvalidSponsorBudget
    );
    ctx.accounts.policy.set_inner(SponsorPolicy {
        schema_version: SCHEMA_VERSION,
        bump: ctx.bumps.policy,
        config: ctx.accounts.config.key(),
        authority: args.authority,
        max_operation_lamports: args.max_operation_lamports,
        min_completion_lamports: args.min_completion_lamports,
        max_attempts: args.max_attempts,
        paused: args.paused,
    });
    Ok(())
}

#[derive(Accounts)]
#[instruction(args:FundSponsorshipArgs)]
pub struct FundSponsorship<'info> {
    #[account(seeds=[GAME_CONFIG_SEED],bump=config.bump,constraint=config.schema_version==SCHEMA_VERSION @ ErrorCode::InvalidConfiguration)]
    pub config: Box<Account<'info, GameConfig>>,
    #[account(seeds=[SPONSOR_POLICY_SEED],bump=policy.bump,has_one=config,constraint=policy.schema_version==SCHEMA_VERSION @ ErrorCode::InvalidConfiguration)]
    pub policy: Box<Account<'info, SponsorPolicy>>,
    #[account(mut,address=policy.authority @ ErrorCode::InvalidSponsorBudget)]
    pub funder: Signer<'info>,
    #[account(init,payer=funder,space=8+SponsorBudget::INIT_SPACE,seeds=[SPONSOR_SEED,args.operation.as_ref()],bump)]
    pub budget: Box<Account<'info, SponsorBudget>>,
    pub system_program: Program<'info, System>,
}
pub fn handle_fund_sponsorship(
    ctx: Context<FundSponsorship>,
    args: FundSponsorshipArgs,
) -> Result<()> {
    let policy = &ctx.accounts.policy;
    require!(
        !policy.paused
            && args.purpose == SponsorPurpose::RunCompletion
            && args.operation != Pubkey::default()
            && args.beneficiary != Pubkey::default()
            && args.limit_lamports <= policy.max_operation_lamports
            && args.reserved_completion_lamports >= policy.min_completion_lamports
            && args.reserved_completion_lamports <= args.limit_lamports
            && args.max_attempts > 0
            && args.max_attempts <= policy.max_attempts
            && args.expires_at_seconds > Clock::get()?.unix_timestamp,
        ErrorCode::InvalidSponsorBudget
    );
    ctx.accounts.budget.set_inner(SponsorBudget {
        schema_version: SCHEMA_VERSION,
        bump: ctx.bumps.budget,
        operation: args.operation,
        beneficiary: args.beneficiary,
        authority: ctx.accounts.funder.key(),
        fee_payer: ctx.accounts.funder.key(),
        purpose: args.purpose,
        limit_lamports: args.limit_lamports,
        spent_lamports: 0,
        reserved_completion_lamports: args.reserved_completion_lamports,
        max_attempts: args.max_attempts,
        attempts: 0,
        expires_at_seconds: args.expires_at_seconds,
    });
    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.key(),
            Transfer {
                from: ctx.accounts.funder.to_account_info(),
                to: ctx.accounts.budget.to_account_info(),
            },
        ),
        args.limit_lamports,
    )?;
    Ok(())
}
