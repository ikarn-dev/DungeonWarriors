pub mod catalog;
pub mod constants;
pub mod contracts;
pub mod economy;
pub mod error;
pub mod instruction_args;
pub mod instructions;
pub mod oracle;
pub mod protocol;
pub mod publication;
pub mod rules;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
use contracts::Market;
use instruction_args::{InitializeConfigArgs, PublishCatalogArgs, PublishRulesArgs};
pub use instructions::*;
use oracle::InspectedOracle;
pub use state::Counter;

declare_id!("F1cmavHq4562uJ8JmRPM5oFk8q28GW5hadXnZfVCCcUx");

#[program]
pub mod purrps_game {
    use super::*;

    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        args: InitializeConfigArgs,
    ) -> Result<()> {
        crate::instructions::initialize_config::handle_initialize_config(ctx, args)
    }

    pub fn publish_rules(ctx: Context<PublishRules>, args: PublishRulesArgs) -> Result<()> {
        crate::instructions::publish::handle_publish_rules(ctx, args)
    }

    pub fn publish_catalog(ctx: Context<PublishCatalog>, args: PublishCatalogArgs) -> Result<()> {
        crate::instructions::publish::handle_publish_catalog(ctx, args)
    }

    pub fn create_player(ctx: Context<CreatePlayer>) -> Result<()> {
        crate::instructions::create_player::handle_create_player(ctx)
    }

    pub fn inspect_oracle(ctx: Context<InspectOracle>, market: Market) -> Result<InspectedOracle> {
        crate::instructions::inspect_oracle::handle_inspect_oracle(ctx, market)
    }

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        crate::instructions::initialize::handle_initialize(ctx)
    }

    pub fn increment(ctx: Context<Increment>) -> Result<()> {
        crate::instructions::increment::handle_increment(ctx)
    }
}
