use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Only the counter authority can update this counter")]
    Unauthorized,
    #[msg("Counter has reached the maximum value")]
    CounterOverflow,
    #[msg("Only the program upgrade authority can initialize configuration")]
    InvalidUpgradeAuthority,
    #[msg("Only the configured admin can publish versions")]
    InvalidAdmin,
    #[msg("Unsupported configuration schema")]
    InvalidConfiguration,
    #[msg("Only official six-decimal Devnet USDC is supported")]
    InvalidMint,
    #[msg("Oracle identity, schema or numeric policy does not match the market")]
    InvalidOracleBinding,
    #[msg("Oracle account data is malformed or does not match its binding")]
    InvalidOracleData,
    #[msg("Oracle observation is stale")]
    StaleOracle,
    #[msg("Published rules must preserve the reviewed numeric contract")]
    InvalidRules,
    #[msg("Published catalog must preserve the approved product values")]
    InvalidCatalog,
    #[msg("Publication version is stale or does not advance exactly once")]
    StaleVersion,
    #[msg("A nonzero version and content hash are required for media")]
    InvalidManifest,
    #[msg("Integer range exceeded")]
    ArithmeticOverflow,
    #[msg("A positive token amount is required")]
    InvalidAmount,
    #[msg("Token owner or player identity is invalid")]
    InvalidOwner,
    #[msg("The custody vault is invalid or has an external delegate/close authority")]
    InvalidVault,
    #[msg("Insufficient settled available credit")]
    InsufficientCredit,
    #[msg("The vault does not cover all obligations and the required buffer")]
    InsolventHouse,
    #[msg("Run identity or frozen snapshot is invalid")]
    InvalidRun,
}
