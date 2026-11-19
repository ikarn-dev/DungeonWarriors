use anchor_lang::prelude::*;

use super::inspect_run::*;
use crate::{
    constants::*,
    contracts::Market,
    error::ErrorCode,
    oracle::{inspect_account, InspectedOracle},
    state::{config::GameConfig, run::OracleObservation},
};

#[derive(Accounts)]
pub struct InspectOracle<'info> {
    #[account(seeds = [GAME_CONFIG_SEED], bump = config.bump,
        constraint = config.schema_version == SCHEMA_VERSION @ ErrorCode::InvalidConfiguration)]
    pub config: Account<'info, GameConfig>,
    /// CHECK: exact market PDA, owner, discriminator, authority and price policy
    /// are validated by inspect_account; this instruction mutates no state.
    pub price_update: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct InspectRunOracle<'info> {
    pub state: InspectRun<'info>,
    /// CHECK: inspect_account verifies the run's frozen oracle address and owner.
    pub price_update: UncheckedAccount<'info>,
}

pub fn handle_inspect_run_oracle(ctx: Context<InspectRunOracle>) -> Result<OracleObservation> {
    let run = &ctx.accounts.state.run;
    require!(
        run.snapshot_hash == snapshot_hash(&run.snapshot)?,
        ErrorCode::InvalidRun
    );
    let clock = Clock::get()?;
    let data = ctx.accounts.price_update.try_borrow_data()?;
    inspect_account(
        ctx.accounts.price_update.key,
        ctx.accounts.price_update.owner,
        &data,
        &run.snapshot.oracle,
        run.snapshot.market,
        clock.unix_timestamp,
        clock.slot,
    )?
    .next_observation(run.latest_observation()?)
}

pub fn handle_inspect_oracle(
    ctx: Context<InspectOracle>,
    market: Market,
) -> Result<InspectedOracle> {
    let clock = Clock::get()?;
    let data = ctx.accounts.price_update.try_borrow_data()?;
    inspect_account(
        ctx.accounts.price_update.key,
        ctx.accounts.price_update.owner,
        &data[..],
        &ctx.accounts.config.oracle_bindings[market as usize],
        market,
        clock.unix_timestamp,
        clock.slot,
    )
}
