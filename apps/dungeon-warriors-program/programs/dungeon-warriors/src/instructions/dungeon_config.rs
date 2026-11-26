use crate::{
    constants::GAME_CONFIG_SEED,
    dungeon::*,
    error::ErrorCode,
    state::{config::GameConfig, dungeon::DungeonConfig},
};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct ConfigureDungeon<'info> {
    #[account(seeds=[GAME_CONFIG_SEED],bump=config.bump,has_one=admin)]
    pub config: Account<'info, GameConfig>,
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(init_if_needed,payer=admin,space=8+DungeonConfig::INIT_SPACE,
        seeds=[DUNGEON_CONFIG_SEED],bump)]
    pub dungeon: Account<'info, DungeonConfig>,
    pub system_program: Program<'info, System>,
}
pub fn handle_configure_dungeon(
    ctx: Context<ConfigureDungeon>,
    rules: DungeonRules,
    verifier: Pubkey,
    enabled: bool,
) -> Result<()> {
    rules.validate()?;
    require!(
        verifier != Pubkey::default() && verifier != ctx.accounts.admin.key(),
        ErrorCode::InvalidConfiguration
    );
    let record = &mut ctx.accounts.dungeon;
    let hash = rules.content_hash()?;
    require!(
        record.rules.version == 0
            || rules.version
                == record
                    .rules
                    .version
                    .checked_add(1)
                    .ok_or(ErrorCode::ArithmeticOverflow)?
            || (rules.version == record.rules.version && hash == record.rules_hash),
        ErrorCode::StaleVersion
    );
    record.set_inner(DungeonConfig {
        bump: ctx.bumps.dungeon,
        enabled,
        verifier,
        rules,
        rules_hash: hash,
    });
    Ok(())
}
