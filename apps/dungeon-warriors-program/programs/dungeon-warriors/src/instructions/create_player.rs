use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::ErrorCode,
    state::{
        collection::{Collection, PlayerAccount, StarterClaim},
        config::GameConfig,
    },
};

#[derive(Accounts)]
pub struct CreatePlayer<'info> {
    #[account(seeds = [GAME_CONFIG_SEED], bump = config.bump,
        constraint = config.schema_version == SCHEMA_VERSION @ ErrorCode::InvalidConfiguration)]
    pub config: Account<'info, GameConfig>,
    pub owner: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(init, payer = payer, space = 8 + PlayerAccount::INIT_SPACE,
        seeds = [PLAYER_SEED, owner.key().as_ref()], bump)]
    pub player: Account<'info, PlayerAccount>,
    #[account(init, payer = payer, space = 8 + Collection::INIT_SPACE,
        seeds = [COLLECTION_SEED, owner.key().as_ref()], bump)]
    pub collection: Account<'info, Collection>,
    pub system_program: Program<'info, System>,
}

pub fn handle_create_player(ctx: Context<CreatePlayer>) -> Result<()> {
    ctx.accounts.player.set_inner(PlayerAccount {
        schema_version: SCHEMA_VERSION,
        bump: ctx.bumps.player,
        owner: ctx.accounts.owner.key(),
        available_base_units: 0,
        locked_stake_base_units: 0,
        purchase_escrow_base_units: 0,
        next_run_nonce: 0,
        next_draw_nonce: 0,
        next_session_nonce: 0,
        settled_runs: 0,
        wins: 0,
        losses: 0,
        technical_refunds: 0,
    });
    ctx.accounts.collection.set_inner(Collection {
        schema_version: SCHEMA_VERSION,
        bump: ctx.bumps.collection,
        owner: ctx.accounts.owner.key(),
        inventory_version: 0,
        owned_mask: 0,
        cats: [None; 4],
        upgrade_quantities: [0; 3],
        selected_cat: None,
        starter: StarterClaim::Unclaimed,
        pending_draw: None,
    });
    Ok(())
}
