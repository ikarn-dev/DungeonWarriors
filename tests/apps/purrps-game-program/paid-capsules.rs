use super::{account_bytes, ix, pda, rejected, setup, Play, NOW};
use anchor_lang::{
    prelude::*,
    solana_program::{instruction::Instruction, system_program},
};
use purrps_game::{
    accounts,
    catalog::{CatId, Rarity},
    draw::paid_pool,
    instruction,
    instruction_args::*,
    state::{
        collection::{Collection, PlayerAccount, StarterClaim},
        config::{CatalogVersion, GameConfig},
        draws::{CapsuleDraw, CapsuleKind, DrawResult, DrawStatus},
        economy::HouseState,
        run::RunGameState,
    },
};
use solana_message::{Message, VersionedMessage};
use solana_signer::Signer;
use solana_transaction::versioned::VersionedTransaction;

const CREDIT: u64 = 20_000_000;
const SEED: [u8; 32] = [7; 32];

fn set_clock(p: &mut Play, unix_timestamp: i64) {
    let mut clock: Clock = p.h.svm.get_sysvar();
    clock.unix_timestamp = unix_timestamp;
    p.h.svm.set_sysvar(&clock);
}

fn completed_starter(p: &mut Play) -> Collection {
    let mut collection: Collection = p.h.read(p.collection);
    collection.starter = StarterClaim::Fulfilled;
    setup::put(&mut p.h, p.collection, &collection);
    collection
}

fn payment(p: &Play) -> accounts::ResolveCapsule {
    accounts::ResolveCapsule {
        config: p.h.config,
        draw: pda(purrps_game::DRAW_SEED, p.owner.pubkey(), 0),
        collection: p.collection,
        player: p.player,
        house: p.house,
        vault: p.vault,
    }
}

pub(super) fn purchase(p: &Play, kind: CapsuleKind, nonce: u64, cap: u64) -> Instruction {
    let cfg: GameConfig = p.h.read(p.h.config);
    let owner = p.owner.pubkey();
    ix(
        instruction::PurchaseCapsule {
            args: RequestCapsuleArgs {
                expected_draw_nonce: nonce,
                expected_inventory_version: 0,
                expected_catalog_version: 1,
                kind,
                max_payer_debit_lamports: cap,
            },
        },
        accounts::PurchaseCapsule {
            config: p.h.config,
            owner,
            player: p.player,
            collection: p.collection,
            catalog: p.catalog,
            house: p.house,
            vault: p.vault,
            draw: pda(purrps_game::DRAW_SEED, owner, nonce),
            oracle_queue: cfg.vrf_queue,
            program_identity: Pubkey::find_program_address(&[b"identity"], &purrps_game::ID).0,
            vrf_program: cfg.vrf_program,
            slot_hashes: ephemeral_rollups_sdk::vrf::compat::slot_hashes::ID,
            system_program: system_program::ID,
        },
    )
}

pub(super) fn open_fixture(p: &mut Play) -> GameConfig {
    completed_starter(p);
    let config = p.h.config;
    let mut cfg: GameConfig = p.h.read(config);
    cfg.allow_purchases = true;
    setup::put(&mut p.h, config, &cfg);
    cfg
}

pub(super) fn install_vrf_fixture(
    p: &mut Play,
    cfg: &GameConfig,
    program: &[u8],
    queue_data: &[u8],
) {
    p.h.svm.add_program(cfg.vrf_program, program).unwrap();
    let mut queue = p.h.svm.get_account(&p.owner.pubkey()).unwrap();
    queue.owner = cfg.vrf_program;
    queue.data = queue_data.to_vec();
    queue.lamports = p.h.svm.minimum_balance_for_rent_exemption(queue.data.len());
    p.h.svm.set_account(cfg.vrf_queue, queue).unwrap();
}

fn pending_fixture(p: &mut Play, kind: CapsuleKind) -> (Pubkey, u64) {
    let mut collection = completed_starter(p);
    let config: GameConfig = p.h.read(p.h.config);
    let catalog: CatalogVersion = p.h.read(p.catalog);
    let owner = p.owner.pubkey();
    let (key, bump) = Pubkey::find_program_address(
        &[purrps_game::DRAW_SEED, owner.as_ref(), &0u64.to_le_bytes()],
        &purrps_game::ID,
    );
    let (eligible_mask, weights, total_weight, price) =
        paid_pool(kind, &collection, &catalog.catalog).unwrap();
    // Isolate the terminal instructions from MagicBlock's external request queue.
    let draw = CapsuleDraw {
        schema_version: purrps_game::SCHEMA_VERSION,
        bump,
        owner,
        nonce: 0,
        kind,
        status: DrawStatus::Pending,
        catalog: catalog.binding,
        inventory_version: collection.inventory_version,
        eligible_mask,
        weights,
        total_weight,
        price_base_units: price,
        vrf_program: config.vrf_program,
        vrf_queue: config.vrf_queue,
        callback_authority: config.vrf_callback_authority,
        committed_seed_hash: SEED,
        requested_at_seconds: NOW,
        paid_deadline_seconds: Some(NOW + 300),
        result: None,
        completed_at_seconds: None,
    };
    setup::put(&mut p.h, key, &draw);
    let mut account = p.h.svm.get_account(&key).unwrap();
    account.data.resize(8 + CapsuleDraw::INIT_SPACE, 0);
    account.lamports =
        p.h.svm
            .minimum_balance_for_rent_exemption(account.data.len());
    p.h.svm.set_account(key, account).unwrap();
    collection.pending_draw = Some(key);
    setup::put(&mut p.h, p.collection, &collection);
    let mut player: PlayerAccount = p.h.read(p.player);
    player.next_draw_nonce = 1;
    player.available_base_units -= price;
    player.purchase_escrow_base_units = price;
    setup::put(&mut p.h, p.player, &player);
    let mut house: HouseState = p.h.read(p.house);
    house.total_available_base_units -= price;
    house.total_purchase_escrow_base_units = price;
    setup::put(&mut p.h, p.house, &house);
    (key, price)
}

fn callback(p: &mut Play, identity: Pubkey, seed: [u8; 32]) -> litesvm::types::TransactionResult {
    let invoke = ix(
        instruction::FulfillCapsule {
            randomness: [13; 32],
            seed,
        },
        accounts::FulfillCapsule {
            vrf_program_identity: identity,
            payment: payment(p),
            catalog: p.catalog,
        },
    );
    p.h.svm.expire_blockhash();
    let message = Message::new_with_blockhash(
        &[invoke],
        Some(&p.key.pubkey()),
        &p.h.svm.latest_blockhash(),
    );
    // Model the signature MagicBlock supplies via CPI. Onchain the identity is
    // an off-curve PDA and only the provider can sign for it.
    let tx = VersionedTransaction {
        signatures: vec![Default::default(); message.header.num_required_signatures.into()],
        message: VersionedMessage::Legacy(message),
    };
    assert!(p.h.svm.get_sigverify());
    assert!(p.h.svm.send_transaction(tx.clone()).is_err());
    p.h.svm = p.h.svm.clone().with_sigverify(false);
    let result = p.h.svm.send_transaction(tx);
    p.h.svm = p.h.svm.clone().with_sigverify(true);
    result
}

#[test]
fn paid_pool_excludes_owned_cats_and_requires_an_upgradeable_cat() {
    let mut p = Play::new();
    let catalog: CatalogVersion = p.h.read(p.catalog);
    let mut collection: Collection = p.h.read(p.collection);
    assert!(paid_pool(CapsuleKind::PaidCat, &collection, &catalog.catalog).is_err());
    collection = completed_starter(&mut p);
    assert_eq!(
        paid_pool(CapsuleKind::PaidCat, &collection, &catalog.catalog).unwrap(),
        (14, [0, 3500, 2500, 500], 6500, 2_000_000)
    );
    assert_eq!(
        paid_pool(CapsuleKind::Upgrade, &collection, &catalog.catalog).unwrap(),
        (7, [7000, 2500, 500, 0], 10_000, 1_000_000)
    );
    collection.owned_mask = 15;
    assert!(paid_pool(CapsuleKind::PaidCat, &collection, &catalog.catalog).is_err());
    collection.cats[0].as_mut().unwrap().level = 5;
    assert!(paid_pool(CapsuleKind::Upgrade, &collection, &catalog.catalog).is_err());
}

#[test]
fn provider_rejection_rolls_back_draw_allocation_escrow_and_nonce() {
    let mut p = Play::new();
    let cfg = open_fixture(&mut p);
    p.h.svm
        .add_program(
            cfg.vrf_program,
            include_bytes!(concat!(
                env!("CARGO_TARGET_TMPDIR"),
                "/../deploy/purrps_game.so"
            )),
        )
        .unwrap();
    let mut queue = p.h.svm.get_account(&p.owner.pubkey()).unwrap();
    queue.owner = cfg.vrf_program;
    p.h.svm.set_account(cfg.vrf_queue, queue).unwrap();
    let draw = payment(&p).draw;
    for kind in [CapsuleKind::PaidCat, CapsuleKind::Upgrade] {
        let watched = [p.player, p.collection, p.house, p.vault];
        let before = watched.map(|key| account_bytes(&p, key));
        let request = purchase(&p, kind, 0, 100_000_000);
        rejected(
            p.h.send(request, &p.owner),
            if kind == CapsuleKind::Upgrade {
                "AdmissionClosed"
            } else {
                "DeclaredProgramIdMismatch"
            },
        );
        assert!(p.h.svm.get_account(&draw).is_none());
        assert_eq!(watched.map(|key| account_bytes(&p, key)), before);
    }
}

#[test]
#[ignore = "requires read-only Devnet VRF program and queue snapshots"]
fn provider_snapshot_accepts_paid_requests_and_locks_the_exact_credit() {
    let snapshot = |name| std::fs::read(std::env::var(name).unwrap()).unwrap();
    let provider = snapshot("PURRPS_VRF_PROGRAM_SNAPSHOT");
    let queue_data = snapshot("PURRPS_VRF_QUEUE_SNAPSHOT");
    for kind in [CapsuleKind::PaidCat] {
        let mut p = Play::new();
        let cfg = open_fixture(&mut p);
        install_vrf_fixture(&mut p, &cfg, &provider, &queue_data);
        let draw = payment(&p).draw;
        let bad_cap = purchase(&p, kind, 0, 1);
        rejected(p.h.send(bad_cap, &p.owner), "InvalidSponsorBudget");
        assert!(p.h.svm.get_account(&draw).is_none());
        let request = purchase(&p, kind, 0, 100_000_000);
        p.h.send(request, &p.owner).unwrap();
        let saved: CapsuleDraw = p.h.read(draw);
        assert_eq!(saved.status, DrawStatus::Pending);
        assert_eq!(saved.kind, kind);
        assert_eq!(saved.paid_deadline_seconds, Some(NOW + 300));
        let collection: Collection = p.h.read(p.collection);
        assert_eq!(collection.pending_draw, Some(draw));
        let player: PlayerAccount = p.h.read(p.player);
        let house: HouseState = p.h.read(p.house);
        assert_eq!(player.next_draw_nonce, 1);
        assert_eq!(player.available_base_units, CREDIT - saved.price_base_units);
        assert_eq!(player.purchase_escrow_base_units, saved.price_base_units);
        assert_eq!(
            house.total_purchase_escrow_base_units,
            saved.price_base_units
        );
        let duplicate = purchase(&p, kind, 1, 100_000_000);
        rejected(p.h.send(duplicate, &p.owner), "InvalidInventory");
        callback(
            &mut p,
            cfg.vrf_callback_authority,
            saved.committed_seed_hash,
        )
        .unwrap();
        assert_eq!(p.h.read::<CapsuleDraw>(draw).status, DrawStatus::Fulfilled);
    }
}

#[test]
fn authenticated_callback_grants_once_and_reclassifies_escrow() {
    for kind in [CapsuleKind::PaidCat] {
        let mut p = Play::new();
        let (draw, price) = pending_fixture(&mut p, kind);
        let identity = p.h.read::<GameConfig>(p.h.config).vrf_callback_authority;
        let vault = account_bytes(&p, p.vault);
        let payer = p.key.pubkey();
        rejected(callback(&mut p, payer, SEED), "ConstraintAddress");
        rejected(callback(&mut p, identity, [0; 32]), "InvalidCallback");
        callback(&mut p, identity, SEED).unwrap();
        let collection: Collection = p.h.read(p.collection);
        let saved: CapsuleDraw = p.h.read(draw);
        assert_eq!(saved.status, DrawStatus::Fulfilled);
        assert_eq!(collection.pending_draw, None);
        assert_eq!(collection.inventory_version, 1);
        match saved.result.unwrap() {
            DrawResult::Cat(cat) => {
                assert_eq!(kind, CapsuleKind::PaidCat);
                assert_ne!(cat, CatId::Collector);
                assert_eq!(collection.owned_mask, 1 | 1 << cat as usize);
            }
            DrawResult::Upgrade(grade) => {
                assert_eq!(kind, CapsuleKind::Upgrade);
                assert_eq!(collection.upgrade_quantities[grade as usize], 1);
                assert_eq!(collection.upgrade_quantities.iter().sum::<u64>(), 1);
            }
        }
        let player: PlayerAccount = p.h.read(p.player);
        let house: HouseState = p.h.read(p.house);
        assert_eq!(player.available_base_units, CREDIT - price);
        assert_eq!(house.total_available_base_units, CREDIT - price);
        assert_eq!(player.purchase_escrow_base_units, 0);
        assert_eq!(house.total_purchase_escrow_base_units, 0);
        assert_eq!(account_bytes(&p, p.vault), vault);
        rejected(callback(&mut p, identity, SEED), "InvalidInventory");
        set_clock(&mut p, NOW + 300);
        let refund = ix(instruction::RefundCapsule {}, payment(&p));
        rejected(p.h.send(refund, &p.key), "InvalidInventory");
    }
}

#[test]
fn cutoff_allows_only_the_original_credit_refund() {
    let mut p = Play::new();
    let (draw, _) = pending_fixture(&mut p, CapsuleKind::Upgrade);
    let identity = p.h.read::<GameConfig>(p.h.config).vrf_callback_authority;
    let vault = account_bytes(&p, p.vault);
    let refund = ix(instruction::RefundCapsule {}, payment(&p));
    set_clock(&mut p, NOW + 299);
    rejected(p.h.send(refund.clone(), &p.key), "DrawNotExpired");
    set_clock(&mut p, NOW + 300);
    rejected(callback(&mut p, identity, SEED), "DrawExpired");
    p.h.send(refund.clone(), &p.key).unwrap();
    let saved: CapsuleDraw = p.h.read(draw);
    assert_eq!(saved.status, DrawStatus::Refunded);
    assert_eq!(saved.result, None);
    assert_eq!(saved.completed_at_seconds, Some(NOW + 300));
    let collection: Collection = p.h.read(p.collection);
    assert_eq!(collection.pending_draw, None);
    assert_eq!(collection.inventory_version, 0);
    let player: PlayerAccount = p.h.read(p.player);
    let house: HouseState = p.h.read(p.house);
    assert_eq!(player.next_draw_nonce, 1);
    assert_eq!(player.available_base_units, CREDIT);
    assert_eq!(house.total_available_base_units, CREDIT);
    assert_eq!(player.purchase_escrow_base_units, 0);
    assert_eq!(house.total_purchase_escrow_base_units, 0);
    assert_eq!(account_bytes(&p, p.vault), vault);
    rejected(p.h.send(refund, &p.key), "InvalidInventory");
    rejected(callback(&mut p, identity, SEED), "InvalidInventory");
}

#[test]
fn applying_one_item_clips_the_level_and_preserves_existing_run() {
    let mut p = Play::new();
    let mut collection = completed_starter(&mut p);
    collection.cats[0].as_mut().unwrap().level = 4;
    collection.upgrade_quantities[2] = 2;
    setup::put(&mut p.h, p.collection, &collection);
    p.authorize();
    p.admit_fixture();
    p.fund(0);
    p.reserve(0).unwrap();
    let run = pda(purrps_game::RUN_GAME_SEED, p.owner.pubkey(), 0);
    let frozen = account_bytes(&p, run);
    let original: RunGameState = p.h.read(run);
    let args = ApplyUpgradeArgs {
        expected_inventory_version: 0,
        expected_defining_catalog_version: 1,
        expected_cat_level: 4,
        cat: CatId::Collector,
        grade: Rarity::Epic,
    };
    let (collection, catalog) = (p.collection, p.catalog);
    let apply = |owner, args| {
        ix(
            instruction::ApplyUpgrade { args },
            accounts::ApplyUpgrade {
                owner,
                collection,
                catalog,
            },
        )
    };
    rejected(
        p.h.send(apply(p.key.pubkey(), args.clone()), &p.key),
        "ConstraintSeeds",
    );
    p.h.send(apply(p.owner.pubkey(), args.clone()), &p.owner)
        .unwrap();
    let new: Collection = p.h.read(p.collection);
    assert_eq!(new.cats[0].unwrap().level, 5);
    assert_eq!(new.upgrade_quantities, [0, 0, 1]);
    assert_eq!(new.inventory_version, 1);
    assert_eq!(account_bytes(&p, run), frozen);
    p.fund(1);
    let next_args = ReserveRunArgs {
        expected_inventory_version: 1,
        ..p.args(1)
    };
    p.h.send(p.reserve_ix(next_args, p.key.pubkey()), &p.key)
        .unwrap();
    let next: RunGameState =
        p.h.read(pda(purrps_game::RUN_GAME_SEED, p.owner.pubkey(), 1));
    assert_eq!(original.snapshot.cat.stats.power_cooldown_ticks, 840);
    assert_eq!(next.snapshot.cat.stats.power_cooldown_ticks, 720);
    assert_eq!(account_bytes(&p, run), frozen);
    rejected(
        p.h.send(apply(p.owner.pubkey(), args.clone()), &p.owner),
        "InvalidInventory",
    );
    let capped = ApplyUpgradeArgs {
        expected_inventory_version: 1,
        expected_cat_level: 5,
        ..args
    };
    rejected(
        p.h.send(apply(p.owner.pubkey(), capped), &p.owner),
        "InvalidInventory",
    );
    assert_eq!(
        p.h.read::<Collection>(p.collection).upgrade_quantities,
        [0, 0, 1]
    );
}
