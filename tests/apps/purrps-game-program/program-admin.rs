use anchor_lang::{
    prelude::Pubkey,
    solana_program::{instruction::Instruction, system_program},
    AnchorDeserialize, InstructionData, ToAccountMetas,
};
use purrps_game::{
    catalog::CATALOG_V1,
    contracts::{Market, VersionBinding},
    instruction_args::{InitializeConfigArgs, PublishCatalogArgs, PublishRulesArgs},
    oracle::InspectedOracle,
    rules::{RULES_V1, RULES_V2, RULES_V3},
    state::{
        collection::{Collection, PlayerAccount, StarterClaim},
        config::{CatalogVersion, GameConfig, GameRulesVersion},
    },
};
use solana_keypair::Keypair;
use solana_signer::Signer;

#[path = "support/oracle-binding.rs"]
mod fixtures;
#[path = "support/harness.rs"]
mod support;
use support::Harness;

fn init_instruction(h: &Harness, admin: Pubkey) -> Instruction {
    Instruction::new_with_bytes(
        purrps_game::ID,
        &purrps_game::instruction::InitializeConfig {
            args: InitializeConfigArgs {
                oracle_bindings: [
                    fixtures::binding(Market::Btc),
                    fixtures::binding(Market::Eth),
                    fixtures::binding(Market::Sol),
                ],
            },
        }
        .data(),
        purrps_game::accounts::InitializeConfig {
            program: purrps_game::ID,
            program_data: h.program_data,
            admin,
            config: h.config,
            usdc_mint: purrps_game::USDC_MINT,
            token_program: anchor_spl::token::ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}

fn initialize(h: &mut Harness) {
    let admin = Keypair::try_from(h.admin.to_bytes().as_slice()).unwrap();
    let instruction = init_instruction(h, admin.pubkey());
    h.send(instruction, &admin).unwrap();
}

fn rules_instruction(
    h: &Harness,
    admin: Pubkey,
    version: u32,
    expected: u32,
) -> (Instruction, Pubkey) {
    let key = Pubkey::find_program_address(
        &[purrps_game::RULES_SEED, &version.to_le_bytes()],
        &purrps_game::ID,
    )
    .0;
    let mut rules = match version {
        3 => RULES_V3,
        2 => RULES_V2,
        _ => RULES_V1,
    };
    rules.rules_version = version;
    let instruction = Instruction::new_with_bytes(
        purrps_game::ID,
        &purrps_game::instruction::PublishRules {
            args: PublishRulesArgs {
                expected_current_version: expected,
                rules,
            },
        }
        .data(),
        purrps_game::accounts::PublishRules {
            config: h.config,
            admin,
            rules: key,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    (instruction, key)
}

#[test]
fn only_real_upgrade_authority_can_initialize_and_admission_stays_closed() {
    let mut h = Harness::new();
    let attacker = Keypair::new();
    h.svm.airdrop(&attacker.pubkey(), 100_000_000).unwrap();
    let instruction = init_instruction(&h, attacker.pubkey());
    let error = h.send(instruction, &attacker).unwrap_err();
    assert!(error
        .meta
        .logs
        .iter()
        .any(|line| line.contains("InvalidUpgradeAuthority")));
    assert!(h.svm.get_account(&h.config).is_none());
    initialize(&mut h);
    let config: GameConfig = h.read(h.config);
    assert_eq!(config.admin, h.admin.pubkey());
    assert_eq!(config.usdc_mint, purrps_game::USDC_MINT);
    assert_eq!(config.usdc_decimals, 6);
    assert!(config.rules.is_none() && config.catalog.is_none());
    assert!(!config.allow_starter && !config.allow_purchases && !config.allow_reservations);
    assert_eq!(
        config.vrf_callback_authority,
        ephemeral_rollups_sdk::vrf::consts::scoped_vrf_identity(&purrps_game::ID)
    );
    let admin = Keypair::try_from(h.admin.to_bytes().as_slice()).unwrap();
    let duplicate = init_instruction(&h, admin.pubkey());
    assert!(h.send(duplicate, &admin).is_err());
}

#[test]
fn configuration_rejects_a_mint_with_wrong_decimals_without_creating_state() {
    let mut h = Harness::new();
    let mut mint = h.svm.get_account(&purrps_game::USDC_MINT).unwrap();
    mint.data[44] = 9;
    h.svm.set_account(purrps_game::USDC_MINT, mint).unwrap();
    let admin = Keypair::try_from(h.admin.to_bytes().as_slice()).unwrap();
    let instruction = init_instruction(&h, admin.pubkey());
    let error = h.send(instruction, &admin).unwrap_err();
    assert!(error
        .meta
        .logs
        .iter()
        .any(|line| line.contains("InvalidMint")));
    assert!(h.svm.get_account(&h.config).is_none());
}

#[test]
fn publication_is_admin_only_atomic_versioned_and_retains_old_rules() {
    let mut h = Harness::new();
    initialize(&mut h);
    let admin = Keypair::try_from(h.admin.to_bytes().as_slice()).unwrap();
    let attacker = Keypair::new();
    h.svm.airdrop(&attacker.pubkey(), 100_000_000).unwrap();
    let (instruction, key) = rules_instruction(&h, attacker.pubkey(), 1, 0);
    assert!(h.send(instruction, &attacker).is_err());
    assert!(h.svm.get_account(&key).is_none());
    let (instruction, _) = rules_instruction(&h, admin.pubkey(), 1, 0);
    h.send(instruction.clone(), &admin).unwrap();
    let first: GameRulesVersion = h.read(key);
    assert_eq!(first.rules, RULES_V1);
    assert!(h.send(instruction, &admin).is_err());
    let (stale, second) = rules_instruction(&h, admin.pubkey(), 2, 0);
    assert!(h.send(stale, &admin).is_err());
    assert!(h.svm.get_account(&second).is_none());
    let (next, _) = rules_instruction(&h, admin.pubkey(), 2, 1);
    h.send(next, &admin).unwrap();
    let (third, third_key) = rules_instruction(&h, admin.pubkey(), 3, 2);
    h.send(third, &admin).unwrap();
    let config: GameConfig = h.read(h.config);
    assert_eq!(config.rules.unwrap().version, 3);
    assert_eq!(h.read::<GameRulesVersion>(third_key).rules, RULES_V3);
    assert_eq!(h.read::<GameRulesVersion>(second).rules, RULES_V2);
    let retained: GameRulesVersion = h.read(key);
    assert_eq!(retained.rules, first.rules);
    assert_eq!(retained.binding, first.binding);
    assert!(!config.allow_reservations);
}

#[test]
fn catalog_publication_binds_media_and_never_enables_capsules() {
    let mut h = Harness::new();
    initialize(&mut h);
    let admin = Keypair::try_from(h.admin.to_bytes().as_slice()).unwrap();
    let key = Pubkey::find_program_address(
        &[purrps_game::CATALOG_SEED, &1u32.to_le_bytes()],
        &purrps_game::ID,
    )
    .0;
    let config_key = h.config;
    let instruction = |manifest| {
        Instruction::new_with_bytes(
            purrps_game::ID,
            &purrps_game::instruction::PublishCatalog {
                args: PublishCatalogArgs {
                    expected_current_version: 0,
                    catalog: CATALOG_V1,
                    asset_manifest: manifest,
                },
            }
            .data(),
            purrps_game::accounts::PublishCatalog {
                config: config_key,
                admin: admin.pubkey(),
                catalog: key,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        )
    };
    assert!(h
        .send(
            instruction(VersionBinding {
                version: 1,
                content_hash: [0; 32]
            }),
            &admin
        )
        .is_err());
    let manifest = VersionBinding {
        version: 1,
        content_hash: [7; 32],
    };
    h.send(instruction(manifest), &admin).unwrap();
    let published: CatalogVersion = h.read(key);
    assert_eq!(published.catalog, CATALOG_V1);
    assert_eq!(published.asset_manifest, manifest);
    let config: GameConfig = h.read(h.config);
    assert_eq!(config.catalog, Some(published.binding));
    assert!(!config.allow_starter && !config.allow_purchases);
}

#[test]
fn player_creation_needs_owner_signature_and_grants_no_credit_or_inventory() {
    let mut h = Harness::new();
    initialize(&mut h);
    let owner = Keypair::new();
    h.svm.airdrop(&owner.pubkey(), 100_000_000).unwrap();
    let other = Keypair::new();
    h.svm.airdrop(&other.pubkey(), 100_000_000).unwrap();
    let player = Pubkey::find_program_address(
        &[purrps_game::PLAYER_SEED, owner.pubkey().as_ref()],
        &purrps_game::ID,
    )
    .0;
    let collection = Pubkey::find_program_address(
        &[purrps_game::COLLECTION_SEED, owner.pubkey().as_ref()],
        &purrps_game::ID,
    )
    .0;
    let accounts = purrps_game::accounts::CreatePlayer {
        config: h.config,
        owner: owner.pubkey(),
        payer: owner.pubkey(),
        player,
        collection,
        system_program: system_program::ID,
    }
    .to_account_metas(None);
    let valid = Instruction::new_with_bytes(
        purrps_game::ID,
        &purrps_game::instruction::CreatePlayer {}.data(),
        accounts,
    );
    let mut forged = valid.clone();
    for meta in &mut forged.accounts {
        if meta.pubkey == owner.pubkey() {
            meta.is_signer = false;
        }
    }
    assert!(h.send(forged, &other).is_err());
    assert!(h.svm.get_account(&player).is_none());
    h.send(valid.clone(), &owner).unwrap();
    let profile: PlayerAccount = h.read(player);
    let inventory: Collection = h.read(collection);
    assert_eq!(profile.owner, owner.pubkey());
    assert_eq!(
        (
            profile.available_base_units,
            profile.locked_stake_base_units,
            profile.purchase_escrow_base_units
        ),
        (0, 0, 0)
    );
    assert_eq!(
        (
            profile.next_run_nonce,
            profile.next_draw_nonce,
            profile.next_session_nonce
        ),
        (0, 0, 0)
    );
    assert_eq!(inventory.owner, owner.pubkey());
    assert_eq!(inventory.owned_mask, 0);
    assert!(inventory.cats.iter().all(Option::is_none));
    assert!(inventory.selected_cat.is_none() && inventory.pending_draw.is_none());
    assert_eq!(inventory.upgrade_quantities, [0; 3]);
    assert!(inventory.starter == StarterClaim::Unclaimed);
    assert!(h.send(valid, &owner).is_err());
}

#[test]
fn oracle_inspection_returns_real_decoded_fields_without_progress_or_rewards() {
    let mut h = Harness::new();
    initialize(&mut h);
    let admin = Keypair::try_from(h.admin.to_bytes().as_slice()).unwrap();
    let binding = fixtures::binding(Market::Btc);
    let hex = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../../tests/fixtures/providers/oracle-v3-full.hex"
    ))
    .trim();
    let mut account = h.svm.get_account(&admin.pubkey()).unwrap();
    account.owner = binding.program;
    account.data = hex
        .as_bytes()
        .chunks_exact(2)
        .map(|pair| u8::from_str_radix(std::str::from_utf8(pair).unwrap(), 16).unwrap())
        .collect();
    h.svm.set_account(binding.account, account).unwrap();
    let instruction = Instruction::new_with_bytes(
        purrps_game::ID,
        &purrps_game::instruction::InspectOracle {
            market: Market::Btc,
        }
        .data(),
        purrps_game::accounts::InspectOracle {
            config: h.config,
            price_update: binding.account,
        }
        .to_account_metas(None),
    );
    let before = h.svm.get_account(&h.config).unwrap().data;
    let result = h.send(instruction, &admin).unwrap();
    let inspected = InspectedOracle::try_from_slice(&result.return_data.data).unwrap();
    assert_eq!(inspected.quote.price, 9_007_199_254_740_993);
    assert_eq!(inspected.quote.exponent, -8);
    assert_eq!(h.svm.get_account(&h.config).unwrap().data, before);
}

#[test]
fn initialize_and_inspect_accept_captured_hosted_feeds_and_enforce_zero_writer_pin() {
    let mut h = Harness::new();
    let admin = Keypair::try_from(h.admin.to_bytes().as_slice()).unwrap();
    let bindings = [Market::Btc, Market::Eth, Market::Sol].map(fixtures::hosted_binding);
    let mut instruction = init_instruction(&h, admin.pubkey());
    instruction.data = purrps_game::instruction::InitializeConfig {
        args: InitializeConfigArgs {
            oracle_bindings: bindings,
        },
    }
    .data();
    h.send(instruction, &admin).unwrap();
    let config: GameConfig = h.read(h.config);
    assert_eq!(config.oracle_bindings, bindings);
    assert!(!config.allow_starter && !config.allow_purchases && !config.allow_reservations);
    let (clock, accounts) = fixtures::hosted_oracles();
    h.svm.set_sysvar(&clock);
    let before = h.svm.get_account(&h.config).unwrap().data;
    for ((market, binding), bytes) in [Market::Btc, Market::Eth, Market::Sol]
        .into_iter()
        .zip(bindings)
        .zip(accounts)
    {
        let mut account = h.svm.get_account(&admin.pubkey()).unwrap();
        account.owner = binding.program;
        account.data = bytes;
        h.svm.set_account(binding.account, account.clone()).unwrap();
        let instruction = Instruction::new_with_bytes(
            purrps_game::ID,
            &purrps_game::instruction::InspectOracle { market }.data(),
            purrps_game::accounts::InspectOracle {
                config: h.config,
                price_update: binding.account,
            }
            .to_account_metas(None),
        );
        let result = h.send(instruction.clone(), &admin).unwrap();
        let inspected = InspectedOracle::try_from_slice(&result.return_data.data).unwrap();
        assert_eq!(inspected.market, market);
        assert_eq!(inspected.quote.write_authority, Pubkey::default());
        assert_eq!(inspected.quote.exponent, 8);
        account.data[8] = 1;
        h.svm.set_account(binding.account, account).unwrap();
        let error = h.send(instruction, &admin).unwrap_err();
        assert!(error
            .meta
            .logs
            .iter()
            .any(|line| line.contains("InvalidOracleData")));
        assert_eq!(h.svm.get_account(&h.config).unwrap().data, before);
    }
}
