use super::*;
use purrps_game::{
    protocol::{FaultReason, TerminalReason},
    state::records::ResultReceipt,
};

#[test]
fn only_an_expired_undelegated_run_is_refunded_once_to_its_owner() {
    let mut p = Play::new();
    p.authorize();
    p.admit_fixture();
    p.fund(0);
    p.reserve(0).unwrap();
    let owner = p.owner.pubkey();
    let run = pda(purrps_game::RUN_GAME_SEED, owner, 0);
    let escrow = pda(purrps_game::RUN_ESCROW_SEED, owner, 0);
    let receipt = pda(purrps_game::RESULT_SEED, owner, 0);
    let payer = Keypair::new();
    p.h.svm.airdrop(&payer.pubkey(), 100_000_000).unwrap();
    let instruction = ix(
        purrps_game::instruction::AbortUndelegatedReservation {},
        purrps_game::accounts::AbortUndelegatedReservation {
            escrow,
            run,
            player: p.player,
            house: p.house,
            vault: p.vault,
            payer: payer.pubkey(),
            receipt,
            system_program: anchor_lang::solana_program::system_program::ID,
        },
    );
    let player = account_bytes(&p, p.player);
    let house = account_bytes(&p, p.house);
    let vault = account_bytes(&p, p.vault);
    let allowance = account_bytes(&p, p.authorization);
    p.h.svm.set_sysvar(&Clock {
        unix_timestamp: NOW + 299,
        ..Clock::default()
    });
    rejected(
        p.h.send(instruction.clone(), &payer),
        "ReservationNotRefundable",
    );
    p.h.svm.set_sysvar(&Clock {
        unix_timestamp: NOW + 300,
        ..Clock::default()
    });
    let mut escrow_state: RunEscrow = p.h.read(escrow);
    escrow_state.delegation_initiated = true;
    setup::put(&mut p.h, escrow, &escrow_state);
    rejected(
        p.h.send(instruction.clone(), &payer),
        "ReservationNotRefundable",
    );
    escrow_state.delegation_initiated = false;
    setup::put(&mut p.h, escrow, &escrow_state);
    let mut run_state: RunGameState = p.h.read(run);
    run_state.phase = RunPhase::Active;
    setup::put(&mut p.h, run, &run_state);
    rejected(
        p.h.send(instruction.clone(), &payer),
        "ReservationNotRefundable",
    );
    run_state.phase = RunPhase::Ready;
    run_state.snapshot_hash[0] ^= 1;
    setup::put(&mut p.h, run, &run_state);
    rejected(p.h.send(instruction.clone(), &payer), "InvalidRun");
    run_state.snapshot_hash[0] ^= 1;
    setup::put(&mut p.h, run, &run_state);
    assert!(p.h.svm.get_account(&receipt).is_none());
    assert_eq!(account_bytes(&p, p.player), player);
    assert_eq!(account_bytes(&p, p.house), house);

    p.h.send(instruction.clone(), &payer).unwrap();
    let player: PlayerAccount = p.h.read(p.player);
    let house: HouseState = p.h.read(p.house);
    let record: ResultReceipt = p.h.read(receipt);
    let escrow: RunEscrow = p.h.read(escrow);
    let run: RunGameState = p.h.read(run);
    assert_eq!(escrow.status, EscrowStatus::RefundedTechnical);
    assert_eq!(escrow.receipt, Some(receipt));
    assert_eq!(run.phase, RunPhase::TerminalRecorded);
    assert_eq!(run.terminal, Some(record.terminal));
    assert_eq!(record.owner, owner);
    assert_eq!(record.terminal.reason, TerminalReason::TechnicalAbort);
    assert_eq!(record.terminal.fault, Some(FaultReason::ActivationExpired));
    assert_eq!(record.terminal.refund_base_units, 1_000_000);
    assert_eq!(record.terminal.gross_payout_base_units, 0);
    assert_eq!(
        (player.available_base_units, player.locked_stake_base_units),
        (20_000_000, 0)
    );
    assert_eq!(
        (
            player.settled_runs,
            player.technical_refunds,
            player.wins,
            player.losses
        ),
        (1, 1, 0, 0)
    );
    assert_eq!(
        (
            house.total_available_base_units,
            house.total_max_gross_base_units
        ),
        (20_000_000, 0)
    );
    assert_eq!(account_bytes(&p, p.vault), vault);
    assert_eq!(account_bytes(&p, p.authorization), allowance);
    let player = account_bytes(&p, p.player);
    rejected(p.h.send(instruction, &payer), "already in use");
    assert_eq!(account_bytes(&p, p.player), player);
}
