use anchor_lang::prelude::*;

use crate::{
    catalog::{CatId, Rarity},
    contracts::VersionBinding,
};

// Base-only [PLAYER_SEED, owner]. All credit changes atomically update HouseState
// totals and the relevant escrow. Pending rewards are a view, not available funds.
#[account]
#[derive(InitSpace)]
pub struct PlayerAccount {
    pub schema_version: u16,
    pub bump: u8,
    pub owner: Pubkey,
    pub available_base_units: u64,
    pub locked_stake_base_units: u64,
    pub purchase_escrow_base_units: u64,
    pub next_run_nonce: u64,
    pub next_draw_nonce: u64,
    pub next_session_nonce: u64,
    pub settled_runs: u64,
    pub wins: u64,
    pub losses: u64,
    pub technical_refunds: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Debug, Clone, Copy, PartialEq, Eq)]
pub struct OwnedCat {
    pub cat: CatId,
    pub rarity: Rarity,
    pub defining_catalog: VersionBinding,
    pub level: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Debug, Clone, Copy, PartialEq, Eq)]
pub enum StarterClaim {
    Unclaimed,
    Pending,
    Fulfilled,
}

// Base-only [COLLECTION_SEED, owner]. Slots follow CatId order; mask and Some(cat)
// must agree. Inventory version changes on grants/apply/select. Pending draw locks
// all those mutations except its exclusive fulfillment; run reads may continue.
#[account]
#[derive(InitSpace)]
pub struct Collection {
    pub schema_version: u16,
    pub bump: u8,
    pub owner: Pubkey,
    pub inventory_version: u64,
    pub owned_mask: u8,
    pub cats: [Option<OwnedCat>; 4],
    pub upgrade_quantities: [u64; 3],
    pub selected_cat: Option<CatId>,
    pub starter: StarterClaim,
    pub pending_draw: Option<Pubkey>,
}

// Base-only [SESSION_SEED, owner, nonce.to_le_bytes()]. Token/key/program/owner
// and expiry are checked at reservation; spent never decreases on run completion.
// Base revocation blocks reservations without rewriting existing run permissions.
#[account]
#[derive(InitSpace)]
pub struct SessionAuthorization {
    pub schema_version: u16,
    pub bump: u8,
    pub owner: Pubkey,
    pub input_key: Pubkey,
    pub session_token: Pubkey,
    pub program: Pubkey,
    pub nonce: u64,
    pub expires_at_seconds: i64,
    pub allowance_base_units: u64,
    pub spent_base_units: u64,
    pub revoked: bool,
}
