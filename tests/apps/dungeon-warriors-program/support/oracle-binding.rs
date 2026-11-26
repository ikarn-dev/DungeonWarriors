use anchor_lang::prelude::{Clock, Pubkey};
use dungeon_warriors::{
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

pub fn hosted_binding(market: Market) -> OracleBinding {
    OracleBinding {
        write_authority: Pubkey::default(),
        max_future_skew_seconds: 1,
        min_exponent: 8,
        max_exponent: 8,
        ..binding(market)
    }
}

pub fn hosted_oracles() -> (Clock, [Vec<u8>; 3]) {
    let mut fields = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../../tests/fixtures/providers/oracle-v3-devnet-as.csv"
    ))
    .lines()
    .nth(1)
    .unwrap()
    .split(',');
    let clock = Clock {
        slot: fields.next().unwrap().parse().unwrap(),
        unix_timestamp: fields.next().unwrap().parse().unwrap(),
        ..Clock::default()
    };
    let accounts = std::array::from_fn(|_| {
        fields
            .next()
            .unwrap()
            .as_bytes()
            .chunks_exact(2)
            .map(|pair| u8::from_str_radix(std::str::from_utf8(pair).unwrap(), 16).unwrap())
            .collect()
    });
    assert!(fields.next().is_none());
    (clock, accounts)
}
