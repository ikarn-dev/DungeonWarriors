use super::{ix, pda, rejected, setup, Play, NOW};
use anchor_lang::{prelude::*, solana_program::system_program};
use dungeon_warriors::{
    accounts,
    catalog::CatId,
    dungeon::*,
    instruction,
    instructions::{dungeon_reserve::ReserveDungeonArgs, dungeon_settle::DungeonResult},
    state::{
        collection::PlayerAccount,
        config::GameConfig,
        dungeon::{DungeonConfig, DungeonExpedition, DungeonStatus},
        economy::HouseState,
        records::Leaderboard,
    },
};
use solana_message::{Message, VersionedMessage};
use solana_signer::Signer;
use solana_transaction::versioned::VersionedTransaction;
#[path = "dungeon-delivery.rs"]
mod delivery;
const SECRET: [u8; 32] = [42; 32];
const RANDOM: [u8; 32] = [7; 32];
fn config(_p: &Play) -> Pubkey {
    Pubkey::find_program_address(&[DUNGEON_CONFIG_SEED], &dungeon_warriors::ID).0
}
fn board() -> Pubkey {
    Pubkey::find_program_address(&[b"dungeon-leaderboard"], &dungeon_warriors::ID).0
}
fn configure(p: &mut Play) {
    let admin = setup::admin(&p.h);
    p.h.send(
        ix(
            instruction::ConfigureDungeon {
                rules: DUNGEON_V2,
                verifier: p.key.pubkey(),
                enabled: true,
            },
            accounts::ConfigureDungeon {
                config: p.h.config,
                admin: admin.pubkey(),
                dungeon: config(p),
                system_program: system_program::ID,
            },
        ),
        &admin,
    )
    .unwrap();
}
fn fixture(p: &mut Play, ready: bool) -> Pubkey {
    configure(p);
    let key = pda(EXPEDITION_SEED, p.owner.pubkey(), 0);
    let cfg: GameConfig = p.h.read(p.h.config);
    let (_, bump) = Pubkey::find_program_address(
        &[
            EXPEDITION_SEED,
            p.owner.pubkey().as_ref(),
            &0u64.to_le_bytes(),
        ],
        &dungeon_warriors::ID,
    );
    let e = DungeonExpedition {
        schema_version: 1,
        bump,
        owner: p.owner.pubkey(),
        nonce: 0,
        cat: CatId::Collector,
        verifier: p.key.pubkey(),
        rules: DUNGEON_V2,
        rules_hash: DUNGEON_V2.content_hash().unwrap(),
        stake: 1_000_000,
        max_rooms: 5,
        max_gross: 7_214_062,
        commitment: solana_sha256_hasher::hashv(&[&SECRET]).to_bytes(),
        vrf_program: cfg.vrf_program,
        vrf_queue: cfg.vrf_queue,
        callback_authority: cfg.vrf_callback_authority,
        request_seed: [9; 32],
        requested_at: NOW,
        randomness_deadline: NOW + 300,
        randomness: ready.then_some(RANDOM),
        status: if ready {
            DungeonStatus::Ready
        } else {
            DungeonStatus::AwaitingRandomness
        },
        secret: None,
        gates: [255; 5],
        gate_count: 0,
        cleared: 0,
        payout: 0,
        completed_at: None,
    };
    setup::put(&mut p.h, key, &e);
    let mut allocated = p.h.svm.get_account(&key).unwrap();
    allocated.data.resize(8 + DungeonExpedition::INIT_SPACE, 0);
    allocated.lamports =
        p.h.svm
            .minimum_balance_for_rent_exemption(allocated.data.len());
    p.h.svm.set_account(key, allocated).unwrap();
    let mut a: PlayerAccount = p.h.read(p.player);
    a.available_base_units -= e.stake;
    a.locked_stake_base_units = e.stake;
    a.next_run_nonce = 1;
    setup::put(&mut p.h, p.player, &a);
    let mut h: HouseState = p.h.read(p.house);
    h.total_available_base_units -= e.stake;
    h.total_max_gross_base_units = e.max_gross;
    setup::put(&mut p.h, p.house, &h);
    key
}
fn resolution(p: &Play) -> accounts::ResolveDungeon {
    accounts::ResolveDungeon {
        config: p.h.config,
        expedition: pda(EXPEDITION_SEED, p.owner.pubkey(), 0),
        player: p.player,
        house: p.house,
        vault: p.vault,
    }
}
fn settle(
    p: &Play,
    args: DungeonResult,
    verifier: Pubkey,
) -> anchor_lang::solana_program::instruction::Instruction {
    ix(
        instruction::SettleDungeon { args },
        accounts::SettleDungeon {
            resolution: resolution(p),
            verifier,
            payer: verifier,
            leaderboard: board(),
            system_program: system_program::ID,
        },
    )
}
fn result(gate: u8, outcome: u8) -> DungeonResult {
    DungeonResult {
        secret: SECRET,
        gates: [gate, 255, 255, 255, 255],
        gate_count: 1,
        outcome,
    }
}
#[test]
fn published_rules_are_admin_controlled_and_version_content_is_immutable() {
    let mut p = Play::new();
    configure(&mut p);
    let before: DungeonConfig = p.h.read(config(&p));
    assert_eq!(before.rules, DUNGEON_V2);
    let mut changed = DUNGEON_V2;
    changed.engine_hash[0] ^= 1;
    assert!(changed.validate().is_err());
    changed = DUNGEON_V2;
    changed.version = 1;
    assert!(changed.validate().is_err());

    let admin = setup::admin(&p.h);
    for rogue in [true, false] {
        let signer = if rogue { &p.owner } else { &admin };
        let mut rules = DUNGEON_V2;
        if !rogue {
            rules.return_bps = 9600;
        }
        assert!(p
            .h
            .send(
                ix(
                    instruction::ConfigureDungeon {
                        rules,
                        verifier: p.key.pubkey(),
                        enabled: true
                    },
                    accounts::ConfigureDungeon {
                        config: p.h.config,
                        admin: signer.pubkey(),
                        dungeon: config(&p),
                        system_program: system_program::ID
                    }
                ),
                signer
            )
            .is_err());
    }
    assert_eq!(p.h.read::<DungeonConfig>(config(&p)).rules, DUNGEON_V2);
    assert_eq!(
        dungeon_payout(1_000_000, 5, &DUNGEON_V2).unwrap(),
        7_214_062
    );
    assert!(dungeon_payout(u64::MAX, 5, &DUNGEON_V2).is_err());
}
#[test]
fn settlement_checks_authority_secret_path_cap_and_pays_exactly_once() {
    let mut p = Play::new();
    let key = fixture(&mut p, true);
    let trap = trap_gate(&key, &RANDOM, &SECRET, 0).unwrap();
    let safe = (trap + 1) % 3;
    let mut bad = result(safe, 0);
    bad.secret = [1; 32];
    rejected(
        p.h.send(settle(&p, bad, p.key.pubkey()), &p.key),
        "InvalidRun",
    );
    assert!(p
        .h
        .send(settle(&p, result(safe, 0), p.owner.pubkey()), &p.owner)
        .is_err());
    rejected(
        p.h.send(settle(&p, result(trap, 0), p.key.pubkey()), &p.key),
        "InvalidRun",
    );
    let mut bad = result(safe, 0);
    bad.gates[4] = 0;
    rejected(
        p.h.send(settle(&p, bad, p.key.pubkey()), &p.key),
        "InvalidRun",
    );
    p.h.send(settle(&p, result(safe, 0), p.key.pubkey()), &p.key)
        .unwrap();
    let e: DungeonExpedition = p.h.read(key);
    assert_eq!(e.status, DungeonStatus::Won);
    assert_eq!(e.payout, 1_425_000);
    assert_eq!(e.secret, Some(SECRET));
    assert_eq!(e.cleared, 1);
    let a: PlayerAccount = p.h.read(p.player);
    assert_eq!(a.available_base_units, 20_425_000);
    assert_eq!(a.locked_stake_base_units, 0);
    assert_eq!(a.wins, 1);
    let h: HouseState = p.h.read(p.house);
    assert_eq!(h.total_max_gross_base_units, 0);
    assert_eq!(h.total_available_base_units, 20_425_000);
    assert_eq!(
        p.h.read::<Leaderboard>(board()).entries[0].unwrap().score,
        1
    );
    rejected(
        p.h.send(settle(&p, result(safe, 0), p.key.pubkey()), &p.key),
        "InvalidRun",
    );
    assert_eq!(
        p.h.read::<PlayerAccount>(p.player).available_base_units,
        20_425_000
    );
}
#[test]
fn traps_and_abandonment_lose_the_stake_but_unstarted_refunds_only_return_the_stake() {
    for (outcome, gate_count) in [(1, 1), (1, 0), (2, 0)] {
        let mut p = Play::new();
        let key = fixture(&mut p, true);
        let gate = trap_gate(&key, &RANDOM, &SECRET, 0).unwrap();
        let mut args = result(gate, outcome);
        args.gate_count = gate_count;
        if gate_count == 0 {
            args.gates = [255; 5];
        }
        p.h.send(settle(&p, args, p.key.pubkey()), &p.key).unwrap();
        let a: PlayerAccount = p.h.read(p.player);
        assert_eq!(
            a.available_base_units,
            if outcome == 2 { 20_000_000 } else { 19_000_000 }
        );
        assert_eq!(a.locked_stake_base_units, 0);
    }
}
fn callback(p: &mut Play, identity: Pubkey, seed: [u8; 32]) -> litesvm::types::TransactionResult {
    let invoke = ix(
        instruction::FulfillDungeon {
            randomness: RANDOM,
            seed,
        },
        accounts::FulfillDungeon {
            vrf_program_identity: identity,
            expedition: resolution(p).expedition,
        },
    );
    p.h.svm.expire_blockhash();
    let message = Message::new_with_blockhash(
        &[invoke],
        Some(&p.key.pubkey()),
        &p.h.svm.latest_blockhash(),
    );
    let tx = VersionedTransaction {
        signatures: vec![Default::default(); message.header.num_required_signatures.into()],
        message: VersionedMessage::Legacy(message),
    };
    assert!(p.h.svm.send_transaction(tx.clone()).is_err());
    // Isolated CPI-signature model; normal signature verification is restored immediately.
    p.h.svm = p.h.svm.clone().with_sigverify(false);
    let result = p.h.svm.send_transaction(tx);
    p.h.svm = p.h.svm.clone().with_sigverify(true);
    result
}
#[test]
fn only_the_authenticated_original_vrf_callback_wins_the_refund_race() {
    let mut p = Play::new();
    let key = fixture(&mut p, false);
    let e: DungeonExpedition = p.h.read(key);
    assert!(callback(&mut p, Pubkey::new_unique(), e.request_seed).is_err());
    rejected(
        callback(&mut p, e.callback_authority, [8; 32]),
        "InvalidCallback",
    );
    rejected(
        p.h.send(
            ix(instruction::RefundDungeonRandomness {}, resolution(&p)),
            &p.owner,
        ),
        "DrawNotExpired",
    );
    callback(&mut p, e.callback_authority, e.request_seed).unwrap();
    rejected(
        callback(&mut p, e.callback_authority, e.request_seed),
        "InvalidCallback",
    );
    let mut clock: Clock = p.h.svm.get_sysvar();
    clock.unix_timestamp = NOW + 300;
    p.h.svm.set_sysvar(&clock);
    rejected(
        p.h.send(
            ix(instruction::RefundDungeonRandomness {}, resolution(&p)),
            &p.owner,
        ),
        "DrawNotExpired",
    );
    assert_eq!(
        p.h.read::<DungeonExpedition>(key).status,
        DungeonStatus::Ready
    );
    let mut p = Play::new();
    let key = fixture(&mut p, false);
    let e: DungeonExpedition = p.h.read(key);
    let mut clock: Clock = p.h.svm.get_sysvar();
    clock.unix_timestamp = NOW + 300;
    p.h.svm.set_sysvar(&clock);
    rejected(
        callback(&mut p, e.callback_authority, e.request_seed),
        "InvalidCallback",
    );
    p.h.send(
        ix(instruction::RefundDungeonRandomness {}, resolution(&p)),
        &p.owner,
    )
    .unwrap();
    assert_eq!(
        p.h.read::<DungeonExpedition>(key).status,
        DungeonStatus::Refunded
    );
    assert_eq!(
        p.h.read::<PlayerAccount>(p.player).available_base_units,
        20_000_000
    );
    rejected(
        p.h.send(
            ix(instruction::RefundDungeonRandomness {}, resolution(&p)),
            &p.owner,
        ),
        "DrawNotExpired",
    );
}
#[test]
#[ignore = "requires read-only Devnet VRF snapshots"]
fn real_provider_reservation_is_sponsored_atomic_and_nonce_bound() {
    let provider =
        std::fs::read(std::env::var("DUNGEON_WARRIORS_VRF_PROGRAM_SNAPSHOT").unwrap()).unwrap();
    let queue =
        std::fs::read(std::env::var("DUNGEON_WARRIORS_VRF_QUEUE_SNAPSHOT").unwrap()).unwrap();
    let mut p = Play::new();
    p.admit_fixture();
    configure(&mut p);
    let cfg: GameConfig = p.h.read(p.h.config);
    super::paid_capsules::install_vrf_fixture(&mut p, &cfg, &provider, &queue);
    let owner = p.owner.pubkey();
    let key = pda(EXPEDITION_SEED, owner, 0);
    let make = |cap, cat, stake| {
        ix(
            instruction::ReserveDungeon {
                args: ReserveDungeonArgs {
                    nonce: 0,
                    rules_version: 2,
                    cat,
                    stake,
                    max_rooms: 5,
                    commitment: solana_sha256_hasher::hashv(&[&SECRET]).to_bytes(),
                    max_payer_debit_lamports: cap,
                },
            },
            accounts::ReserveDungeon {
                config: p.h.config,
                dungeon: config(&p),
                owner,
                payer: p.sponsor.pubkey(),
                player: p.player,
                collection: p.collection,
                house: p.house,
                vault: p.vault,
                expedition: key,
                oracle_queue: cfg.vrf_queue,
                program_identity: Pubkey::find_program_address(
                    &[b"identity"],
                    &dungeon_warriors::ID,
                )
                .0,
                vrf_program: cfg.vrf_program,
                slot_hashes: ephemeral_rollups_sdk::vrf::compat::slot_hashes::ID,
                system_program: system_program::ID,
            },
        )
    };
    let requests = [
        make(1, CatId::Collector, 1_000_000),
        make(100_000_000, CatId::Sprinter, 1_000_000),
        make(100_000_000, CatId::Collector, 19_000_000),
        make(100_000_000, CatId::Collector, 1_000_000),
    ];
    let original = p.h.svm.get_balance(&owner).unwrap();
    for (i, request) in requests.into_iter().enumerate() {
        p.h.svm.expire_blockhash();
        let message = Message::new_with_blockhash(
            &[request.clone()],
            Some(&p.sponsor.pubkey()),
            &p.h.svm.latest_blockhash(),
        );
        let tx = VersionedTransaction::try_new(
            VersionedMessage::Legacy(message),
            &[&p.sponsor, &p.owner],
        )
        .unwrap();
        let result = p.h.svm.send_transaction(tx);
        if i < 3 {
            assert!(result.is_err());
            assert!(p.h.svm.get_account(&key).is_none());
            assert_eq!(
                p.h.read::<PlayerAccount>(p.player).available_base_units,
                20_000_000
            );
        } else {
            result.unwrap();
        }
    }
    assert_eq!(p.h.svm.get_balance(&owner).unwrap(), original);
    let e: DungeonExpedition = p.h.read(key);
    assert_eq!(e.status, DungeonStatus::AwaitingRandomness);
    assert_eq!(e.max_gross, 7_214_062);
    let a: PlayerAccount = p.h.read(p.player);
    assert_eq!(a.next_run_nonce, 1);
    assert_eq!(a.locked_stake_base_units, 1_000_000);
    assert_eq!(a.available_base_units, 19_000_000);
}

#[test]
fn committed_gate_derivation_matches_the_independent_browser_hash_vector() {
    let key = Pubkey::new_from_array([1; 32]);
    let gates: Vec<_> = (0..5)
        .map(|room| trap_gate(&key, &RANDOM, &SECRET, room).unwrap())
        .collect();
    assert_eq!(gates, vec![0, 0, 2, 1, 2]);
}
