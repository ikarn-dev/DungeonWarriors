use anchor_lang::prelude::*;
use solana_sha256_hasher::hashv;

use crate::{
    catalog::{Catalog, CATALOG_V1},
    constants::*,
    contracts::{Market, OracleBinding, VersionBinding},
    error::ErrorCode,
    rules::{GameRules, RULES_V1, RULES_V2, RULES_V3, RULES_V4},
};

pub fn validate_oracle_binding(binding: &OracleBinding, market: Market) -> Result<()> {
    require_keys_eq!(
        binding.program,
        HOSTED_ORACLE_PROGRAM,
        ErrorCode::InvalidOracleBinding
    );
    let symbol = market.feed_id().to_string();
    let expected = Pubkey::find_program_address(
        &[b"price_feed", b"pyth-lazer", symbol.as_bytes()],
        &HOSTED_ORACLE_PROGRAM,
    )
    .0;
    require_keys_eq!(binding.account, expected, ErrorCode::InvalidOracleBinding);
    // Hosted feeds can have a zero writer; inspection still pins the owner, PDA and exact header value.
    require!(
        binding.feed_id == market.feed_id()
            && binding.schema_version == 3
            && binding.max_age_seconds > 0
            && binding.min_exponent >= -18
            && binding.max_exponent <= 18
            && binding.min_exponent <= binding.max_exponent
            && binding.validator != Pubkey::default(),
        ErrorCode::InvalidOracleBinding
    );
    Ok(())
}

pub fn validate_rules(
    rules: &GameRules,
    current_version: u32,
    expected_version: u32,
) -> Result<()> {
    let next = current_version
        .checked_add(1)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    require!(
        expected_version == current_version && rules.rules_version == next,
        ErrorCode::StaleVersion
    );
    let canonical = match next {
        1 => RULES_V1,
        2 => RULES_V2,
        3 => RULES_V3,
        4 => RULES_V4,
        _ => return err!(ErrorCode::InvalidRules),
    };
    require!(*rules == canonical, ErrorCode::InvalidRules);
    Ok(())
}

pub fn validate_catalog(
    catalog: &Catalog,
    manifest: &VersionBinding,
    current_version: u32,
    expected_version: u32,
) -> Result<()> {
    let next = current_version
        .checked_add(1)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    require!(
        expected_version == current_version && catalog.catalog_version == next,
        ErrorCode::StaleVersion
    );
    let mut canonical = CATALOG_V1;
    canonical.catalog_version = next;
    require!(*catalog == canonical, ErrorCode::InvalidCatalog);
    require!(
        manifest.version > 0 && manifest.content_hash != [0; 32],
        ErrorCode::InvalidManifest
    );
    Ok(())
}

pub fn rules_binding(rules: &GameRules) -> Result<VersionBinding> {
    let mut bytes = Vec::with_capacity(GameRules::INIT_SPACE);
    rules
        .serialize(&mut bytes)
        .map_err(|_| error!(ErrorCode::InvalidRules))?;
    Ok(VersionBinding {
        version: rules.rules_version,
        content_hash: hashv(&[b"purrps:rules:v1", crate::ID.as_ref(), &bytes]).to_bytes(),
    })
}

pub fn catalog_binding(catalog: &Catalog, manifest: &VersionBinding) -> Result<VersionBinding> {
    let mut bytes = Vec::with_capacity(Catalog::INIT_SPACE + VersionBinding::INIT_SPACE);
    catalog
        .serialize(&mut bytes)
        .map_err(|_| error!(ErrorCode::InvalidCatalog))?;
    manifest
        .serialize(&mut bytes)
        .map_err(|_| error!(ErrorCode::InvalidManifest))?;
    Ok(VersionBinding {
        version: catalog.catalog_version,
        content_hash: hashv(&[b"purrps:catalog:v1", crate::ID.as_ref(), &bytes]).to_bytes(),
    })
}
