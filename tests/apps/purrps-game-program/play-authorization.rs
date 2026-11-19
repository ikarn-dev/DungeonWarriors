use anchor_lang::{prelude::*, AccountDeserialize};
use purrps_game::{
    catalog::CatId,
    contracts::snapshot_hash,
    instruction_args::*,
    protocol::RunPhase,
    state::{
        collection::{Collection, PlayerAccount, SessionAuthorization},
        config::{CatalogVersion, GameConfig},
        economy::{EscrowStatus, HouseState, RunEscrow, SponsorBudget, SponsorPurpose},
        run::RunGameState,
    },
};
use solana_keypair::Keypair;
use solana_signer::Signer;
#[path = "play-boundaries.rs"]
mod boundaries;
#[path = "credit-contention.rs"]
mod credit_contention;
#[path = "delegation.rs"]
mod delegation;
#[path = "paid-capsules.rs"]
mod paid_capsules;
#[path = "support/play-setup.rs"]
mod play;
#[path = "play-recovery.rs"]
mod recovery;
#[path = "returned-settlement.rs"]
mod returned_settlement;
#[path = "completion.rs"]
mod run_completion;
#[path = "run-crank.rs"]
mod run_crank;
#[path = "run-lifecycle.rs"]
mod run_lifecycle;
#[path = "run-oracle.rs"]
mod run_oracle;
#[path = "support/game-setup.rs"]
mod setup;
#[path = "support/harness.rs"]
mod support;
use play::{ix, pda, Play, NOW};
fn rejected(result: litesvm::types::TransactionResult, code: &str) {
    let failure = result.expect_err("must reject");
    assert!(
        failure.meta.logs.iter().any(|line| line.contains(code)),
        "expected {code}: {:?}",
        failure.meta.logs
    );
}
fn account_bytes(p: &Play, key: Pubkey) -> Vec<u8> {
    p.h.svm.get_account(&key).unwrap().data
}
fn no_run(p: &Play, nonce: u64) {
    for seed in [purrps_game::RUN_GAME_SEED, purrps_game::RUN_ESCROW_SEED] {
        assert!(p
            .h
            .svm
            .get_account(&pda(seed, p.owner.pubkey(), nonce))
            .is_none());
    }
}

#[test]
fn session_requires_actual_external_owner_canonical_scope_and_finite_allowance() {
    let mut p = Play::new();
    let original = p.h.svm.get_account(&p.token).unwrap();
    let mut bad = original.clone();
    bad.owner = purrps_game::ID;
    p.h.svm.set_account(p.token, bad).unwrap();
    rejected(
        p.h.send(p.auth_ix(p.auth_args()), &p.owner),
        "AccountOwnedByWrongProgram",
    );
    p.h.svm.set_account(p.token, original.clone()).unwrap();
    for case in 0..6 {
        let mut a = p.auth_args();
        match case {
            0 => a.input_key = Keypair::new().pubkey(),
            1 => a.expires_at_seconds = NOW,
            2 => a.expires_at_seconds = NOW + 7201,
            3 => a.allowance_base_units = 0,
            4 => a.expected_session_nonce = 1,
            _ => a.input_key = Pubkey::default(),
        }
        rejected(p.h.send(p.auth_ix(a), &p.owner), "InvalidSession");
        let player: PlayerAccount = p.h.read(p.player);
        assert_eq!(player.next_session_nonce, 0);
        assert!(p.h.svm.get_account(&p.authorization).is_none());
    }
    for offset in [8, 40, 72] {
        let mut bad = original.clone();
        bad.data[offset..offset + 32].copy_from_slice(Keypair::new().pubkey().as_ref());
        p.h.svm.set_account(p.token, bad).unwrap();
        rejected(
            p.h.send(p.auth_ix(p.auth_args()), &p.owner),
            "InvalidSession",
        );
    }
    p.h.svm.set_account(p.token, original).unwrap();
    p.authorize();
    let auth: SessionAuthorization = p.h.read(p.authorization);
    assert_eq!(auth.input_key, p.key.pubkey());
    assert_eq!(auth.spent_base_units, 0);
    rejected(
        p.h.send(p.auth_ix(p.auth_args()), &p.owner),
        "already in use",
    );
}

#[test]
fn sponsorship_is_admin_configured_purpose_bounded_and_actually_funded() {
    let mut p = Play::new();
    let before = p.h.svm.get_balance(&p.sponsor.pubkey()).unwrap();
    for case in 0..6 {
        let mut a = p.fund_args(0);
        match case {
            0 => a.purpose = SponsorPurpose::StarterDraw,
            1 => a.limit_lamports = 3_000_001,
            2 => a.reserved_completion_lamports = 999_999,
            3 => a.max_attempts = 4,
            4 => a.expires_at_seconds = NOW,
            _ => a.reserved_completion_lamports = 2_000_001,
        }
        rejected(p.h.send(p.fund_ix(a), &p.sponsor), "InvalidSponsorBudget");
        assert!(p.h.svm.get_account(&p.budget(0)).is_none());
    }
    let mut a = p.policy_args();
    a.authority = p.h.admin.pubkey();
    rejected(p.configure(a), "InvalidSponsorBudget");
    let mut a = p.policy_args();
    a.paused = true;
    p.configure(a).unwrap();
    rejected(
        p.h.send(p.fund_ix(p.fund_args(0)), &p.sponsor),
        "InvalidSponsorBudget",
    );
    p.configure(p.policy_args()).unwrap();
    p.fund(0);
    let budget: SponsorBudget = p.h.read(p.budget(0));
    assert_eq!(budget.spent_lamports, 0);
    assert_eq!(budget.attempts, 0);
    let balance = p.h.svm.get_balance(&p.budget(0)).unwrap();
    let rent =
        p.h.svm
            .minimum_balance_for_rent_exemption(8 + SponsorBudget::INIT_SPACE);
    assert_eq!(balance, rent + 2_000_000);
    assert!(p.h.svm.get_balance(&p.sponsor.pubkey()).unwrap() < before - balance);
    rejected(
        p.h.send(p.fund_ix(p.fund_args(0)), &p.sponsor),
        "already in use",
    );
}

#[test]
fn two_runs_freeze_independent_snapshots_and_consume_allowance_without_token_movement() {
    let mut p = Play::new();
    p.authorize();
    p.admit_fixture();
    p.fund(0);
    p.fund(1);
    p.fund(2);
    let vault = account_bytes(&p, p.vault);
    p.reserve(0).unwrap();
    let run_key = pda(purrps_game::RUN_GAME_SEED, p.owner.pubkey(), 0);
    let escrow_key = pda(purrps_game::RUN_ESCROW_SEED, p.owner.pubkey(), 0);
    let run: RunGameState = p.h.read(run_key);
    let escrow: RunEscrow = p.h.read(escrow_key);
    assert_eq!(run.phase, RunPhase::Ready);
    assert_eq!(run.active_ticks, 0);
    assert_eq!(run.entity_count, 0);
    assert_eq!(run.intents.len(), 32);
    assert_eq!(run.entities.len(), 64);
    assert_eq!(run.observations.len(), 16);
    assert_eq!(run.snapshot_hash, snapshot_hash(&run.snapshot).unwrap());
    assert_eq!(run.snapshot, escrow.snapshot);
    assert_eq!(escrow.status, EscrowStatus::Reserved);
    assert!(!escrow.delegation_initiated);
    assert_eq!(run.snapshot.max_gross_base_units, 10_000_000);
    assert_eq!(run.snapshot.activation_deadline_seconds, NOW + 300);
    assert_eq!(run.snapshot.oracle.feed_id, 6);
    assert_eq!(run.snapshot.cat.level, 1);
    let old_run = account_bytes(&p, run_key);
    let old_escrow = account_bytes(&p, escrow_key);
    p.reserve(1).unwrap();
    let player: PlayerAccount = p.h.read(p.player);
    let house: HouseState = p.h.read(p.house);
    let auth: SessionAuthorization = p.h.read(p.authorization);
    assert_eq!(
        (
            player.available_base_units,
            player.locked_stake_base_units,
            player.next_run_nonce
        ),
        (18_000_000, 2_000_000, 2)
    );
    assert_eq!(
        (
            house.total_available_base_units,
            house.total_max_gross_base_units
        ),
        (18_000_000, 20_000_000)
    );
    assert_eq!(auth.spent_base_units, 2_000_000);
    assert_eq!(account_bytes(&p, p.vault), vault);
    assert_eq!(account_bytes(&p, run_key), old_run);
    assert_eq!(account_bytes(&p, escrow_key), old_escrow);
    rejected(p.reserve(2), "InvalidSession");
    no_run(&p, 2);
    assert_eq!(
        p.h.read::<SessionAuthorization>(p.authorization)
            .spent_base_units,
        2_000_000
    );
}

#[test]
fn reservation_rejects_stale_scopes_collateral_shortfall_and_rolls_back_allocations() {
    let mut p = Play::new();
    p.authorize();
    p.admit_fixture();
    p.fund(0);
    let player = account_bytes(&p, p.player);
    let house = account_bytes(&p, p.house);
    let auth = account_bytes(&p, p.authorization);
    for case in 0..5 {
        let mut a = p.args(0);
        let code = match case {
            0 => {
                a.expected_inventory_version = 1;
                "InvalidInventory"
            }
            1 => {
                a.cat = CatId::Sprinter;
                "InvalidInventory"
            }
            2 => {
                a.stake_base_units = 0;
                "InvalidAmount"
            }
            3 => {
                a.stake_base_units = 2_000_001;
                "InvalidSession"
            }
            _ => {
                a.session_nonce = 1;
                "InvalidSession"
            }
        };
        rejected(p.h.send(p.reserve_ix(a, p.key.pubkey()), &p.key), code);
        no_run(&p, 0);
        assert_eq!(account_bytes(&p, p.player), player);
        assert_eq!(account_bytes(&p, p.house), house);
        assert_eq!(account_bytes(&p, p.authorization), auth);
    }
    let attacker = Keypair::new();
    p.h.svm.airdrop(&attacker.pubkey(), 100_000_000).unwrap();
    rejected(
        p.h.send(p.reserve_ix(p.args(0), attacker.pubkey()), &attacker),
        "InvalidSession",
    );
    let mut v = p.h.svm.get_account(&p.vault).unwrap();
    v.data[64..72].copy_from_slice(&25_000_000u64.to_le_bytes());
    p.h.svm.set_account(p.vault, v).unwrap();
    rejected(p.reserve(0), "InsolventHouse");
    no_run(&p, 0);
    assert_eq!(account_bytes(&p, p.player), player);
    assert_eq!(account_bytes(&p, p.house), house);
}

#[test]
fn completion_budget_must_match_run_beneficiary_policy_and_available_native_funds() {
    let mut p = Play::new();
    p.authorize();
    p.admit_fixture();
    p.fund(0);
    let original = p.h.svm.get_account(&p.budget(0)).unwrap();
    for case in 0..8 {
        let mut b: SponsorBudget = p.h.read(p.budget(0));
        match case {
            0 => b.operation = Pubkey::new_unique(),
            1 => b.beneficiary = p.key.pubkey(),
            2 => b.purpose = SponsorPurpose::RunActivation,
            3 => b.expires_at_seconds = NOW + 299,
            4 => b.attempts = b.max_attempts,
            5 => b.spent_lamports = 1_000_001,
            6 => b.reserved_completion_lamports = 999_999,
            _ => b.authority = p.owner.pubkey(),
        }
        let mut a = original.clone();
        let mut data = Vec::new();
        b.try_serialize(&mut data).unwrap();
        data.resize(original.data.len(), 0);
        a.data = data;
        p.h.svm.set_account(p.budget(0), a).unwrap();
        rejected(p.reserve(0), "InvalidSponsorBudget");
        no_run(&p, 0);
        p.h.svm.set_account(p.budget(0), original.clone()).unwrap();
    }
    let mut a = original.clone();
    a.lamports -= 1;
    p.h.svm.set_account(p.budget(0), a).unwrap();
    rejected(p.reserve(0), "InvalidSponsorBudget");
    p.h.svm.set_account(p.budget(0), original).unwrap();
    let mut policy = p.policy_args();
    policy.authority = Keypair::new().pubkey();
    p.configure(policy).unwrap();
    rejected(p.reserve(0), "InvalidSponsorBudget");
}

#[test]
fn base_revocation_or_token_expiry_blocks_new_runs_without_rewriting_existing_permissions() {
    let mut p = Play::new();
    p.authorize();
    p.admit_fixture();
    p.fund(0);
    p.fund(1);
    p.reserve(0).unwrap();
    let run = pda(purrps_game::RUN_GAME_SEED, p.owner.pubkey(), 0);
    let bytes = account_bytes(&p, run);
    let revoke = ix(
        purrps_game::instruction::RevokeSession {},
        purrps_game::accounts::RevokeSession {
            owner: p.owner.pubkey(),
            authorization: p.authorization,
        },
    );
    p.h.send(revoke, &p.owner).unwrap();
    rejected(p.reserve(1), "InvalidSession");
    assert_eq!(account_bytes(&p, run), bytes);
    let state: RunGameState = p.h.read(run);
    assert!(!state.input_key_revoked);
    assert_eq!(state.snapshot.input_permission.input_key, p.key.pubkey());
    assert_eq!(
        p.h.read::<SessionAuthorization>(p.authorization)
            .spent_base_units,
        1_000_000
    );
    let mut auth: SessionAuthorization = p.h.read(p.authorization);
    auth.revoked = false;
    setup::put(&mut p.h, p.authorization, &auth);
    p.h.svm.set_sysvar(&Clock {
        unix_timestamp: NOW + 3600,
        ..Clock::default()
    });
    rejected(p.reserve(1), "InvalidSession");
    no_run(&p, 1);
}

#[test]
fn later_catalog_inventory_and_config_do_not_change_reserved_snapshot() {
    let mut p = Play::new();
    p.authorize();
    p.admit_fixture();
    p.fund(0);
    p.reserve(0).unwrap();
    let run = pda(purrps_game::RUN_GAME_SEED, p.owner.pubkey(), 0);
    let before = account_bytes(&p, run);
    let mut collection: Collection = p.h.read(p.collection);
    collection.cats[0].as_mut().unwrap().level = 5;
    collection.inventory_version += 1;
    setup::put(&mut p.h, p.collection, &collection);
    let admin = setup::admin(&p.h);
    let catalog2 = Pubkey::find_program_address(
        &[purrps_game::CATALOG_SEED, &2u32.to_le_bytes()],
        &purrps_game::ID,
    )
    .0;
    let mut catalog = purrps_game::catalog::CATALOG_V1;
    catalog.catalog_version = 2;
    p.h.send(
        ix(
            purrps_game::instruction::PublishCatalog {
                args: PublishCatalogArgs {
                    expected_current_version: 1,
                    catalog,
                    asset_manifest: purrps_game::contracts::VersionBinding {
                        version: 2,
                        content_hash: [9; 32],
                    },
                },
            },
            purrps_game::accounts::PublishCatalog {
                config: p.h.config,
                admin: admin.pubkey(),
                catalog: catalog2,
                system_program: anchor_lang::solana_program::system_program::ID,
            },
        ),
        &admin,
    )
    .unwrap();
    assert_eq!(account_bytes(&p, run), before);
    assert_eq!(p.h.read::<RunGameState>(run).snapshot.cat.level, 1);
    p.fund(1);
    let mut a = p.args(1);
    a.expected_catalog_version = 2;
    a.expected_inventory_version = 1;
    let mut instruction = p.reserve_ix(a, p.key.pubkey());
    let mut changed = false;
    for meta in &mut instruction.accounts {
        if meta.pubkey == p.catalog && !changed {
            meta.pubkey = catalog2;
            changed = true;
        }
    }
    p.h.send(instruction, &p.key).unwrap();
    let next: RunGameState =
        p.h.read(pda(purrps_game::RUN_GAME_SEED, p.owner.pubkey(), 1));
    assert_eq!(next.snapshot.cat.level, 5);
    assert_eq!(next.snapshot.cat.defining_catalog.version, 1);
    assert_eq!(next.snapshot.asset_manifest.content_hash, [7; 32]);
    let published: CatalogVersion = p.h.read(catalog2);
    assert_ne!(next.snapshot.asset_manifest, published.asset_manifest);
}

#[test]
fn deployed_admission_gate_remains_closed_and_fixed_buffer_layout_stays_strict() {
    let mut p = Play::new();
    p.authorize();
    p.fund(0);
    rejected(p.reserve(0), "AdmissionClosed");
    no_run(&p, 0);
    assert!(!p.h.read::<GameConfig>(p.h.config).allow_reservations);
    p.admit_fixture();
    p.reserve(0).unwrap();
    let run = pda(purrps_game::RUN_GAME_SEED, p.owner.pubkey(), 0);
    let mut bytes = account_bytes(&p, run);
    // Strict decoding still rejects a zero entity-buffer prefix after initialized storage.
    let state: RunGameState = p.h.read(run);
    let mut prefix = Vec::new();
    state.snapshot.serialize(&mut prefix).unwrap();
    let offset = 8 + 2 + 1 + 32 + prefix.len() + 32 + 1 + 8 + 8 + 46;
    let expected = (64u32).to_le_bytes();
    assert_eq!(&bytes[offset..offset + 4], &expected);
    bytes[offset..offset + 4].fill(0);
    assert!(RunGameState::try_deserialize(&mut bytes.as_slice()).is_err());
    assert!(8 + RunGameState::INIT_SPACE <= 10240);
}
