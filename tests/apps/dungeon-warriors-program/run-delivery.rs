use anchor_lang::{
    prelude::*, solana_program::instruction::Instruction, InstructionData, ToAccountMetas,
};
use dungeon_warriors::{
    instructions::inspect_run::snapshot_hash,
    protocol::{RunPhase, TerminalReason},
    simulation::world::{initialize_world, PriceSample},
    state::{
        economy::{EscrowStatus, RunEscrow},
        run::*,
    },
};
use solana_keypair::Keypair;
use solana_signer::Signer;
#[path = "support/run-state.rs"]
mod layout;
#[path = "support/simulation.rs"]
mod simulation;
#[path = "support/harness.rs"]
mod support;

fn fixture() -> (Pubkey, RunGameState, Pubkey, RunEscrow) {
    let mut r = layout::max_layout();
    let owner = Pubkey::new_from_array([1; 32]);
    let nonce = 1u64.to_le_bytes();
    let (key, bump) = Pubkey::find_program_address(
        &[dungeon_warriors::RUN_GAME_SEED, owner.as_ref(), &nonce],
        &dungeon_warriors::ID,
    );
    let (escrow, ebump) = Pubkey::find_program_address(
        &[dungeon_warriors::RUN_ESCROW_SEED, owner.as_ref(), &nonce],
        &dungeon_warriors::ID,
    );
    r.bump = bump;
    r.escrow = escrow;
    r.snapshot.run = key;
    r.snapshot.input_permission.program = dungeon_warriors::ID;
    let mut frame = simulation::frame();
    frame.runner.y_subpixels = 540 * 256 / 2 - 28 * 256;
    let world = initialize_world(
        frame,
        &r.snapshot.cat.stats,
        PriceSample {
            previous_price: 10000,
            previous_exponent: 8,
            price: 10000,
            exponent: 8,
        },
    )
    .unwrap();
    r.runner = world.frame.runner;
    r.world_origin_pixels = world.world_origin_pixels;
    r.next_entity_id = world.next_entity_id;
    r.entity_count = world.entities.len() as u8;
    r.entities[..world.entities.len()].copy_from_slice(&world.entities);
    r.world_generation = world.generation;
    r.phase = RunPhase::Active;
    r.active_ticks = 0;
    r.powers = frame.powers;
    r.score = 0;
    r.total_coins = 0;
    r.designated_coin_mask = 0;
    r.qualified_checkpoints = 0;
    r.last_accepted_sequence = 0;
    r.last_processed_sequence = 0;
    r.last_accepted_order = 0;
    r.intent_count = 0;
    r.intent_head = 0;
    r.intents.fill(None);
    r.observation_head = 0;
    r.observation_count = 1;
    r.observations[0].price = 10000;
    r.observations[0].exponent = 8;
    r.start_observation = Some(r.observations[0]);
    r.terminal = None;
    r.suspension = None;
    r.snapshot_hash = snapshot_hash(&r.snapshot).unwrap();
    let e = RunEscrow {
        schema_version: 1,
        bump: ebump,
        game_state: key,
        snapshot: r.snapshot,
        snapshot_hash: r.snapshot_hash,
        sponsor_budget: Pubkey::new_from_array([2; 32]),
        delegation_initiated: true,
        status: EscrowStatus::Reserved,
        receipt: None,
    };
    (key, r, escrow, e)
}
fn bytes<T: AccountSerialize>(value: &T) -> Vec<u8> {
    let mut out = Vec::new();
    value.try_serialize(&mut out).unwrap();
    out
}

#[test]
fn read_only_inspection_validates_pdas_snapshot_hash_and_owner() {
    let mut h = support::Harness::new();
    let signer = Keypair::try_from(h.admin.to_bytes().as_slice()).unwrap();
    let (key, mut r, ekey, e) = fixture();
    let mut account = h
        .svm
        .get_account(&h.config)
        .unwrap_or_else(|| h.svm.get_account(&h.admin.pubkey()).unwrap());
    account.owner = dungeon_warriors::ID;
    account.data = bytes(&r);
    account.lamports = 100_000_000;
    h.svm.set_account(key, account.clone()).unwrap();
    let ix = Instruction::new_with_bytes(
        dungeon_warriors::ID,
        &dungeon_warriors::instruction::InspectRun {}.data(),
        dungeon_warriors::accounts::InspectRun { run: key }.to_account_metas(None),
    );
    let before = account.data.clone();
    h.send(ix.clone(), &signer).unwrap();
    assert_eq!(h.svm.get_account(&key).unwrap().data, before);
    r.snapshot_hash[0] ^= 1;
    account.data = bytes(&r);
    h.svm.set_account(key, account.clone()).unwrap();
    assert!(h.send(ix.clone(), &signer).is_err());
    account.data = before;
    account.owner = anchor_lang::system_program::ID;
    h.svm.set_account(key, account.clone()).unwrap();
    assert!(h.send(ix, &signer).is_err());
    account.owner = dungeon_warriors::ID;
    account.data = bytes(&e);
    h.svm.set_account(ekey, account).unwrap();
    let ix = Instruction::new_with_bytes(
        dungeon_warriors::ID,
        &dungeon_warriors::instruction::InspectRunEscrow {}.data(),
        dungeon_warriors::accounts::InspectRunEscrow { escrow: ekey }.to_account_metas(None),
    );
    h.send(ix, &signer).unwrap();
}

#[test]
fn export_rust_borsh_account_fixtures_when_requested() {
    let (_, mut r, _, mut e) = fixture();
    let mut prefix = Vec::new();
    (
        r.schema_version,
        r.bump,
        r.escrow,
        r.snapshot,
        r.snapshot_hash,
        r.phase,
        r.active_ticks,
        r.world_origin_pixels,
        r.runner,
    )
        .serialize(&mut prefix)
        .unwrap();
    assert_eq!(8 + prefix.len(), 831);
    let mut snapshot = Vec::new();
    r.snapshot.serialize(&mut snapshot).unwrap();
    assert_eq!(snapshot.len(), 693);
    let exporting = std::env::var("DUNGEON_WARRIORS_EXPORT_RUN_FIXTURE").as_deref() == Ok("1");
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../../tests");
    let dir = root.join(if exporting {
        ".artifacts/run-delivery"
    } else {
        "fixtures/run-delivery"
    });
    if exporting {
        std::fs::create_dir_all(&dir).unwrap();
    }
    let write = |name: &str, data: Vec<u8>| {
        let hex = data.iter().map(|v| format!("{v:02x}")).collect::<String>();
        let file = dir.join(format!("{name}.hex"));
        if exporting {
            std::fs::write(file, format!("{hex}\n")).unwrap();
        } else {
            assert_eq!(std::fs::read_to_string(file).unwrap().trim(), hex);
        }
    };
    write("active", bytes(&r));
    write("reserved", bytes(&e));
    r.phase = RunPhase::Ready;
    r.start_observation = None;
    r.observation_count = 0;
    r.entity_count = 0;
    write("ready", bytes(&r));
    r.phase = RunPhase::CompletionRequested;
    r.terminal = Some(RunTerminal {
        reason: TerminalReason::TechnicalAbort,
        fault: Some(dungeon_warriors::protocol::FaultReason::ActivationExpired),
        active_ticks: 0,
        qualified_checkpoints: 0,
        score: 0,
        coins: 0,
        processed_sequence: 0,
        final_observation: None,
        gross_payout_base_units: 0,
        refund_base_units: 1,
    });
    write("terminal", bytes(&r));
    e.status = EscrowStatus::RefundedTechnical;
    e.receipt = Some(
        Pubkey::find_program_address(
            &[
                dungeon_warriors::RESULT_SEED,
                e.snapshot.owner.as_ref(),
                &e.snapshot.nonce.to_le_bytes(),
            ],
            &dungeon_warriors::ID,
        )
        .0,
    );
    write("refunded", bytes(&e));
}
