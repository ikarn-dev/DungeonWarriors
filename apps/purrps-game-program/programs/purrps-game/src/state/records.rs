use anchor_lang::prelude::*;
use std::io::{self, Read};

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
pub struct Leaderboard {
    pub schema_version: u16,
    pub bump: u8,
    pub market: Market,
    pub count: u8,
    // Keep the fixed array's wire layout while leaving room on the SBF stack.
    #[borsh(deserialize_with = "read_leaderboard_entries")]
    pub entries: Box<[Option<LeaderboardEntry>; 20]>,
}

impl Space for Leaderboard {
    const INIT_SPACE: usize = 5 + 20 * (1 + LeaderboardEntry::INIT_SPACE);
}

fn read_leaderboard_entries<R: Read>(
    reader: &mut R,
) -> io::Result<Box<[Option<LeaderboardEntry>; 20]>> {
    let mut entries = Vec::with_capacity(20);
    for _ in 0..20 {
        entries.push(Option::<LeaderboardEntry>::deserialize_reader(reader)?);
    }
    entries
        .into_boxed_slice()
        .try_into()
        .map_err(|_| io::ErrorKind::InvalidData.into())
}
