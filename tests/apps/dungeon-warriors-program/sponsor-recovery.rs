use super::*;
use anchor_lang::{
    solana_program::instruction::{AccountMeta, Instruction},
    system_program,
};
use dungeon_warriors::{accounts, instruction};
use solana_message::{Message, VersionedMessage};
use solana_transaction::versioned::VersionedTransaction;

#[test]
fn app_funding_and_quoted_reservation_commit_together_above_the_sponsor_floor() {
    let mut p = Play::new();
    p.admit_fixture();
    let sponsor = p.sponsor.pubkey();
    let owner = p.owner.pubkey();
    let initial_sponsor_sol = p.h.svm.get_balance(&sponsor).unwrap();
    let credit = p.h.read::<PlayerAccount>(p.player).available_base_units;
    let stake = 1_000_000;
    let send = |p: &mut Play, floor: u64| {
        let fund = p.fund_ix(p.fund_args(0));
        let reserve_floor = Instruction {
            program_id: system_program::ID,
            accounts: vec![
                AccountMeta::new(sponsor, true),
                AccountMeta::new(sponsor, false),
            ],
            data: [
                2u32.to_le_bytes().as_slice(),
                floor.to_le_bytes().as_slice(),
            ]
            .concat(),
        };
        let mut args = p.args(0);
        args.stake_base_units = stake;
        let mut reserve = p.reserve_ix(args.clone(), owner);
        reserve.data = instruction::ReserveQuotedRun {
            args,
            max_gross: 2 * stake,
        }
        .data();
        p.h.svm.expire_blockhash();
        let message = Message::new_with_blockhash(
            &[fund, reserve_floor, p.auth_ix(p.auth_args()), reserve],
            Some(&owner),
            &p.h.svm.latest_blockhash(),
        );
        p.h.svm.send_transaction(
            VersionedTransaction::try_new(
                VersionedMessage::Legacy(message),
                &[&p.owner, &p.sponsor],
            )
            .unwrap(),
        )
    };
    assert!(send(&mut p, initial_sponsor_sol).is_err());
    assert_eq!(p.h.svm.get_balance(&sponsor), Some(initial_sponsor_sol));
    assert!(p.h.svm.get_account(&p.budget(0)).is_none());
    assert_eq!(
        p.h.read::<PlayerAccount>(p.player).available_base_units,
        credit
    );
    send(&mut p, initial_sponsor_sol / 2).unwrap();
    let budget_sol = p.h.svm.get_balance(&p.budget(0)).unwrap();
    assert_eq!(
        p.h.svm.get_balance(&sponsor),
        Some(initial_sponsor_sol - budget_sol)
    );
    assert_eq!(
        p.h.read::<PlayerAccount>(p.player).locked_stake_base_units,
        stake
    );
    assert!(send(&mut p, initial_sponsor_sol / 2).is_err());
    assert_eq!(p.h.svm.get_balance(&p.budget(0)), Some(budget_sol));
}

fn reclaim(p: &Play, nonce: u64, recipient: Pubkey) -> Instruction {
    let owner = p.owner.pubkey();
    ix(
        instruction::ReclaimExpiredRunBudget { _nonce: nonce },
        accounts::ReclaimExpiredRunBudget {
            budget: p.budget(0),
            run: pda(dungeon_warriors::RUN_GAME_SEED, owner, nonce),
            run_escrow: pda(dungeon_warriors::RUN_ESCROW_SEED, owner, nonce),
            sponsor: recipient,
        },
    )
}

#[test]
fn expired_unused_budget_returns_all_lamports_to_original_sponsor_once() {
    let mut p = Play::new();
    p.fund(0);
    let sponsor = p.sponsor.pubkey();
    let budget = p.budget(0);
    let budget_lamports = p.h.svm.get_balance(&budget).unwrap();
    let saved: SponsorBudget = p.h.read(budget);
    let original = p.h.svm.get_balance(&sponsor).unwrap();
    let valid = reclaim(&p, 0, sponsor);
    rejected(p.h.send(valid.clone(), &p.owner), "InvalidSponsorBudget");

    let mut clock = p.h.svm.get_sysvar::<Clock>();
    clock.unix_timestamp = saved.expires_at_seconds;
    p.h.svm.set_sysvar(&clock);
    let wrong_nonce = reclaim(&p, 1, sponsor);
    assert!(p.h.send(wrong_nonce, &p.owner).is_err());
    let wrong_recipient = reclaim(&p, 0, p.owner.pubkey());
    rejected(p.h.send(wrong_recipient, &p.owner), "InvalidSponsorBudget");
    assert_eq!(p.h.svm.get_balance(&budget), Some(budget_lamports));

    p.h.send(valid.clone(), &p.owner).unwrap();
    assert!(p.h.svm.get_account(&budget).is_none());
    assert_eq!(
        p.h.svm.get_balance(&sponsor),
        Some(original + budget_lamports)
    );
    assert!(p.h.send(valid, &p.owner).is_err());
    assert_eq!(
        p.h.svm.get_balance(&sponsor),
        Some(original + budget_lamports)
    );

    let mut auth = p.fund_args(0);
    auth.expires_at_seconds = clock.unix_timestamp + 3600;
    p.h.send(p.fund_ix(auth), &p.sponsor).unwrap();
    assert_eq!(p.h.svm.get_balance(&budget), Some(budget_lamports));
}

#[test]
fn expired_reservation_cannot_reclaim_its_completion_budget() {
    let mut p = Play::new();
    p.authorize();
    p.admit_fixture();
    p.fund(0);
    p.reserve(0).unwrap();
    let budget = p.budget(0);
    let saved: SponsorBudget = p.h.read(budget);
    let mut clock = p.h.svm.get_sysvar::<Clock>();
    clock.unix_timestamp = saved.expires_at_seconds;
    p.h.svm.set_sysvar(&clock);
    let reclaim = reclaim(&p, 0, p.sponsor.pubkey());
    let before = p.h.svm.get_balance(&budget);
    assert!(p.h.send(reclaim, &p.owner).is_err());
    assert_eq!(p.h.svm.get_balance(&budget), before);
}
