use super::*;

#[test]
fn arithmetic_and_nonce_boundaries_cannot_wrap_or_leave_partial_reservations() {
    let mut p = Play::new();
    p.authorize();
    p.admit_fixture();
    p.fund(0);
    let original_auth = p.h.svm.get_account(&p.authorization).unwrap();
    let mut auth: SessionAuthorization = p.h.read(p.authorization);
    auth.spent_base_units = u64::MAX;
    auth.allowance_base_units = u64::MAX;
    setup::put(&mut p.h, p.authorization, &auth);
    rejected(p.reserve(0), "ArithmeticOverflow");
    no_run(&p, 0);
    auth.spent_base_units = 0;
    setup::put(&mut p.h, p.authorization, &auth);
    let mut args = p.args(0);
    args.stake_base_units = u64::MAX;
    rejected(
        p.h.send(p.reserve_ix(args, p.key.pubkey()), &p.key),
        "ArithmeticOverflow",
    );
    no_run(&p, 0);
    p.h.svm.set_account(p.authorization, original_auth).unwrap();
    let mut player: PlayerAccount = p.h.read(p.player);
    player.next_run_nonce = u64::MAX;
    setup::put(&mut p.h, p.player, &player);
    p.fund(u64::MAX);
    let before = account_bytes(&p, p.player);
    rejected(p.reserve(u64::MAX), "ArithmeticOverflow");
    no_run(&p, u64::MAX);
    assert_eq!(account_bytes(&p, p.player), before);
    player.next_run_nonce = 0;
    player.locked_stake_base_units = u64::MAX;
    setup::put(&mut p.h, p.player, &player);
    rejected(p.reserve(0), "ArithmeticOverflow");
    no_run(&p, 0);
}

#[test]
fn reservation_rechecks_external_session_scope_and_published_version_cas() {
    let mut p = Play::new();
    p.authorize();
    p.admit_fixture();
    p.fund(0);
    for version in 0..2 {
        let mut args = p.args(0);
        if version == 0 {
            args.expected_rules_version = 2;
        } else {
            args.expected_catalog_version = 2;
        }
        rejected(
            p.h.send(p.reserve_ix(args, p.key.pubkey()), &p.key),
            "StaleVersion",
        );
        no_run(&p, 0);
    }
    let original = p.h.svm.get_account(&p.token).unwrap();
    for offset in [8, 40, 72] {
        let mut account = original.clone();
        account.data[offset..offset + 32].copy_from_slice(Keypair::new().pubkey().as_ref());
        p.h.svm.set_account(p.token, account).unwrap();
        rejected(p.reserve(0), "InvalidSession");
        no_run(&p, 0);
    }
    let mut expired = original.clone();
    expired.data[104..112].copy_from_slice(&NOW.to_le_bytes());
    p.h.svm.set_account(p.token, expired).unwrap();
    rejected(p.reserve(0), "InvalidSession");
    no_run(&p, 0);
    let mut wrong_owner = original.clone();
    wrong_owner.owner = dungeon_warriors::ID;
    p.h.svm.set_account(p.token, wrong_owner).unwrap();
    rejected(p.reserve(0), "AccountOwnedByWrongProgram");
    no_run(&p, 0);
    p.h.svm.set_account(p.token, original).unwrap();
    p.reserve(0).unwrap();
    rejected(p.reserve(0), "already in use");
    assert_eq!(
        p.h.read::<SessionAuthorization>(p.authorization)
            .spent_base_units,
        1_000_000
    );
}
