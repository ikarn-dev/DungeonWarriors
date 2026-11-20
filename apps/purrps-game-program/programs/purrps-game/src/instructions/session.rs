use crate::{
    constants::*,
    error::ErrorCode,
    instruction_args::AuthorizeSessionArgs,
    state::{
        collection::{PlayerAccount, SessionAuthorization},
        config::GameConfig,
    },
};
use anchor_lang::prelude::*;
use session_keys::SessionToken;

pub fn validate_token(
    key: Pubkey,
    token: &SessionToken,
    owner: Pubkey,
    input_key: Pubkey,
    expires: i64,
    now: i64,
) -> Result<()> {
    let expected = Pubkey::find_program_address(
        &[
            SessionToken::SEED_PREFIX.as_bytes(),
            crate::ID.as_ref(),
            input_key.as_ref(),
            owner.as_ref(),
        ],
        &session_keys::ID,
    )
    .0;
    require!(
        key == expected
            && token.authority == owner
            && token.target_program == crate::ID
            && token.session_signer == input_key
            && input_key.is_on_curve()
            && now < expires
            && expires <= token.valid_until,
        ErrorCode::InvalidSession
    );
    Ok(())
}
#[derive(Accounts)]
#[instruction(args:AuthorizeSessionArgs)]
pub struct AuthorizeSession<'info> {
    #[account(seeds=[GAME_CONFIG_SEED],bump=config.bump,constraint=config.schema_version==SCHEMA_VERSION @ ErrorCode::InvalidConfiguration)]
    pub config: Box<Account<'info, GameConfig>>,
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut,seeds=[PLAYER_SEED,owner.key().as_ref()],bump=player.bump,has_one=owner,constraint=player.schema_version==SCHEMA_VERSION @ ErrorCode::InvalidConfiguration)]
    pub player: Box<Account<'info, PlayerAccount>>,
    #[account(address=args.session_token)]
    pub session_token: Box<Account<'info, SessionToken>>,
    #[account(init,payer=owner,space=8+SessionAuthorization::INIT_SPACE,seeds=[SESSION_SEED,owner.key().as_ref(),&args.expected_session_nonce.to_le_bytes()],bump)]
    pub authorization: Box<Account<'info, SessionAuthorization>>,
    pub system_program: Program<'info, System>,
}
pub fn handle_authorize_session(
    ctx: Context<AuthorizeSession>,
    args: AuthorizeSessionArgs,
) -> Result<()> {
    require!(
        args.expected_session_nonce == ctx.accounts.player.next_session_nonce,
        ErrorCode::InvalidSession
    );
    validate_token(
        ctx.accounts.session_token.key(),
        &ctx.accounts.session_token,
        ctx.accounts.owner.key(),
        args.input_key,
        args.expires_at_seconds,
        Clock::get()?.unix_timestamp,
    )?;
    let next = ctx
        .accounts
        .player
        .next_session_nonce
        .checked_add(1)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    ctx.accounts.authorization.set_inner(SessionAuthorization {
        schema_version: SCHEMA_VERSION,
        bump: ctx.bumps.authorization,
        owner: ctx.accounts.owner.key(),
        input_key: args.input_key,
        session_token: args.session_token,
        program: crate::ID,
        nonce: args.expected_session_nonce,
        expires_at_seconds: args.expires_at_seconds,
        allowance_base_units: args.allowance_base_units,
        spent_base_units: 0,
        revoked: false,
    });
    ctx.accounts.player.next_session_nonce = next;
    Ok(())
}
#[derive(Accounts)]
pub struct RevokeSession<'info> {
    pub owner: Signer<'info>,
    #[account(mut,seeds=[SESSION_SEED,owner.key().as_ref(),&authorization.nonce.to_le_bytes()],bump=authorization.bump,has_one=owner,constraint=authorization.schema_version==SCHEMA_VERSION @ ErrorCode::InvalidConfiguration)]
    pub authorization: Box<Account<'info, SessionAuthorization>>,
}
pub fn handle_revoke_session(ctx: Context<RevokeSession>) -> Result<()> {
    // Existing runs keep their frozen key/expiry; ER revocation is a distinct action.
    ctx.accounts.authorization.revoked = true;
    Ok(())
}
