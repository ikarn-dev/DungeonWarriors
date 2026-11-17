use anchor_lang::prelude::*;

use crate::contracts::RunSnapshot;

// Base-only [HOUSE_SEED]. Vault is the USDC ATA owned by this PDA. These totals
// exclude separate SOL budgets; max_gross already includes every locked stake.
#[account]
#[derive(InitSpace)]
pub struct HouseState {
    pub schema_version: u16,
    pub bump: u8,
    pub config: Pubkey,
    pub usdc_mint: Pubkey,
    pub vault: Pubkey,
    pub total_available_base_units: u64,
    pub total_purchase_escrow_base_units: u64,
    pub total_max_gross_base_units: u64,
    pub buffer_base_units: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Debug, Clone, Copy, PartialEq, Eq)]
pub enum EscrowStatus {
    Reserved,
    SettledWin,
    SettledLoss,
    RefundedTechnical,
}

// Base-only [RUN_ESCROW_SEED, owner, nonce.to_le_bytes()]. Finish once by compare
// and set from Reserved; only authenticated returned game state chooses outcome.
// A delegated stale base mirror can never prove that this run is unplayed.
#[account]
#[derive(InitSpace)]
pub struct RunEscrow {
    pub schema_version: u16,
    pub bump: u8,
    pub game_state: Pubkey,
    pub snapshot: RunSnapshot,
    pub snapshot_hash: [u8; 32],
    pub sponsor_budget: Pubkey,
    pub delegation_initiated: bool,
    pub status: EscrowStatus,
    pub receipt: Option<Pubkey>,
}

#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Debug, Clone, Copy, PartialEq, Eq)]
pub enum SponsorPurpose {
    StarterDraw,
    PaidDraw,
    RunActivation,
    RunCompletion,
}

// [SPONSOR_SEED, operation]. Only SDK-required operational SOL records may be
// delegated. Signatures bind this operation/purpose, not caller-chosen transfers.
#[account]
#[derive(InitSpace)]
pub struct SponsorBudget {
    pub schema_version: u16,
    pub bump: u8,
    pub operation: Pubkey,
    pub beneficiary: Pubkey,
    pub authority: Pubkey,
    pub fee_payer: Pubkey,
    pub purpose: SponsorPurpose,
    pub limit_lamports: u64,
    pub spent_lamports: u64,
    pub reserved_completion_lamports: u64,
    pub max_attempts: u16,
    pub attempts: u16,
    pub expires_at_seconds: i64,
}
