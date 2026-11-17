pub mod catalog;
pub mod constants;
pub mod contracts;
pub mod economy;
pub mod error;
pub mod instruction_args;
pub mod instructions;
pub mod protocol;
pub mod rules;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::Counter;

declare_id!("F1cmavHq4562uJ8JmRPM5oFk8q28GW5hadXnZfVCCcUx");

#[program]
pub mod purrps_game {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        crate::instructions::initialize::handle_initialize(ctx)
    }

    pub fn increment(ctx: Context<Increment>) -> Result<()> {
        crate::instructions::increment::handle_increment(ctx)
    }
}
