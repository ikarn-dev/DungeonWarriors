use anchor_lang::prelude::*;

use crate::{
    catalog::{CatDefinition, CatStats},
    protocol::InputPermission,
    rules::GameRules,
};

#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Debug, Clone, Copy, PartialEq, Eq)]
pub enum Market {
    Btc,
    Eth,
    Sol,
}

impl Market {
    pub const fn feed_id(self) -> u32 {
        match self {
            Self::Btc => 1,
            Self::Eth => 2,
            Self::Sol => 6,
        }
    }
}

// Published rules/catalog hashes separate type + schema domain and program ID.
// Catalog hashes additionally bind its media manifest, not just numeric values.
#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Debug, Clone, Copy, PartialEq, Eq)]
pub struct VersionBinding {
    pub version: u32,
    pub content_hash: [u8; 32],
}

// Program/source/account/schema/pusher and validator stay pinned across recovery.
// Freshness policy is published explicitly after P1 provider validation, never
// inferred from an advertised update cadence or a browser clock.
#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Debug, Clone, Copy, PartialEq, Eq)]
pub struct OracleBinding {
    pub program: Pubkey,
    pub account: Pubkey,
    pub write_authority: Pubkey,
    pub validator: Pubkey,
    pub feed_id: u32,
    pub schema_version: u16,
    pub max_age_seconds: u16,
    pub max_future_skew_seconds: u16,
    pub min_exponent: i32,
    pub max_exponent: i32,
}

#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Debug, Clone, Copy, PartialEq, Eq)]
pub struct CatSnapshot {
    pub definition: CatDefinition,
    pub defining_catalog: VersionBinding,
    pub level: u8,
    pub stats: CatStats,
}

// Hash the canonical Borsh bytes on reservation and verify the same hash on
// activation/return. A later catalog, key, inventory or config cannot rewrite it.
#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Debug, Clone, Copy, PartialEq, Eq)]
pub struct RunSnapshot {
    pub protocol_version: u16,
    pub run: Pubkey,
    pub owner: Pubkey,
    pub nonce: u64,
    pub market: Market,
    pub stake_base_units: u64,
    pub max_gross_base_units: u64,
    pub rules_binding: VersionBinding,
    pub rules: GameRules,
    pub cat: CatSnapshot,
    pub oracle: OracleBinding,
    pub input_permission: InputPermission,
    pub asset_manifest: VersionBinding,
    pub activation_deadline_seconds: i64,
    pub delegation_epoch: u64,
}

pub fn snapshot_hash(snapshot: &RunSnapshot) -> Result<[u8; 32]> {
    let mut bytes = Vec::new();
    snapshot.serialize(&mut bytes)?;
    Ok(solana_sha256_hasher::hashv(&[b"purrps:run:v1", crate::ID.as_ref(), &bytes]).to_bytes())
}
