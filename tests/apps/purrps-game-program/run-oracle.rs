use super::*;
use purrps_game::{accounts, instruction, state::run::OracleObservation};
use std::fs;

#[test]
fn inspection_uses_the_reserved_source_and_sequences_only_new_observations() {
    let mut p = Play::new();
    p.authorize();
    p.admit_fixture();
    p.fund(0);
    p.reserve(0).unwrap();
    let run_key = pda(purrps_game::RUN_GAME_SEED, p.owner.pubkey(), 0);
    let mut run: RunGameState = p.h.read(run_key);
    let oracle = run.snapshot.oracle;
    let bytes = fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../../tests/fixtures/providers/oracle-v3-full.hex"
    ))
    .unwrap();
    let original = bytes
        .trim()
        .as_bytes()
        .chunks_exact(2)
        .map(|pair| u8::from_str_radix(std::str::from_utf8(pair).unwrap(), 16).unwrap())
        .collect::<Vec<_>>();
    let mut account = p.h.svm.get_account(&p.key.pubkey()).unwrap();
    account.owner = oracle.program;
    account.data = original.clone();
    p.h.svm
        .set_account(oracle.account, account.clone())
        .unwrap();
    let inspect = |price_update| {
        ix(
            instruction::InspectRunOracle {},
            accounts::InspectRunOracle {
                state: accounts::InspectRun { run: run_key },
                price_update,
            },
        )
    };
    let decode = |result: litesvm::types::TransactionMetadata| {
        OracleObservation::try_from_slice(&result.return_data.data).unwrap()
    };
    let wrong_address = Pubkey::new_unique();
    p.h.svm.set_account(wrong_address, account.clone()).unwrap();
    rejected(
        p.h.send(inspect(wrong_address), &p.key),
        "InvalidOracleData",
    );
    let before = account_bytes(&p, run_key);
    let first = decode(p.h.send(inspect(oracle.account), &p.key).unwrap());
    assert_eq!(first.sequence, 1);
    assert_eq!(account_bytes(&p, run_key), before);

    run.observation_head = 15;
    run.observation_count = 2;
    run.observations[15] = first;
    let latest = OracleObservation {
        sequence: 2,
        ..first
    };
    run.observations[0] = latest;
    run.start_observation = Some(first);
    setup::put(&mut p.h, run_key, &run);
    let before = account_bytes(&p, run_key);
    assert_eq!(
        decode(p.h.send(inspect(oracle.account), &p.key).unwrap()),
        latest
    );
    // A price change at the same observation position is conflicting.
    account.data[73..81].copy_from_slice(&(first.price + 1).to_le_bytes());
    p.h.svm
        .set_account(oracle.account, account.clone())
        .unwrap();
    rejected(
        p.h.send(inspect(oracle.account), &p.key),
        "InvalidOracleData",
    );
    // A newer slot in the same second is a distinct observation.
    account.data[125..133].copy_from_slice(&(first.posted_slot + 1).to_le_bytes());
    let mut clock: Clock = p.h.svm.get_sysvar();
    clock.slot = first.posted_slot + 1;
    p.h.svm.set_sysvar(&clock);
    p.h.svm.set_account(oracle.account, account).unwrap();
    let next = decode(p.h.send(inspect(oracle.account), &p.key).unwrap());
    assert_eq!(next.sequence, 3);
    assert_eq!(next.published_at_seconds, first.published_at_seconds);
    assert_eq!(next.price, first.price + 1);
    assert_eq!(account_bytes(&p, run_key), before);
}
