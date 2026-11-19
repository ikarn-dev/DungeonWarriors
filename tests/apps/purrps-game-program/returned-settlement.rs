use super::*;
use anchor_lang::solana_program::system_program;
use purrps_game::{
    accounts, instruction,
    protocol::{FaultReason, TerminalReason},
    state::{
        records::{Leaderboard, LeaderboardEntry, ResultReceipt},
        run::{OracleObservation, RunTerminal},
    },
};

fn terminal_fixture(p: &mut Play, reason: TerminalReason, nonce: u64) -> (Pubkey, Pubkey) {
    let owner = p.owner.pubkey();
    let run_key = pda(purrps_game::RUN_GAME_SEED, owner, nonce);
    let escrow_key = pda(purrps_game::RUN_ESCROW_SEED, owner, nonce);
    let mut escrow: RunEscrow = p.h.read(escrow_key);
    let mut run: RunGameState = p.h.read(run_key);
    escrow.delegation_initiated = true;
    let technical = reason == TerminalReason::TechnicalAbort;
    let win = matches!(
        reason,
        TerminalReason::CashOut | TerminalReason::AutoCashOut
    );
    if !technical {
        let observation = OracleObservation {
            sequence: 1,
            price: 1_000_000,
            exponent: -8,
            published_at_seconds: NOW,
            posted_slot: 100,
            content_hash: [1; 32],
        };
        run.start_observation = Some(observation);
        run.observations[0] = observation;
        run.observation_count = 1;
        run.active_ticks = 601;
        run.qualified_checkpoints = 1;
        run.score = 300;
        run.total_coins = 3;
    }
    run.phase = RunPhase::TerminalRecorded;
    run.terminal = Some(RunTerminal {
        reason,
        fault: technical.then_some(FaultReason::ActivationExpired),
        active_ticks: run.active_ticks,
        qualified_checkpoints: run.qualified_checkpoints,
        score: run.score,
        coins: run.total_coins,
        processed_sequence: 0,
        final_observation: run.start_observation,
        gross_payout_base_units: if win { 1_100_000 } else { 0 },
        refund_base_units: if technical { 1_000_000 } else { 0 },
    });
    // Simulate program-owned state returned by MagicBlock inside the isolated VM.
    setup::put(&mut p.h, escrow_key, &escrow);
    setup::put(&mut p.h, run_key, &run);
    (run_key, escrow_key)
}

fn leaderboard_key() -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            purrps_game::LEADERBOARD_SEED,
            &[purrps_game::contracts::Market::Sol as u8],
        ],
        &purrps_game::ID,
    )
}

fn settlement(p: &Play, nonce: u64) -> accounts::SettleReturnedRun {
    let owner = p.owner.pubkey();
    accounts::SettleReturnedRun {
        settlement: accounts::AbortUndelegatedReservation {
            escrow: pda(purrps_game::RUN_ESCROW_SEED, owner, nonce),
            run: pda(purrps_game::RUN_GAME_SEED, owner, nonce),
            player: p.player,
            house: p.house,
            vault: p.vault,
            payer: p.key.pubkey(),
            receipt: pda(purrps_game::RESULT_SEED, owner, nonce),
            system_program: system_program::ID,
        },
        leaderboard: leaderboard_key().0,
        system_program: system_program::ID,
    }
}

fn reserved() -> Play {
    let mut p = Play::new();
    p.authorize();
    p.admit_fixture();
    p.fund(0);
    p.reserve(0).unwrap();
    p
}

#[test]
fn returned_win_loss_and_technical_refund_release_exposure_once() {
    for (reason, status, credit, counters) in [
        (
            TerminalReason::CashOut,
            EscrowStatus::SettledWin,
            1_100_000,
            (1, 0, 0),
        ),
        (
            TerminalReason::Crash,
            EscrowStatus::SettledLoss,
            0,
            (0, 1, 0),
        ),
        (
            TerminalReason::TechnicalAbort,
            EscrowStatus::RefundedTechnical,
            1_000_000,
            (0, 0, 1),
        ),
    ] {
        let mut p = reserved();
        let (run, escrow) = terminal_fixture(&mut p, reason, 0);
        let accounts = settlement(&p, 0);
        let receipt = accounts.settlement.receipt;
        let board = accounts.leaderboard;
        let settle = ix(instruction::SettleReturnedRun {}, accounts);
        let vault = account_bytes(&p, p.vault);
        let allowance = account_bytes(&p, p.authorization);
        let original_run = account_bytes(&p, run);
        p.h.send(settle.clone(), &p.key).unwrap();
        let saved: ResultReceipt = p.h.read(receipt);
        let player: PlayerAccount = p.h.read(p.player);
        let house: HouseState = p.h.read(p.house);
        let escrow: RunEscrow = p.h.read(escrow);
        let leaderboard: Leaderboard = p.h.read(board);
        assert_eq!(saved.owner, p.owner.pubkey());
        assert_eq!(saved.run, run);
        assert_eq!(saved.snapshot_hash, escrow.snapshot_hash);
        assert_eq!(saved.terminal.reason, reason);
        assert_eq!(escrow.receipt, Some(receipt));
        assert_eq!(escrow.status, status);
        assert_eq!(player.settled_runs, 1);
        assert_eq!(
            (player.wins, player.losses, player.technical_refunds),
            counters
        );
        assert_eq!(player.available_base_units, 19_000_000 + credit);
        assert_eq!(
            house.total_available_base_units,
            player.available_base_units
        );
        assert_eq!(player.locked_stake_base_units, 0);
        assert_eq!(house.total_max_gross_base_units, 0);
        assert_eq!(account_bytes(&p, p.vault), vault);
        assert_eq!(account_bytes(&p, p.authorization), allowance);
        assert_eq!(account_bytes(&p, run), original_run);
        assert_eq!(
            leaderboard.count,
            u8::from(reason != TerminalReason::TechnicalAbort)
        );
        if let Some(entry) = leaderboard.entries[0] {
            assert_eq!(entry.run, run);
            assert_eq!(entry.score, 300);
        }
        let balances = [p.player, p.house, board, receipt].map(|key| account_bytes(&p, key));
        assert!(p.h.send(settle, &p.key).is_err());
        assert_eq!(
            [p.player, p.house, board, receipt].map(|key| account_bytes(&p, key)),
            balances
        );
    }
}

#[test]
fn unsettled_or_conflicting_return_rejects_without_moving_credit() {
    let mut p = reserved();
    let accounts = settlement(&p, 0);
    let receipt = accounts.settlement.receipt;
    let board = accounts.leaderboard;
    let settle = ix(instruction::SettleReturnedRun {}, accounts);
    rejected(p.h.send(settle.clone(), &p.key), "InvalidRun");
    let (run, escrow) = terminal_fixture(&mut p, TerminalReason::CashOut, 0);
    let watched = [p.player, p.house, escrow, p.vault];
    let balances = watched.map(|key| account_bytes(&p, key));
    let returned = p.h.svm.get_account(&run).unwrap();
    let mut delegated = returned.clone();
    delegated.owner = Pubkey::new_unique();
    p.h.svm.set_account(run, delegated).unwrap();
    rejected(
        p.h.send(settle.clone(), &p.key),
        "AccountOwnedByWrongProgram",
    );
    p.h.svm.set_account(run, returned.clone()).unwrap();
    let mut invalid: RunGameState = p.h.read(run);
    invalid.terminal.as_mut().unwrap().gross_payout_base_units += 1;
    setup::put(&mut p.h, run, &invalid);
    rejected(p.h.send(settle.clone(), &p.key), "InvalidRun");
    let mut invalid: RunGameState = p.h.read(run);
    invalid.terminal.as_mut().unwrap().gross_payout_base_units = 1_100_000;
    invalid.terminal.as_mut().unwrap().final_observation = None;
    setup::put(&mut p.h, run, &invalid);
    rejected(p.h.send(settle, &p.key), "InvalidRun");
    assert_eq!(watched.map(|key| account_bytes(&p, key)), balances);
    assert!(p.h.svm.get_account(&receipt).is_none());
    assert!(p.h.svm.get_account(&board).is_none());
}

#[test]
fn a_full_board_breaks_ties_by_run_key_and_keeps_only_twenty_scores() {
    let mut p = reserved();
    let (run, _) = terminal_fixture(&mut p, TerminalReason::Crash, 0);
    let (key, bump) = leaderboard_key();
    let mut entries = Box::new([None; 20]);
    for (index, slot) in entries.iter_mut().enumerate() {
        let mut rank_key = [255; 32];
        rank_key[31] = index as u8;
        *slot = Some(LeaderboardEntry {
            run: Pubkey::new_from_array(rank_key),
            owner: p.owner.pubkey(),
            nonce: index as u64 + 1,
            score: if index == 0 { 301 } else { 300 },
        });
    }
    setup::put(
        &mut p.h,
        key,
        &Leaderboard {
            schema_version: purrps_game::SCHEMA_VERSION,
            bump,
            market: purrps_game::contracts::Market::Sol,
            count: 20,
            entries,
        },
    );
    let accounts = settlement(&p, 0);
    p.h.send(ix(instruction::SettleReturnedRun {}, accounts), &p.key)
        .unwrap();
    let board: Leaderboard = p.h.read(key);
    assert_eq!(board.count, 20);
    assert_eq!(board.entries[0].unwrap().score, 301);
    assert_eq!(board.entries[1].unwrap().run, run);
    assert_eq!(board.entries[19].unwrap().nonce, 19);
}
