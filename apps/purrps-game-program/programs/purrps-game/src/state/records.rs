use anchor_lang::prelude::*;

use crate::{
    contracts::{CatSnapshot, Market, OracleBinding, VersionBinding},
    state::run::{OracleObservation, RunTerminal},
};

// Base-only [RESULT_SEED, owner, nonce.to_le_bytes()]. Retained permanently in
// this MVP. A run's exclusive settlement writes this and counters atomically;
// paginate receipt addresses by the player's run nonce, tolerating pending gaps.
#[account]
#[derive(InitSpace)]
pub struct ResultReceipt {
    pub schema_version: u16,
    pub bump: u8,
    pub run: Pubkey,
    pub owner: Pubkey,
    pub nonce: u64,
    pub market: Market,
    pub snapshot_hash: [u8; 32],
    pub rules: VersionBinding,
    pub cat: CatSnapshot,
    pub oracle: OracleBinding,
    pub start_observation: Option<OracleObservation>,
    pub stake_base_units: u64,
    pub terminal: RunTerminal,
    pub settled_at_slot: u64,
    pub settled_at_seconds: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Debug, Clone, Copy, PartialEq, Eq)]
pub struct LeaderboardEntry {
    pub run: Pubkey,
    pub owner: Pubkey,
    pub nonce: u64,
    pub score: u64,
}

// Base-only [LEADERBOARD_SEED, [market as u8]]. At most 20 settled win/loss
// entries, score descending then raw run Pubkey bytes ascending; refunds excluded.
#[account]
#[derive(InitSpace)]
pub struct Leaderboard {
    pub schema_version: u16,
    pub bump: u8,
    pub market: Market,
    pub count: u8,
    pub entries: [Option<LeaderboardEntry>; 20],
}
