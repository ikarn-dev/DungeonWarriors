use anchor_lang::prelude::Pubkey;
use purrps_game::{
    constants::HOSTED_ORACLE_PROGRAM,
    contracts::{Market, OracleBinding},
};

pub fn binding(market: Market) -> OracleBinding {
    let symbol = market.feed_id().to_string();
    OracleBinding {
        program: HOSTED_ORACLE_PROGRAM,
        account: Pubkey::find_program_address(
            &[b"price_feed", b"pyth-lazer", symbol.as_bytes()],
            &HOSTED_ORACLE_PROGRAM,
        )
        .0,
        write_authority: Pubkey::new_from_array([42; 32]),
        validator: Pubkey::new_from_array([43; 32]),
        feed_id: market.feed_id(),
        schema_version: 3,
        max_age_seconds: 2,
        max_future_skew_seconds: 0,
        min_exponent: -18,
        max_exponent: 0,
    }
}
