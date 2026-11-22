use anchor_lang::{prelude::Pubkey, AnchorSerialize};
use purrps_game::{
    catalog::CATALOG_V1,
    contracts::{Market, VersionBinding},
    oracle::{decode_quote, inspect_account},
    publication::{
        catalog_binding, rules_binding, validate_catalog, validate_oracle_binding, validate_rules,
    },
    rules::{RULES_V1, RULES_V2},
};

#[path = "support/oracle-binding.rs"]
mod fixtures;

fn oracle_bytes() -> Vec<u8> {
    let hex = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../../tests/fixtures/providers/oracle-v3-full.hex"
    ))
    .trim();
    hex.as_bytes()
        .chunks_exact(2)
        .map(|pair| u8::from_str_radix(std::str::from_utf8(pair).unwrap(), 16).unwrap())
        .collect()
}

#[test]
fn publication_preserves_reviewed_values_and_advances_versions_exactly_once() {
    assert!(validate_rules(&RULES_V1, 0, 0).is_ok());
    assert!(validate_rules(&RULES_V1, 1, 0).is_err());
    let mut next = RULES_V2;
    assert!(validate_rules(&next, 1, 1).is_ok());
    next.max_multiplier_bps = 110_000;
    assert!(validate_rules(&next, 1, 1).is_err());
    let mut rules = RULES_V1;
    rules.score.coin_points = 2;
    assert!(validate_rules(&rules, 0, 0).is_err());
    assert!(validate_rules(&RULES_V1, u32::MAX, u32::MAX).is_err());
    let manifest = VersionBinding {
        version: 1,
        content_hash: [7; 32],
    };
    assert!(validate_catalog(&CATALOG_V1, &manifest, 0, 0).is_ok());
    let mut changed = CATALOG_V1;
    changed.cats[0].weight = 5_000;
    assert!(validate_catalog(&changed, &manifest, 0, 0).is_err());
    changed = CATALOG_V1;
    changed.cat_price_base_units = 3_000_000;
    assert!(validate_catalog(&changed, &manifest, 0, 0).is_err());
    assert!(validate_catalog(
        &CATALOG_V1,
        &VersionBinding {
            version: 1,
            content_hash: [0; 32]
        },
        0,
        0
    )
    .is_err());
    assert!(validate_catalog(
        &CATALOG_V1,
        &VersionBinding {
            version: 0,
            content_hash: [7; 32]
        },
        0,
        0
    )
    .is_err());
}

#[test]
fn canonical_publication_bytes_and_domain_hashes_match_independent_fixtures() {
    let rows = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../../tests/fixtures/game-v1/bindings.csv"
    ));
    let rule_hex = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../../tests/fixtures/game-v1/rules.hex"
    ))
    .trim();
    let mut bytes = Vec::new();
    RULES_V1.serialize(&mut bytes).unwrap();
    let hex: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
    assert_eq!(hex, rule_hex);
    let manifest = VersionBinding {
        version: 1,
        content_hash: [7; 32],
    };
    let hashes = [
        rules_binding(&RULES_V1).unwrap().content_hash,
        catalog_binding(&CATALOG_V1, &manifest)
            .unwrap()
            .content_hash,
    ];
    for (row, hash) in rows.lines().skip(1).zip(hashes) {
        let expected = row.split(',').nth(1).unwrap();
        let hex: String = hash.iter().map(|byte| format!("{byte:02x}")).collect();
        assert_eq!(hex, expected);
    }
    let mut other_manifest = manifest;
    other_manifest.content_hash[0] = 8;
    assert_ne!(
        catalog_binding(&CATALOG_V1, &manifest).unwrap(),
        catalog_binding(&CATALOG_V1, &other_manifest).unwrap()
    );
    let mut next = RULES_V1;
    next.rules_version = 2;
    assert_ne!(
        rules_binding(&RULES_V1).unwrap(),
        rules_binding(&next).unwrap()
    );
}

#[test]
fn oracle_reads_validate_identity_full_precision_padding_and_chain_clock() {
    let bytes = oracle_bytes();
    let binding = fixtures::binding(Market::Btc);
    let inspect = |data: &[u8], now| {
        inspect_account(
            &binding.account,
            &binding.program,
            data,
            &binding,
            Market::Btc,
            now,
            123_456_790,
        )
    };
    let result = inspect(&bytes, 1_700_000_002).unwrap();
    assert_eq!(result.quote.price, 9_007_199_254_740_993);
    assert_eq!(result.quote.exponent, -8);
    assert_eq!(result.quote.ema_price, 9_007_199_254_740_999);
    let confidence_cap = result.quote.price as u64 / 50;
    let mut uncertain = bytes.clone();
    uncertain[81..89].copy_from_slice(&confidence_cap.to_le_bytes());
    assert!(inspect(&uncertain, 1_700_000_002).is_ok());
    uncertain[81..89].copy_from_slice(&(confidence_cap + 1).to_le_bytes());
    assert!(inspect(&uncertain, 1_700_000_002).is_err());
    assert!(inspect(&bytes, 1_700_000_003).is_err());
    assert!(inspect(&bytes, 1_699_999_999).is_err());
    assert!(inspect_account(
        &binding.account,
        &Pubkey::default(),
        &bytes,
        &binding,
        Market::Btc,
        1_700_000_002,
        123_456_790
    )
    .is_err());
    assert!(inspect_account(
        &Pubkey::default(),
        &binding.program,
        &bytes,
        &binding,
        Market::Btc,
        1_700_000_002,
        123_456_790
    )
    .is_err());
    assert!(inspect_account(
        &binding.account,
        &binding.program,
        &bytes,
        &binding,
        Market::Eth,
        1_700_000_002,
        123_456_790
    )
    .is_err());
    for data in [&[][..], &bytes[..132]] {
        assert!(decode_quote(data).is_err());
    }
    let mut corrupt = bytes.clone();
    corrupt[40] = 0;
    assert!(decode_quote(&corrupt).is_err());
    corrupt = bytes.clone();
    corrupt[0] ^= 1;
    assert!(decode_quote(&corrupt).is_err());
    corrupt = bytes.clone();
    corrupt[8] ^= 1;
    assert!(inspect(&corrupt, 1_700_000_002).is_err());
    let mut padded = bytes.clone();
    padded.resize(152, 0);
    assert_eq!(inspect(&padded, 1_700_000_002).unwrap(), result);
    padded[151] = 1;
    assert!(inspect(&padded, 1_700_000_002).is_err());
    let expected_hash = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../../tests/fixtures/providers/oracle-v3-full.sha256"
    ))
    .trim();
    let hex: String = result
        .content_hash
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    assert_eq!(hex, expected_hash);
}

#[test]
fn bindings_require_exact_markets_schemas_and_nonzero_validator() {
    let original = fixtures::binding(Market::Btc);
    assert!(validate_oracle_binding(&original, Market::Btc).is_ok());
    let mut value = original;
    value.feed_id = 2;
    assert!(validate_oracle_binding(&value, Market::Btc).is_err());
    value = original;
    value.schema_version = 2;
    assert!(validate_oracle_binding(&value, Market::Btc).is_err());
    value = original;
    value.validator = Pubkey::default();
    assert!(validate_oracle_binding(&value, Market::Btc).is_err());
    value = original;
    value.max_age_seconds = 0;
    assert!(validate_oracle_binding(&value, Market::Btc).is_err());
    value = original;
    value.min_exponent = 1;
    assert!(validate_oracle_binding(&value, Market::Btc).is_err());
}

#[test]
fn captured_hosted_feeds_accept_zero_writer_without_bypassing_identity_or_policy() {
    let (clock, accounts) = fixtures::hosted_oracles();
    for (market, bytes) in [Market::Btc, Market::Eth, Market::Sol]
        .into_iter()
        .zip(accounts)
    {
        let binding = fixtures::hosted_binding(market);
        let inspect = |key: &Pubkey, owner: &Pubkey, data: &[u8], now| {
            inspect_account(key, owner, data, &binding, market, now, clock.slot)
        };
        let result = inspect(
            &binding.account,
            &binding.program,
            &bytes,
            clock.unix_timestamp,
        )
        .unwrap();
        assert_eq!(result.quote.write_authority, Pubkey::default());
        assert_eq!(result.quote.exponent, 8);
        assert!(inspect(
            &Pubkey::default(),
            &binding.program,
            &bytes,
            clock.unix_timestamp
        )
        .is_err());
        assert!(inspect(
            &binding.account,
            &Pubkey::default(),
            &bytes,
            clock.unix_timestamp
        )
        .is_err());
        assert!(inspect(
            &binding.account,
            &binding.program,
            &bytes,
            clock.unix_timestamp + 3
        )
        .is_err());
        let mut forged = bytes.clone();
        forged[8] = 1;
        assert!(inspect(
            &binding.account,
            &binding.program,
            &forged,
            clock.unix_timestamp
        )
        .is_err());
        forged = bytes.clone();
        forged[40] = 0;
        assert!(inspect(
            &binding.account,
            &binding.program,
            &forged,
            clock.unix_timestamp
        )
        .is_err());
        forged = bytes.clone();
        forged[89..93].copy_from_slice(&(-8_i32).to_le_bytes());
        assert!(inspect(
            &binding.account,
            &binding.program,
            &forged,
            clock.unix_timestamp
        )
        .is_err());
    }
}
