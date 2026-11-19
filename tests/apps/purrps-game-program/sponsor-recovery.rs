use super::*;
use anchor_lang::solana_program::instruction::Instruction;
use purrps_game::{accounts, instruction};

fn reclaim(p: &Play, nonce: u64, recipient: Pubkey) -> Instruction {
    let owner = p.owner.pubkey();
    ix(
        instruction::ReclaimExpiredRunBudget { _nonce: nonce },
        accounts::ReclaimExpiredRunBudget {
            budget: p.budget(0),
            run: pda(purrps_game::RUN_GAME_SEED, owner, nonce),
            run_escrow: pda(purrps_game::RUN_ESCROW_SEED, owner, nonce),
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
