use anchor_lang::prelude::*;

use crate::{
    catalog::Catalog,
    contracts::{OracleBinding, VersionBinding},
    rules::GameRules,
};

// Base-only PDA [GAME_CONFIG_SEED]. Admin signatures govern publication and
// admission. Initialization validates Devnet, Circle mint and token program.
#[account]
#[derive(InitSpace)]
pub struct GameConfig {
    pub schema_version: u16,
    pub bump: u8,
    pub admin: Pubkey,
    pub usdc_mint: Pubkey,
    pub token_program: Pubkey,
    pub usdc_decimals: u8,
    pub rules: VersionBinding,
    pub catalog: VersionBinding,
    pub oracle_bindings: [OracleBinding; 3],
    pub vrf_program: Pubkey,
    pub vrf_queue: Pubkey,
    pub vrf_callback_authority: Pubkey,
    pub allow_starter: bool,
    pub allow_purchases: bool,
    pub allow_reservations: bool,
}

// Base-only [RULES_SEED, version.to_le_bytes()]. init, never init_if_needed,
// realloc or mutation; hash/version validated and retained after publication.
#[account]
#[derive(InitSpace)]
pub struct GameRulesVersion {
    pub schema_version: u16,
    pub bump: u8,
    pub binding: VersionBinding,
    pub rules: GameRules,
}

// Same publication invariant; [CATALOG_SEED, version.to_le_bytes()]. The asset
// hash binds a retained bundled manifest, not a URL that can change its content.
#[account]
#[derive(InitSpace)]
pub struct CatalogVersion {
    pub schema_version: u16,
    pub bump: u8,
    pub binding: VersionBinding,
    pub catalog: Catalog,
    pub asset_manifest: VersionBinding,
}
