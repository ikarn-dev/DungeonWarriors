use crate::{
    catalog::CatId,
    dungeon::{DungeonRules, MAX_ROOMS},
};
use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct DungeonConfig {
    pub bump: u8,
    pub enabled: bool,
    pub verifier: Pubkey,
    pub rules: DungeonRules,
    pub rules_hash: [u8; 32],
}
#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Clone, Copy, Debug, PartialEq, Eq)]
pub enum DungeonStatus {
    AwaitingRandomness,
    Ready,
    Won,
    Lost,
    Refunded,
}

#[account]
#[derive(InitSpace)]
pub struct DungeonExpedition {
    pub schema_version: u16,
    pub bump: u8,
    pub owner: Pubkey,
    pub nonce: u64,
    pub cat: CatId,
    pub verifier: Pubkey,
    pub rules: DungeonRules,
    pub rules_hash: [u8; 32],
    pub stake: u64,
    pub max_rooms: u8,
    pub max_gross: u64,
    pub commitment: [u8; 32],
    pub vrf_program: Pubkey,
    pub vrf_queue: Pubkey,
    pub callback_authority: Pubkey,
    pub request_seed: [u8; 32],
    pub requested_at: i64,
    pub randomness_deadline: i64,
    pub randomness: Option<[u8; 32]>,
    pub status: DungeonStatus,
    pub secret: Option<[u8; 32]>,
    pub gates: [u8; MAX_ROOMS],
    pub gate_count: u8,
    pub cleared: u8,
    pub payout: u64,
    pub completed_at: Option<i64>,
}
