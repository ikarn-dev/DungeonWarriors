use anchor_lang::prelude::*;
use solana_sha256_hasher::hash;

use crate::{
    contracts::{Market, OracleBinding},
    error::ErrorCode,
    publication::validate_oracle_binding,
};

const DISCRIMINATOR: [u8; 8] = [234, 161, 14, 36, 172, 239, 15, 232];

#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Debug, Clone, Copy, PartialEq, Eq)]
pub struct HostedOracleQuote {
    pub write_authority: Pubkey,
    pub verification_level: u8,
    pub feed_id: [u8; 32],
    pub price: i64,
    pub confidence: u64,
    pub exponent: i32,
    pub published_at_seconds: i64,
    pub previous_published_at_seconds: i64,
    pub ema_price: i64,
    pub ema_confidence: u64,
    pub posted_slot: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Debug, Clone, Copy, PartialEq, Eq)]
pub struct InspectedOracle {
    pub market: Market,
    pub quote: HostedOracleQuote,
    pub content_hash: [u8; 32],
}

pub fn decode_quote(data: &[u8]) -> Result<HostedOracleQuote> {
    require!(
        (133..=256).contains(&data.len())
            && data[..8] == DISCRIMINATOR
            && data[40] == 1
            && data[133..].iter().all(|byte| *byte == 0),
        ErrorCode::InvalidOracleData
    );
    HostedOracleQuote::try_from_slice(&data[8..133])
        .map_err(|_| error!(ErrorCode::InvalidOracleData))
}

pub fn validate_quote(
    quote: &HostedOracleQuote,
    binding: &OracleBinding,
    now_seconds: i64,
    current_slot: u64,
) -> Result<()> {
    require_keys_eq!(
        quote.write_authority,
        binding.write_authority,
        ErrorCode::InvalidOracleData
    );
    require!(
        quote.verification_level == 1
            && quote.price > 0
            && quote.posted_slot > 0
            && quote.posted_slot <= current_slot
            && quote.published_at_seconds >= 0
            && now_seconds >= 0
            && quote.previous_published_at_seconds <= quote.published_at_seconds
            && quote.exponent >= binding.min_exponent
            && quote.exponent <= binding.max_exponent,
        ErrorCode::InvalidOracleData
    );
    let future_limit = now_seconds
        .checked_add(i64::from(binding.max_future_skew_seconds))
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    require!(
        quote.published_at_seconds <= future_limit,
        ErrorCode::InvalidOracleData
    );
    let oldest = now_seconds
        .checked_sub(i64::from(binding.max_age_seconds))
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    require!(quote.published_at_seconds >= oldest, ErrorCode::StaleOracle);
    Ok(())
}

pub fn inspect_account(
    key: &Pubkey,
    owner: &Pubkey,
    data: &[u8],
    binding: &OracleBinding,
    market: Market,
    now_seconds: i64,
    current_slot: u64,
) -> Result<InspectedOracle> {
    validate_oracle_binding(binding, market)?;
    require_keys_eq!(*key, binding.account, ErrorCode::InvalidOracleData);
    require_keys_eq!(*owner, binding.program, ErrorCode::InvalidOracleData);
    let quote = decode_quote(data)?;
    validate_quote(&quote, binding, now_seconds, current_slot)?;
    Ok(InspectedOracle {
        market,
        quote,
        content_hash: hash(&data[..133]).to_bytes(),
    })
}
