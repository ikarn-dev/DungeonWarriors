use crate::rules::{
    earned_multiplier_bps, earned_multiplier_for_rules, ContractError, GameRules, RULES_V1,
};

pub const USDC_DECIMALS: u8 = 6;

pub fn max_gross_reservation(stake_base_units: u64) -> Result<u64, ContractError> {
    if stake_base_units == 0 {
        return Err(ContractError::InvalidAmount);
    }
    let gross = u128::from(stake_base_units) * u128::from(RULES_V1.max_multiplier_bps) / 10_000;
    u64::try_from(gross).map_err(|_| ContractError::NumericOverflow)
}

pub fn gross_payout(
    stake_base_units: u64,
    qualified_checkpoints: u64,
) -> Result<u64, ContractError> {
    max_gross_reservation(stake_base_units)?;
    if qualified_checkpoints == 0 {
        return Err(ContractError::Unqualified);
    }
    let gross = u128::from(stake_base_units)
        * u128::from(earned_multiplier_bps(qualified_checkpoints))
        / 10_000;
    u64::try_from(gross).map_err(|_| ContractError::NumericOverflow)
}

pub fn capped_gross_payout(
    stake: u64,
    checkpoints: u64,
    cap: u64,
    rules: &GameRules,
) -> Result<u64, ContractError> {
    if checkpoints == 0 {
        return Err(ContractError::Unqualified);
    }
    let gross =
        u128::from(stake) * u128::from(earned_multiplier_for_rules(rules, checkpoints)) / 10_000;
    Ok(gross.min(u128::from(cap)) as u64)
}

pub fn valid_gross_cap(stake: u64, cap: u64, max_multiplier_bps: u32) -> bool {
    (stake == 0 && cap == 0)
        || (stake > 0
            && cap > stake
            && u128::from(cap) <= u128::from(stake) * u128::from(max_multiplier_bps) / 10_000)
}

// Run reservations already include locked stakes; adding them again double counts.
pub fn required_vault_balance(
    available_credits: u64,
    purchase_escrows: u64,
    max_gross_reservations: u64,
    house_buffer: u64,
) -> Result<u64, ContractError> {
    available_credits
        .checked_add(purchase_escrows)
        .and_then(|sum| sum.checked_add(max_gross_reservations))
        .and_then(|sum| sum.checked_add(house_buffer))
        .ok_or(ContractError::NumericOverflow)
}
