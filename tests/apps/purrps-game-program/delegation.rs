use super::{
    returned_settlement::{reserved, settlement},
    *,
};
use anchor_lang::solana_program::{instruction::Instruction, system_program};
use ephemeral_rollups_sdk::{
    anchor::{DelegationProgram, MagicProgram},
    consts::{DEFAULT_VALIDATOR_IDENTITY, MAGIC_CONTEXT_ID},
    dlp_api::{args::CommitFinalizeArgs, state::DelegationRecord},
    instruction_builder::{commit_finalize, init_protocol_fees_vault, undelegate},
    pda::{
        delegation_metadata_pda_from_delegated_account,
        delegation_record_pda_from_delegated_account, undelegate_buffer_pda_from_delegated_account,
        validator_fees_vault_pda_from_validator, DELEGATE_BUFFER_TAG,
    },
};
use purrps_game::{
    accounts, instruction,
    protocol::{FaultReason, TerminalReason},
};
use solana_message::{Message, VersionedMessage};
use solana_transaction::versioned::VersionedTransaction;

fn delegation(p: &Play, authority: Pubkey, nonce: u64, epoch: u64) -> Instruction {
    let owner = p.owner.pubkey();
    let run = pda(purrps_game::RUN_GAME_SEED, owner, 0);
    ix(
        instruction::DelegateRun {
            args: RunIdentityArgs {
                nonce,
                delegation_epoch: epoch,
            },
        },
        accounts::DelegateRun {
            config: p.h.config,
            escrow: pda(purrps_game::RUN_ESCROW_SEED, owner, 0),
            run,
            authority,
            payer: authority,
            owner_program: purrps_game::ID,
            buffer: Pubkey::find_program_address(
                &[DELEGATE_BUFFER_TAG, run.as_ref()],
                &purrps_game::ID,
            )
            .0,
            delegation_record: delegation_record_pda_from_delegated_account(&run),
            delegation_metadata: delegation_metadata_pda_from_delegated_account(&run),
            delegation_program: DelegationProgram::id(),
            system_program: system_program::ID,
        },
    )
}

#[test]
fn delegation_rejects_wrong_scope_and_rolls_back_failed_sdk_cpi() {
    let mut p = reserved();
    let delegation_program = DelegationProgram::id();
    p.h.svm
        .add_program(
            delegation_program,
            include_bytes!(concat!(
                env!("CARGO_TARGET_TMPDIR"),
                "/../deploy/purrps_game.so"
            )),
        )
        .unwrap();
    let run = pda(purrps_game::RUN_GAME_SEED, p.owner.pubkey(), 0);
    let escrow = pda(purrps_game::RUN_ESCROW_SEED, p.owner.pubkey(), 0);
    let watched = [run, escrow, p.house, p.vault, p.player];
    let before = watched.map(|key| account_bytes(&p, key));
    let wrong_owner = delegation(&p, p.sponsor.pubkey(), 0, 1);
    rejected(p.h.send(wrong_owner, &p.sponsor), "InvalidSession");
    for (nonce, epoch) in [(1, 1), (0, 2)] {
        let stale = delegation(&p, p.key.pubkey(), nonce, epoch);
        rejected(p.h.send(stale, &p.key), "InvalidRun");
    }
    let delegate = delegation(&p, p.key.pubkey(), 0, 1);
    rejected(
        p.h.send(delegate.clone(), &p.key),
        "DeclaredProgramIdMismatch",
    );
    assert_eq!(watched.map(|key| account_bytes(&p, key)), before);
    assert!(p
        .h
        .svm
        .get_account(&delegation_record_pda_from_delegated_account(&run))
        .is_none());
    let mut clock: Clock = p.h.svm.get_sysvar();
    clock.unix_timestamp = NOW + 300;
    p.h.svm.set_sysvar(&clock);
    rejected(p.h.send(delegate, &p.key), "InvalidRun");
}

#[test]
fn only_runtime_authenticated_expiry_can_create_a_delegated_refund_terminal() {
    let mut p = reserved();
    let run = pda(purrps_game::RUN_GAME_SEED, p.owner.pubkey(), 0);
    let escrow_key = pda(purrps_game::RUN_ESCROW_SEED, p.owner.pubkey(), 0);
    let mut escrow: RunEscrow = p.h.read(escrow_key);
    escrow.delegation_initiated = true;
    setup::put(&mut p.h, escrow_key, &escrow);
    let expiry = ix(
        instruction::ExpireDelegatedActivation {},
        accounts::ExpireDelegatedActivation {
            escrow: escrow_key,
            run,
            magic_context: MAGIC_CONTEXT_ID,
        },
    );
    assert!(p.h.send(expiry.clone(), &p.key).is_err());
    let mut context = p.h.svm.get_account(&p.key.pubkey()).unwrap();
    context.owner = MagicProgram::id();
    p.h.svm.set_account(MAGIC_CONTEXT_ID, context).unwrap();
    let mut clock: Clock = p.h.svm.get_sysvar();
    clock.unix_timestamp = NOW + 299;
    p.h.svm.set_sysvar(&clock);
    rejected(p.h.send(expiry.clone(), &p.key), "ReservationNotRefundable");
    clock.unix_timestamp += 1;
    p.h.svm.set_sysvar(&clock);
    p.h.send(expiry.clone(), &p.key).unwrap();
    let terminal = p.h.read::<RunGameState>(run).terminal.unwrap();
    assert_eq!(terminal.reason, TerminalReason::TechnicalAbort);
    assert_eq!(terminal.fault, Some(FaultReason::ActivationExpired));
    assert_eq!(terminal.refund_base_units, 1_000_000);
    assert_eq!(
        p.h.read::<PlayerAccount>(p.player).available_base_units,
        19_000_000
    );
    rejected(p.h.send(expiry, &p.key), "ReservationNotRefundable");
    // The fixture has the same program owner as an account that has returned to base.
    let accounts = settlement(&p, 0);
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

#[test]
fn returning_a_run_checks_exact_provider_buffer_signature_and_seeds() {
    let mut p = reserved();
    let owner = p.owner.pubkey();
    let run = pda(purrps_game::RUN_GAME_SEED, owner, 0);
    let buffer = undelegate_buffer_pda_from_delegated_account(&run);
    let mut saved = p.h.svm.get_account(&run).unwrap();
    let data = saved.data.clone();
    saved.owner = DelegationProgram::id();
    p.h.svm.set_account(buffer, saved.clone()).unwrap();
    let payer = p.key.pubkey();
    let both = |nonce: u64| {
        ix(
            instruction::ProcessUndelegation {
                account_seeds: vec![
                    purrps_game::RUN_GAME_SEED.to_vec(),
                    owner.to_bytes().to_vec(),
                    nonce.to_le_bytes().to_vec(),
                ],
            },
            accounts::ReturnDelegatedRun {
                base_account: run,
                buffer,
                payer,
                system_program: system_program::ID,
            },
        )
    };
    saved.owner = system_program::ID;
    saved.data.clear();
    p.h.svm.set_account(run, saved).unwrap();
    let run_transaction = |p: &mut Play, nonce| {
        p.h.svm.expire_blockhash();
        let message = Message::new_with_blockhash(
            &[both(nonce)],
            Some(&p.key.pubkey()),
            &p.h.svm.latest_blockhash(),
        );
        VersionedTransaction {
            signatures: vec![Default::default(); message.header.num_required_signatures.into()],
            message: VersionedMessage::Legacy(message),
        }
    };
    let expected = run_transaction(&mut p, 0);
    assert!(p.h.svm.send_transaction(expected.clone()).is_err());
    p.h.svm = p.h.svm.clone().with_sigverify(false);
    let wrong = run_transaction(&mut p, 1);
    rejected(p.h.svm.send_transaction(wrong), "InvalidRun");
    let authenticated = run_transaction(&mut p, 0);
    p.h.svm.send_transaction(authenticated).unwrap();
    let returned = p.h.svm.get_account(&run).unwrap();
    assert_eq!(returned.owner, purrps_game::ID);
    assert_eq!(returned.data, data);
}

#[test]
#[ignore = "requires the Devnet Delegation Program and fee-vault snapshots"]
fn deployed_provider_round_trips_only_the_run_and_refunds_the_same_stake() {
    let mut p = Play::new();
    let mut config: GameConfig = p.h.read(p.h.config);
    config.oracle_bindings[2].validator = DEFAULT_VALIDATOR_IDENTITY;
    let config_key = p.h.config;
    setup::put(&mut p.h, config_key, &config);
    p.authorize();
    p.admit_fixture();
    p.fund(0);
    p.reserve(0).unwrap();
    let owner = p.owner.pubkey();
    let run = pda(purrps_game::RUN_GAME_SEED, owner, 0);
    let escrow = pda(purrps_game::RUN_ESCROW_SEED, owner, 0);
    let original = account_bytes(&p, run);
    let base = [p.player, p.house, p.vault, p.budget(0)];
    let before = base.map(|key| account_bytes(&p, key));
    let dlp = DelegationProgram::id();
    let provider = std::fs::read(std::env::var("PURRPS_DLP_PROGRAM_SNAPSHOT").unwrap()).unwrap();
    p.h.svm.add_program(dlp, &provider).unwrap();
    let delegate = delegation(&p, p.key.pubkey(), 0, 1);
    p.h.send(delegate.clone(), &p.key).unwrap();
    let delegated = p.h.svm.get_account(&run).unwrap();
    assert_eq!(delegated.owner, dlp);
    assert_eq!(delegated.data, original);
    assert_eq!(p.h.svm.get_account(&escrow).unwrap().owner, purrps_game::ID);
    assert!(p.h.read::<RunEscrow>(escrow).delegation_initiated);
    let account =
        p.h.svm
            .get_account(&delegation_record_pda_from_delegated_account(&run))
            .unwrap();
    let record = DelegationRecord::try_from_bytes_with_discriminator(&account.data).unwrap();
    assert_eq!(record.authority, DEFAULT_VALIDATOR_IDENTITY);
    assert_eq!(record.owner, purrps_game::ID);
    assert_eq!(record.commit_frequency_ms, u64::from(u32::MAX));
    assert_eq!(base.map(|key| account_bytes(&p, key)), before);
    assert!(p.h.send(delegate, &p.key).is_err());

    // Model the ER's owned copy in a separate bank while base retains the delegated mirror.
    let base_svm = p.h.svm.clone();
    let mut reflected = delegated.clone();
    reflected.owner = purrps_game::ID;
    p.h.svm.set_account(run, reflected).unwrap();
    let mut context = p.h.svm.get_account(&p.key.pubkey()).unwrap();
    context.owner = MagicProgram::id();
    p.h.svm.set_account(MAGIC_CONTEXT_ID, context).unwrap();
    let mut clock: Clock = p.h.svm.get_sysvar();
    clock.unix_timestamp = NOW + 300;
    p.h.svm.set_sysvar(&clock);
    p.h.send(
        ix(
            instruction::ExpireDelegatedActivation {},
            accounts::ExpireDelegatedActivation {
                escrow,
                run,
                magic_context: MAGIC_CONTEXT_ID,
            },
        ),
        &p.key,
    )
    .unwrap();
    let final_state = account_bytes(&p, run);
    p.h.svm = base_svm;

    let validator = DEFAULT_VALIDATOR_IDENTITY;
    p.h.svm.airdrop(&validator, 2_000_000_000).unwrap();
    let mut vault = p.h.svm.get_account(&validator).unwrap();
    vault.data = std::fs::read(std::env::var("PURRPS_DLP_FEE_VAULT_SNAPSHOT").unwrap()).unwrap();
    vault.owner = dlp;
    p.h.svm
        .set_account(validator_fees_vault_pda_from_validator(&validator), vault)
        .unwrap();
    p.h.send(init_protocol_fees_vault(p.key.pubkey()), &p.key)
        .unwrap();
    let mut args = CommitFinalizeArgs {
        commit_id: 1,
        lamports: delegated.lamports,
        allow_undelegation: true.into(),
        data_is_diff: false.into(),
        bumps: Default::default(),
        reserved_padding: [0; 3],
    };
    let (commit, _) = commit_finalize(validator, run, &mut args, &final_state);
    let return_run = undelegate(validator, run, purrps_game::ID, p.key.pubkey());
    p.h.svm = p.h.svm.clone().with_sigverify(false);
    for instruction in [commit, return_run] {
        p.h.svm.expire_blockhash();
        let message = Message::new_with_blockhash(
            &[instruction],
            Some(&validator),
            &p.h.svm.latest_blockhash(),
        );
        // Model the provider's outer validator signature. The real DLP must
        // still sign the canonical undelegation buffer itself.
        let tx = VersionedTransaction {
            signatures: vec![Default::default(); message.header.num_required_signatures.into()],
            message: VersionedMessage::Legacy(message),
        };
        p.h.svm.send_transaction(tx).unwrap();
    }
    p.h.svm = p.h.svm.clone().with_sigverify(true);
    let returned = p.h.svm.get_account(&run).unwrap();
    assert_eq!(returned.owner, purrps_game::ID);
    assert_eq!(returned.data, final_state);
    let accounts = settlement(&p, 0);
    p.h.send(ix(instruction::SettleReturnedRun {}, accounts), &p.key)
        .unwrap();
    assert_eq!(
        p.h.read::<RunEscrow>(escrow).status,
        EscrowStatus::RefundedTechnical
    );
    assert_eq!(
        p.h.read::<PlayerAccount>(p.player).available_base_units,
        20_000_000
    );
}
