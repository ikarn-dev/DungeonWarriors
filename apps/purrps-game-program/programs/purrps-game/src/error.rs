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
    #[msg("This operation is paused or its implementation is not admitted")]
    AdmissionClosed,
    #[msg("Inventory, draw identity or version is stale")]
    InvalidInventory,
    #[msg("The starter draw is already pending or fulfilled")]
    StarterAlreadyClaimed,
    #[msg("The callback does not match the frozen pending request")]
    InvalidCallback,
    #[msg("Invalid or exhausted session authorization")]
    InvalidSession,
    #[msg("Invalid or insufficient purpose-bound sponsor funding")]
    InvalidSponsorBudget,
    #[msg("Only expired, unplayed reservations that were never delegated can be refunded here")]
    ReservationNotRefundable,
    #[msg("The paid draw's fulfillment deadline has passed")]
    DrawExpired,
    #[msg("A paid draw can only be refunded at or after its deadline")]
    DrawNotExpired,
    #[msg("Run input is invalid, expired, out of sequence, or exceeds the remaining queue")]
    InvalidRunInput,
    #[msg("Run control update limit reached for this chain-clock second")]
    ControlRateExceeded,
    #[msg("Run world cannot safely advance")]
    InvalidRunWorld,
    #[msg("Completion did not come from the pinned validator and run balance")]
    InvalidCompletionAction,
    #[msg("Only the registered Hydra trigger may advance this run")]
    InvalidCrank,
    #[msg("Finish the existing run before reserving another")]
    UnsettledRun,
}
