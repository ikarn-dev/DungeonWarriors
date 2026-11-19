use super::*;
use ephemeral_rollups_sdk::consts::{MAGIC_CONTEXT_ID, MAGIC_PROGRAM_ID};
use purrps_game::{
    accounts, instruction,
    oracle::{inspect_account, InspectedOracle},
    protocol::{
        AcceptedIntent, FaultReason, InputAxis, IntentEnvelope, PlayerIntent, TerminalReason,
        PROTOCOL_VERSION,
    },
    run_engine::{
        enqueue_intents,
        lifecycle::{activate_world, advance_tick},
    },
};

fn reserve() -> (Play, Pubkey, InspectedOracle) {
    let mut p = Play::new();
    p.authorize();
    p.admit_fixture();
    p.fund(0);
    p.reserve(0).unwrap();
    let key = pda(purrps_game::RUN_GAME_SEED, p.owner.pubkey(), 0);
    let run: RunGameState = p.h.read(key);
    let binding = run.snapshot.oracle;
    let bytes = include_str!("../../fixtures/providers/oracle-v3-full.hex")
        .trim()
        .as_bytes()
        .chunks_exact(2)
        .map(|b| u8::from_str_radix(std::str::from_utf8(b).unwrap(), 16).unwrap())
        .collect::<Vec<_>>();
    let oracle = inspect_account(
        &binding.account,
        &binding.program,
        &bytes,
        &binding,
        run.snapshot.market,
        NOW,
        123_456_790,
    )
    .unwrap();
    let mut account = p.h.svm.get_account(&p.key.pubkey()).unwrap();
    account.data = bytes;
    account.owner = binding.program;
    p.h.svm.set_account(binding.account, account).unwrap();
    let mut context = p.h.svm.get_account(&p.key.pubkey()).unwrap();
    context.owner = MAGIC_PROGRAM_ID;
    p.h.svm.set_account(MAGIC_CONTEXT_ID, context).unwrap();
    (p, key, oracle)
}

fn active() -> (Play, Pubkey, InspectedOracle) {
    let (mut p, key, oracle) = reserve();
    let mut run: RunGameState = p.h.read(key);
    activate_world(&mut run, &oracle, NOW).unwrap();
    setup::put(&mut p.h, key, &run);
    (p, key, oracle)
}

fn intent(run: Pubkey, client_sequence: u64, action: PlayerIntent) -> IntentEnvelope {
    IntentEnvelope {
        protocol_version: PROTOCOL_VERSION,
        rules_version: 1,
        run,
        client_sequence,
        action,
    }
}

fn set_time(p: &mut Play, now: i64) {
    let mut clock: Clock = p.h.svm.get_sysvar();
    clock.unix_timestamp = now;
    p.h.svm.set_sysvar(&clock);
}

#[test]
fn signed_queue_binds_run_and_sequence_and_applies_control_budget_atomically() {
    let (mut p, key, oracle) = reserve();
    let signer = p.key.pubkey();
    let submit = |authority, from, count| {
        ix(
            instruction::SubmitIntents {
                args: SubmitIntentsArgs {
                    intents: (from..from + count)
                        .map(|sequence| intent(key, sequence, PlayerIntent::Jump))
                        .collect(),
                },
            },
            accounts::RunInput {
                run: key,
                authority,
                magic_context: MAGIC_CONTEXT_ID,
            },
        )
    };
    rejected(p.h.send(submit(signer, 1, 1), &p.key), "InvalidRunInput");
    let mut run: RunGameState = p.h.read(key);
    activate_world(&mut run, &oracle, NOW).unwrap();
    run.intent_head = 30;
    setup::put(&mut p.h, key, &run);

    rejected(
        p.h.send(submit(p.owner.pubkey(), 1, 1), &p.owner),
        "InvalidRunInput",
    );
    rejected(
        p.h.send(submit(signer, 1, 9), &p.key),
        "InstructionDidNotDeserialize",
    );
    rejected(p.h.send(submit(signer, 2, 1), &p.key), "InvalidRunInput");
    for (first, count) in [(1, 8), (9, 8), (17, 4)] {
        p.h.send(submit(signer, first, count), &p.key).unwrap();
    }
    let before = account_bytes(&p, key);
    rejected(
        p.h.send(submit(signer, 21, 1), &p.key),
        "ControlRateExceeded",
    );
    assert_eq!(account_bytes(&p, key), before);
    let heartbeat = |client_sequence, action| {
        ix(
            instruction::Heartbeat {
                intent: intent(key, client_sequence, action),
            },
            accounts::RunInput {
                run: key,
                authority: signer,
                magic_context: MAGIC_CONTEXT_ID,
            },
        )
    };
    p.h.send(heartbeat(21, PlayerIntent::Inactive), &p.key)
        .unwrap();
    let run: RunGameState = p.h.read(key);
    assert_eq!(run.active_ticks, 0);
    assert_eq!(run.last_accepted_sequence, 21);
    assert_eq!(run.intents[30].unwrap().assigned_tick, 1);
    assert_eq!(run.intents[0].unwrap().accepted_order, 3);
    set_time(&mut p, NOW + 1);
    rejected(p.h.send(submit(signer, 22, 1), &p.key), "InvalidRunInput");
    p.h.send(
        heartbeat(22, PlayerIntent::Heartbeat { active: true }),
        &p.key,
    )
    .unwrap();
    p.h.send(submit(signer, 23, 8), &p.key).unwrap();
    p.h.send(submit(signer, 31, 2), &p.key).unwrap();
    rejected(p.h.send(submit(signer, 33, 1), &p.key), "InvalidRunInput");
}

#[test]
fn owner_revokes_only_the_current_run_key_and_retries_preserve_deadline() {
    let (mut p, key, _) = active();
    let revoke = |authority| {
        ix(
            instruction::RevokeRunInputKey {},
            accounts::RunInput {
                run: key,
                authority,
                magic_context: MAGIC_CONTEXT_ID,
            },
        )
    };
    let submit = ix(
        instruction::SubmitIntents {
            args: SubmitIntentsArgs {
                intents: vec![intent(key, 1, PlayerIntent::CashOut)],
            },
        },
        accounts::RunInput {
            run: key,
            authority: p.key.pubkey(),
            magic_context: MAGIC_CONTEXT_ID,
        },
    );
    rejected(p.h.send(revoke(p.key.pubkey()), &p.key), "InvalidOwner");
    let base_auth = account_bytes(&p, p.authorization);
    p.h.send(revoke(p.owner.pubkey()), &p.owner).unwrap();
    let mut run: RunGameState = p.h.read(key);
    assert!(run.input_key_revoked);
    assert_eq!(run.key_exit_tick, Some(300));
    run.active_ticks = 1;
    setup::put(&mut p.h, key, &run);
    p.h.send(revoke(p.owner.pubkey()), &p.owner).unwrap();
    assert_eq!(p.h.read::<RunGameState>(key).key_exit_tick, Some(300));
    rejected(p.h.send(submit, &p.key), "InvalidRunInput");
    assert_eq!(account_bytes(&p, p.authorization), base_auth);
}

#[test]
fn tick_processes_cash_out_before_qualification_and_freezes_the_first_terminal() {
    let (p, key, oracle) = active();
    let mut run: RunGameState = p.h.read(key);
    run.active_ticks = 599;
    run.last_heartbeat_tick = 599;
    run.designated_coin_mask = 7;
    enqueue_intents(
        &mut run,
        p.key.pubkey(),
        NOW,
        &[intent(key, 1, PlayerIntent::CashOut)],
        true,
    )
    .unwrap();
    advance_tick(&mut run, &oracle, NOW).unwrap();
    assert_eq!(run.active_ticks, 600);
    assert_eq!(run.qualified_checkpoints, 1);
    assert!(run.terminal.is_none());
    enqueue_intents(
        &mut run,
        p.key.pubkey(),
        NOW,
        &[
            intent(key, 2, PlayerIntent::CashOut),
            intent(key, 3, PlayerIntent::Surrender),
        ],
        true,
    )
    .unwrap();
    advance_tick(&mut run, &oracle, NOW).unwrap();
    let terminal = run.terminal.unwrap();
    assert_eq!(terminal.reason, TerminalReason::CashOut);
    assert_eq!(terminal.gross_payout_base_units, 1_100_000);
    assert_eq!(terminal.active_ticks, 600);
    assert_eq!(terminal.processed_sequence, 2);
    assert_eq!(run.intent_count, 1);
    assert!(advance_tick(&mut run, &oracle, NOW).is_err());
    assert_eq!(run.terminal, Some(terminal));
}

#[test]
fn liveness_auto_exits_on_time_and_preserves_earlier_key_deadline() {
    let (p, key, oracle) = active();
    let mut run: RunGameState = p.h.read(key);
    run.active_ticks = 299;
    advance_tick(&mut run, &oracle, NOW).unwrap();
    assert_eq!(run.terminal.unwrap().reason, TerminalReason::Surrender);

    let mut run: RunGameState = p.h.read(key);
    run.active_ticks = 100;
    run.inactive_exit_tick = Some(101);
    enqueue_intents(
        &mut run,
        p.key.pubkey(),
        NOW,
        &[intent(key, 1, PlayerIntent::Heartbeat { active: true })],
        false,
    )
    .unwrap();
    advance_tick(&mut run, &oracle, NOW).unwrap();
    assert_eq!(run.phase, RunPhase::Active);
    assert_eq!(run.inactive_exit_tick, None);
    assert_eq!(run.last_heartbeat_tick, 101);

    let mut run: RunGameState = p.h.read(key);
    run.active_ticks = 700;
    run.world_generation.checkpoint = 1;
    run.qualified_checkpoints = 1;
    run.last_heartbeat_tick = 699;
    run.inactive_exit_tick = Some(730);
    run.key_exit_tick = Some(701);
    run.input_key_revoked = true;
    run.last_accepted_sequence = 1;
    run.last_accepted_order = 1;
    run.intent_count = 1;
    run.intents[0] = Some(AcceptedIntent {
        envelope: intent(key, 1, PlayerIntent::Heartbeat { active: true }),
        assigned_tick: 701,
        accepted_order: 1,
    });
    advance_tick(&mut run, &oracle, NOW).unwrap();
    let terminal = run.terminal.unwrap();
    assert_eq!(run.key_exit_tick, Some(701));
    assert_eq!(run.runner.axis, InputAxis::Neutral);
    assert_eq!(terminal.reason, TerminalReason::AutoCashOut);
    assert_eq!(terminal.gross_payout_base_units, 1_100_000);
}

#[test]
fn oracle_recovery_keeps_ticks_frozen_and_expiry_records_one_refund() {
    let (mut p, key, oracle) = active();
    let run: RunGameState = p.h.read(key);
    let source = run.snapshot.oracle.account;
    let recover = |price_update| {
        ix(
            instruction::SuspendOrResumeRun {},
            accounts::RecoverRunOracle {
                run: key,
                price_update,
                magic_context: MAGIC_CONTEXT_ID,
            },
        )
    };
    let original = p.h.svm.get_account(&source).unwrap();
    set_time(&mut p, NOW + 1);
    rejected(
        p.h.send(recover(p.key.pubkey()), &p.key),
        "InvalidOracleData",
    );
    p.h.send(recover(source), &p.key).unwrap();
    let suspended: RunGameState = p.h.read(key);
    assert_eq!(suspended.phase, RunPhase::Suspended);
    assert_eq!(
        suspended.suspension.unwrap().reason,
        FaultReason::OracleStale
    );
    assert_eq!(suspended.active_ticks, run.active_ticks);
    let next_quote = |p: &mut Play, now: i64, slot: u64| {
        let mut current = original.clone();
        current.data[93..101].copy_from_slice(&now.to_le_bytes());
        current.data[125..133].copy_from_slice(&slot.to_le_bytes());
        p.h.svm.set_account(source, current).unwrap();
    };
    next_quote(&mut p, NOW + 1, oracle.quote.posted_slot + 1);
    p.h.send(recover(source), &p.key).unwrap();
    let resumed: RunGameState = p.h.read(key);
    assert_eq!(resumed.phase, RunPhase::Active);
    assert_eq!(resumed.active_ticks, run.active_ticks);
    assert_eq!(resumed.latest_observation().unwrap().unwrap().sequence, 2);

    set_time(&mut p, NOW + 4);
    p.h.send(recover(source), &p.key).unwrap();
    set_time(&mut p, NOW + 303);
    p.h.send(recover(source), &p.key).unwrap();
    assert_eq!(p.h.read::<RunGameState>(key).phase, RunPhase::Suspended);
    set_time(&mut p, NOW + 304);
    next_quote(&mut p, NOW + 304, oracle.quote.posted_slot + 2);
    p.h.send(recover(source), &p.key).unwrap();
    let terminal = p.h.read::<RunGameState>(key).terminal.unwrap();
    assert_eq!(terminal.reason, TerminalReason::TechnicalAbort);
    assert_eq!(terminal.refund_base_units, 1_000_000);
    let saved = account_bytes(&p, key);
    rejected(p.h.send(recover(source), &p.key), "InvalidRun");
    assert_eq!(account_bytes(&p, key), saved);

    let accounts = super::returned_settlement::settlement(&p, 0);
    let escrow_key = accounts.settlement.escrow;
    let mut escrow: RunEscrow = p.h.read(escrow_key);
    // The isolated game account models state returned after real delegation.
    escrow.delegation_initiated = true;
    setup::put(&mut p.h, escrow_key, &escrow);
    p.h.send(ix(instruction::SettleReturnedRun {}, accounts), &p.key)
        .unwrap();
    assert_eq!(
        p.h.read::<RunEscrow>(escrow_key).status,
        EscrowStatus::RefundedTechnical
    );
    assert_eq!(
        p.h.read::<PlayerAccount>(p.player).available_base_units,
        20_000_000
    );
}
