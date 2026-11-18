use anchor_lang::{
    prelude::*, solana_program::instruction::Instruction, InstructionData, ToAccountMetas,
};
use purrps_game::{
    catalog::CatId,
    draw::{eligible_weights, grant_starter, weighted_cat},
    instruction_args::{RequestCapsuleArgs, SelectCatArgs, SetAdmissionArgs},
    state::{
        collection::{Collection, PlayerAccount, StarterClaim},
        config::{CatalogVersion, GameConfig},
        draws::{CapsuleDraw, CapsuleKind, DrawResult, DrawStatus},
    },
};
use solana_keypair::Keypair;
use solana_signer::Signer;
use std::fmt::Write;
#[path = "support/game-setup.rs"]
mod setup;
#[path = "support/harness.rs"]
mod support;
use support::Harness;
fn fixture() -> (Harness, Keypair, Pubkey, Pubkey, Pubkey, CapsuleDraw) {
    let mut h = Harness::new();
    setup::initialize(&mut h);
    let (_, catalog) = setup::publish(&mut h);
    let owner = Keypair::new();
    let (player, collection) = setup::create(&mut h, &owner);
    let (draw, bump) = Pubkey::find_program_address(
        &[
            purrps_game::DRAW_SEED,
            owner.pubkey().as_ref(),
            &0u64.to_le_bytes(),
        ],
        &purrps_game::ID,
    );
    let published: CatalogVersion = h.read(catalog);
    let d = CapsuleDraw {
        schema_version: 1,
        bump,
        owner: owner.pubkey(),
        nonce: 0,
        kind: CapsuleKind::StarterCat,
        status: DrawStatus::Pending,
        catalog: published.binding,
        inventory_version: 0,
        eligible_mask: 15,
        weights: [3500, 3500, 2500, 500],
        total_weight: 10000,
        price_base_units: 0,
        vrf_program: ephemeral_rollups_sdk::vrf::consts::VRF_PROGRAM_ID,
        vrf_queue: ephemeral_rollups_sdk::vrf::consts::DEFAULT_QUEUE,
        callback_authority: ephemeral_rollups_sdk::vrf::consts::scoped_vrf_identity(
            &purrps_game::ID,
        ),
        committed_seed_hash: [8; 32],
        requested_at_seconds: 1700000002,
        paid_deadline_seconds: None,
        result: None,
        completed_at_seconds: None,
    };
    (h, owner, player, collection, catalog, d)
}
fn pending(h: &Harness, collection: Pubkey, key: Pubkey) -> Collection {
    let mut c: Collection = h.read(collection);
    c.starter = StarterClaim::Pending;
    c.pending_draw = Some(key);
    c
}

#[test]
fn authenticated_grant_logic_is_deterministic_conditional_and_exclusive() {
    let (h, owner, _, collection, catalog, mut d) = fixture();
    let key = Pubkey::find_program_address(
        &[
            purrps_game::DRAW_SEED,
            owner.pubkey().as_ref(),
            &0u64.to_le_bytes(),
        ],
        &purrps_game::ID,
    )
    .0;
    let mut c = pending(&h, collection, key);
    let published: CatalogVersion = h.read(catalog);
    let expected = weighted_cat([9; 32], [8; 32], d.weights, d.total_weight).unwrap();
    grant_starter(
        key, &mut d, &mut c, &published, [9; 32], [8; 32], 1700000010,
    )
    .unwrap();
    assert_eq!(d.result, Some(DrawResult::Cat(expected)));
    assert_eq!(c.cats.iter().filter(|value| value.is_some()).count(), 1);
    assert_eq!(c.selected_cat, Some(expected));
    assert_eq!(c.inventory_version, 1);
    assert_eq!(c.starter, StarterClaim::Fulfilled);
    assert!(c.pending_draw.is_none());
    assert_eq!(c.cats[expected as usize].unwrap().level, 1);
    assert!(grant_starter(key, &mut d, &mut c, &published, [9; 32], [8; 32], 1700000011).is_err());
    assert_eq!(c.inventory_version, 1);
}
#[test]
fn locked_pool_seed_and_inventory_versions_cannot_be_changed() {
    let (h, owner, _, collection, catalog, mut d) = fixture();
    let key = Pubkey::find_program_address(
        &[
            purrps_game::DRAW_SEED,
            owner.pubkey().as_ref(),
            &0u64.to_le_bytes(),
        ],
        &purrps_game::ID,
    )
    .0;
    let mut c = pending(&h, collection, key);
    let published: CatalogVersion = h.read(catalog);
    assert!(grant_starter(key, &mut d, &mut c, &published, [9; 32], [7; 32], 1700000010).is_err());
    c.inventory_version = 1;
    assert!(grant_starter(key, &mut d, &mut c, &published, [9; 32], [8; 32], 1700000010).is_err());
    c.inventory_version = 0;
    d.weights[0] = 9999;
    assert!(grant_starter(key, &mut d, &mut c, &published, [9; 32], [8; 32], 1700000010).is_err());
    assert_eq!(c.owned_mask, 0);
}
#[test]
fn frozen_weights_exclude_owned_cats_and_support_all_four_outcomes() {
    let (_, _, _, _, _, d) = fixture();
    let mut seen = [0u32; 4];
    for value in 0u64..2000 {
        let mut random = [0; 32];
        random[..8].copy_from_slice(&value.to_le_bytes());
        seen[weighted_cat(random, [8; 32], d.weights, d.total_weight).unwrap() as usize] += 1;
    }
    assert!(seen.iter().all(|count| *count > 0));
    let catalog = purrps_game::catalog::CATALOG_V1;
    let (weights, total) = eligible_weights(&catalog, 1).unwrap();
    assert_eq!(weights, [0, 3500, 2500, 500]);
    assert_eq!(total, 6500);
    for value in 0u8..100 {
        assert_ne!(
            weighted_cat([value; 32], [8; 32], weights, total).unwrap(),
            CatId::Collector
        );
    }
    assert!(eligible_weights(&catalog, 15).is_err());
    assert!(weighted_cat([0; 32], [0; 32], [1; 4], 3).is_err());
}
#[test]
fn forged_callback_and_unowned_selection_fail_in_sbf() {
    let (mut h, owner, _, collection, catalog, d) = fixture();
    let key = Pubkey::find_program_address(
        &[
            purrps_game::DRAW_SEED,
            owner.pubkey().as_ref(),
            &0u64.to_le_bytes(),
        ],
        &purrps_game::ID,
    )
    .0;
    setup::put(&mut h, key, &d);
    let c = pending(&h, collection, key);
    setup::put(&mut h, collection, &c);
    let ix = Instruction::new_with_bytes(
        purrps_game::ID,
        &purrps_game::instruction::FulfillStarter {
            randomness: [9; 32],
            seed: [8; 32],
        }
        .data(),
        purrps_game::accounts::FulfillStarter {
            vrf_program_identity: owner.pubkey(),
            config: h.config,
            draw: key,
            collection,
            catalog,
        }
        .to_account_metas(None),
    );
    assert!(h.send(ix, &owner).is_err());
    let c: Collection = h.read(collection);
    assert_eq!(c.owned_mask, 0);
    assert_eq!(c.starter, StarterClaim::Pending);
    let ix = Instruction::new_with_bytes(
        purrps_game::ID,
        &purrps_game::instruction::SelectCat {
            args: SelectCatArgs {
                expected_inventory_version: 0,
                cat: CatId::Collector,
            },
        }
        .data(),
        purrps_game::accounts::SelectCat {
            owner: owner.pubkey(),
            collection,
        }
        .to_account_metas(None),
    );
    assert!(h.send(ix, &owner).is_err());
}
#[test]
fn queue_cpi_failure_rolls_back_claim_nonce_lock_and_draw_creation() {
    let (mut h, owner, player, collection, catalog, _) = fixture();
    let mut cfg: GameConfig = h.read(h.config);
    cfg.allow_starter = true;
    let config_key = h.config;
    setup::put(&mut h, config_key, &cfg);
    // Deliberately unavailable provider: its declared program ID rejects the CPI.
    h.svm
        .add_program(
            cfg.vrf_program,
            include_bytes!(concat!(
                env!("CARGO_TARGET_TMPDIR"),
                "/../deploy/purrps_game.so"
            )),
        )
        .unwrap();
    let mut queue = h.svm.get_account(&owner.pubkey()).unwrap();
    queue.owner = cfg.vrf_program;
    queue.data = vec![];
    h.svm.set_account(cfg.vrf_queue, queue).unwrap();
    let draw = Pubkey::find_program_address(
        &[
            purrps_game::DRAW_SEED,
            owner.pubkey().as_ref(),
            &0u64.to_le_bytes(),
        ],
        &purrps_game::ID,
    )
    .0;
    let ix = Instruction::new_with_bytes(
        purrps_game::ID,
        &purrps_game::instruction::ClaimStarter {
            args: RequestCapsuleArgs {
                expected_draw_nonce: 0,
                expected_inventory_version: 0,
                expected_catalog_version: 1,
                kind: CapsuleKind::StarterCat,
                max_payer_debit_lamports: 100_000_000,
            },
        }
        .data(),
        purrps_game::accounts::ClaimStarter {
            config: h.config,
            owner: owner.pubkey(),
            payer: owner.pubkey(),
            player,
            collection,
            catalog,
            draw,
            oracle_queue: cfg.vrf_queue,
            program_identity: Pubkey::find_program_address(&[b"identity"], &purrps_game::ID).0,
            vrf_program: cfg.vrf_program,
            slot_hashes: ephemeral_rollups_sdk::vrf::compat::slot_hashes::ID,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
    );
    let failed = h.send(ix, &owner).unwrap_err();
    assert!(
        failed
            .meta
            .logs
            .iter()
            .any(|line| line.contains("DeclaredProgramIdMismatch")),
        "{:?}",
        failed.meta.logs
    );
    assert!(h.svm.get_account(&draw).is_none());
    let p: PlayerAccount = h.read(player);
    let c: Collection = h.read(collection);
    assert_eq!(p.next_draw_nonce, 0);
    assert_eq!(c.starter, StarterClaim::Unclaimed);
    assert!(c.pending_draw.is_none());
}
#[test]
fn admission_cannot_enable_unbuilt_purchases_or_er_execution() {
    let (mut h, _, _, _, _, _) = fixture();
    let a = setup::admin(&h);
    for args in [
        SetAdmissionArgs {
            starter: false,
            purchases: true,
            reservations: false,
        },
        SetAdmissionArgs {
            starter: false,
            purchases: false,
            reservations: true,
        },
    ] {
        let ix = Instruction::new_with_bytes(
            purrps_game::ID,
            &purrps_game::instruction::SetAdmission { args }.data(),
            purrps_game::accounts::SetAdmission {
                config: h.config,
                admin: a.pubkey(),
            }
            .to_account_metas(None),
        );
        assert!(h.send(ix, &a).is_err());
    }
}

#[test]
fn export_starter_account_fixtures_when_requested() {
    if std::env::var("PURRPS_EXPORT_STARTER_FIXTURES").as_deref() != Ok("1") {
        return;
    }
    let (mut h, owner, player, collection, catalog, mut draw) = fixture();
    let draw_key = Pubkey::find_program_address(
        &[
            purrps_game::DRAW_SEED,
            owner.pubkey().as_ref(),
            &0u64.to_le_bytes(),
        ],
        &purrps_game::ID,
    )
    .0;
    let directory =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../../tests/.artifacts");
    std::fs::create_dir_all(&directory).unwrap();
    let export = |h: &Harness, name: &str| {
        let mut output = format!("wallet|{}\n", owner.pubkey());
        for (label, key) in [
            ("config", h.config),
            ("player", player),
            ("collection", collection),
            ("catalog", catalog),
        ] {
            let account = h.svm.get_account(&key).unwrap();
            let mut hex = String::new();
            for byte in account.data {
                write!(&mut hex, "{byte:02x}").unwrap();
            }
            writeln!(&mut output, "{label}|{key}|{hex}").unwrap();
        }
        std::fs::write(directory.join(format!("starter-{name}.csv")), output).unwrap();
    };
    export(&h, "empty");
    let mut p: PlayerAccount = h.read(player);
    p.next_draw_nonce = 1;
    setup::put(&mut h, player, &p);
    let mut c = pending(&h, collection, draw_key);
    setup::put(&mut h, collection, &c);
    export(&h, "pending");
    let published: CatalogVersion = h.read(catalog);
    grant_starter(
        draw_key, &mut draw, &mut c, &published, [9; 32], [8; 32], 1700000010,
    )
    .unwrap();
    setup::put(&mut h, collection, &c);
    export(&h, "fulfilled");
}
