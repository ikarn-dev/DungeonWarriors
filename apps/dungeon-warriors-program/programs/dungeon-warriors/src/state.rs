use anchor_lang::prelude::*;

pub mod collection;
pub mod config;
pub mod draws;
pub mod dungeon;
pub mod economy;
pub mod records;
pub mod run;

#[account]
#[derive(InitSpace)]
pub struct Counter {
    pub count: u64,
    pub authority: Pubkey,
}
