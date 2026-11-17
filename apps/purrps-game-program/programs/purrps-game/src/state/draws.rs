use anchor_lang::prelude::*;

use crate::{
    catalog::{CatId, Rarity},
    contracts::VersionBinding,
};

#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Debug, Clone, Copy, PartialEq, Eq)]
pub enum CapsuleKind {
    StarterCat,
    PaidCat,
    Upgrade,
}

#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Debug, Clone, Copy, PartialEq, Eq)]
pub enum DrawStatus {
    Pending,
    Fulfilled,
    Refunded,
}

#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Debug, Clone, Copy, PartialEq, Eq)]
pub enum DrawResult {
    Cat(CatId),
    Upgrade(Rarity),
}

// Base-only [DRAW_SEED, owner, nonce.to_le_bytes()]. Freeze before requesting
// VRF. Upgrade pool uses slots 0..3, slot 3 zero. Starter has no paid deadline.
// Pending -> Fulfilled or Refunded exactly once; callback now < paid deadline,
// refund now >= deadline. Verify VRF request/queue/signer before any grant.
#[account]
#[derive(InitSpace)]
pub struct CapsuleDraw {
    pub schema_version: u16,
    pub bump: u8,
    pub owner: Pubkey,
    pub nonce: u64,
    pub kind: CapsuleKind,
    pub status: DrawStatus,
    pub catalog: VersionBinding,
    pub inventory_version: u64,
    pub eligible_mask: u8,
    pub weights: [u16; 4],
    pub total_weight: u16,
    pub price_base_units: u64,
    pub vrf_program: Pubkey,
    pub vrf_queue: Pubkey,
    pub vrf_request: Pubkey,
    pub callback_authority: Pubkey,
    pub committed_seed_hash: [u8; 32],
    pub requested_at_seconds: i64,
    pub paid_deadline_seconds: Option<i64>,
    pub result: Option<DrawResult>,
    pub completed_at_seconds: Option<i64>,
}
