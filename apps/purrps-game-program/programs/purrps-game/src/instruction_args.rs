use anchor_lang::prelude::*;

use crate::{
    catalog::{CatId, Catalog, Rarity},
    contracts::{Market, OracleBinding, VersionBinding},
    protocol::IntentEnvelope,
    rules::GameRules,
    state::{draws::CapsuleKind, economy::SponsorPurpose},
};

// Argument contracts for callable administration and planned gameplay/economy
// handlers. Each handler enforces its accounts/signers and atomic effects. No client
// argument carries earned score, progress, payout or technical-refund eligibility.
#[derive(AnchorSerialize, AnchorDeserialize, Debug, Clone)]
pub struct InitializeConfigArgs {
    pub oracle_bindings: [OracleBinding; 3],
}

#[derive(AnchorSerialize, AnchorDeserialize, Debug, Clone)]
pub struct PublishRulesArgs {
    pub expected_current_version: u32,
    pub rules: GameRules,
}

#[derive(AnchorSerialize, AnchorDeserialize, Debug, Clone)]
pub struct PublishCatalogArgs {
    pub expected_current_version: u32,
    pub catalog: Catalog,
    pub asset_manifest: VersionBinding,
}

#[derive(AnchorSerialize, AnchorDeserialize, Debug, Clone)]
pub struct SetAdmissionArgs {
    pub starter: bool,
    pub purchases: bool,
    pub reservations: bool,
}

// Deposits/withdrawals require the owner signer; fund_house and admin surplus
// withdrawal use their distinct account/signature constraints with this amount.
#[derive(AnchorSerialize, AnchorDeserialize, Debug, Clone)]
pub struct AmountArgs {
    pub amount_base_units: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Debug, Clone)]
pub struct AuthorizeSessionArgs {
    pub expected_session_nonce: u64,
    pub input_key: Pubkey,
    pub session_token: Pubkey,
    pub expires_at_seconds: i64,
    pub allowance_base_units: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Debug, Clone)]
pub struct ReserveRunArgs {
    pub expected_run_nonce: u64,
    pub session_nonce: u64,
    pub expected_inventory_version: u64,
    pub expected_rules_version: u32,
    pub expected_catalog_version: u32,
    pub cat: CatId,
    pub market: Market,
    pub stake_base_units: u64,
}

// Activation/delegation/completion/recovery identify the same immutable run.
// They cannot supply a result, change recipient, epoch or choose a refund reason.
#[derive(AnchorSerialize, AnchorDeserialize, Debug, Clone)]
pub struct RunIdentityArgs {
    pub nonce: u64,
    pub delegation_epoch: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Debug, Clone)]
pub struct SubmitIntentsArgs {
    // Handler validates 1..=MAX_INTENTS_PER_SUBMISSION before any queue mutation.
    pub intents: Vec<IntentEnvelope>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Debug, Clone)]
// Hydra reuses these bytes; progress/order come from verified execution context.
pub struct AdvanceRunArgs {
    pub delegation_epoch: u64,
    pub task_generation: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Debug, Clone)]
pub struct RequestCapsuleArgs {
    pub expected_draw_nonce: u64,
    pub expected_inventory_version: u64,
    pub expected_catalog_version: u32,
    pub kind: CapsuleKind,
    pub max_payer_debit_lamports: u64,
}

// Accepted only under the authenticated VRF callback; these bytes are not a
// permission for an ordinary user to fulfill a draw or pick their own outcome.
#[derive(AnchorSerialize, AnchorDeserialize, Debug, Clone)]
pub struct FulfillCapsuleArgs {
    pub randomness: [u8; 32],
    pub committed_seed_hash: [u8; 32],
}

#[derive(AnchorSerialize, AnchorDeserialize, Debug, Clone)]
pub struct SelectCatArgs {
    pub expected_inventory_version: u64,
    pub cat: CatId,
}

#[derive(AnchorSerialize, AnchorDeserialize, Debug, Clone)]
pub struct ApplyUpgradeArgs {
    pub expected_inventory_version: u64,
    pub expected_defining_catalog_version: u32,
    pub expected_cat_level: u8,
    pub cat: CatId,
    pub grade: Rarity,
}

#[derive(AnchorSerialize, AnchorDeserialize, Debug, Clone)]
pub struct FundSponsorshipArgs {
    pub operation: Pubkey,
    pub beneficiary: Pubkey,
    pub purpose: SponsorPurpose,
    pub limit_lamports: u64,
    pub reserved_completion_lamports: u64,
    pub max_attempts: u16,
    pub expires_at_seconds: i64,
}
