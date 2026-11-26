use super::*;
use dungeon_warriors::dungeon_result_hash;
use dungeon_warriors::instructions::dungeon_delivery::{
    DungeonSettlement, DUNGEON_SETTLEMENT_SEED,
};

solana_program_runtime::declare_process_instruction!(DungeonCommitFixture, 100, |vm| {
    use magicblock_magic_program_api::instruction::MagicBlockInstruction;

    let ctx = vm.transaction_context.get_current_instruction_context()?;
    let instruction = bincode::deserialize(ctx.get_instruction_data()).unwrap();
    let MagicBlockInstruction::ScheduleIntentBundle(bundle) = instruction else {
        panic!("expected settlement commit and undelegate");
    };
    let completion = bundle.commit_and_undelegate.unwrap();
    let indices = completion.committed_accounts_indices();
    assert_eq!(indices.len(), 1);
    let receipt = ctx.try_borrow_instruction_account(u16::from(indices[0]))?;
    let saved = DungeonSettlement::try_deserialize(&mut receipt.get_data()).unwrap();
    assert!(saved.result.is_some());
    Ok(())
});

#[test]
#[ignore = "requires public Devnet Hydra, Delegation Program and validator fee-vault snapshots"]
fn deployed_providers_return_a_dungeon_receipt_and_crank_exactly_one_payout() {
    use ephemeral_rollups_sdk::{
        consts::{
            DEFAULT_VALIDATOR_IDENTITY, DELEGATION_PROGRAM_ID, MAGIC_CONTEXT_ID, MAGIC_PROGRAM_ID,
        },
        dlp_api::args::CommitFinalizeArgs,
        instruction_builder::{commit_finalize, init_protocol_fees_vault, undelegate},
        pda::{
            delegation_metadata_pda_from_delegated_account,
            delegation_record_pda_from_delegated_account, validator_fees_vault_pda_from_validator,
            DELEGATE_BUFFER_TAG,
        },
    };

    let mut p = Play::new();
    let expedition = fixture(&mut p, true);
    let verifier = p.key.pubkey();
    let validator = DEFAULT_VALIDATOR_IDENTITY;
    let hydra = hydra_api::base::ID;
    let receipt = Pubkey::find_program_address(
        &[DUNGEON_SETTLEMENT_SEED, expedition.as_ref()],
        &dungeon_warriors::ID,
    )
    .0;
    let crank = hydra_api::state::find_base_crank_pda(&verifier.to_bytes(), &receipt.to_bytes()).0;
    let snapshot = |name| std::fs::read(std::env::var(name).unwrap()).unwrap();
    p.h.svm
        .add_program(hydra, &snapshot("DUNGEON_WARRIORS_BASE_HYDRA_SNAPSHOT"))
        .unwrap();
    p.h.svm
        .add_program(
            DELEGATION_PROGRAM_ID,
            &snapshot("DUNGEON_WARRIORS_DLP_PROGRAM_SNAPSHOT"),
        )
        .unwrap();

    let trap = trap_gate(&expedition, &RANDOM, &SECRET, 0).unwrap();
    let safe = (trap + 1) % 3;
    let proof = result(safe, 0);
    let proof_hash = dungeon_result_hash(&expedition, &proof);

    let prepare = ix(
        instruction::PrepareDungeonSettlement {
            validator,
            outcome: 0,
            proof_hash,
        },
        accounts::PrepareDungeonSettlement {
            resolution: resolution(&p),
            verifier,
            payer: verifier,
            settlement: receipt,
            leaderboard: board(),
            crank,
            owner_program: dungeon_warriors::ID,
            buffer: Pubkey::find_program_address(
                &[DELEGATE_BUFFER_TAG, receipt.as_ref()],
                &dungeon_warriors::ID,
            )
            .0,
            delegation_record: delegation_record_pda_from_delegated_account(&receipt),
            delegation_metadata: delegation_metadata_pda_from_delegated_account(&receipt),
            delegation_program: DELEGATION_PROGRAM_ID,
            hydra_program: hydra,
            system_program: system_program::ID,
        },
    );
    let prepared = p.h.send(prepare, &p.key).unwrap();
    assert!(prepared.compute_units_consumed < 400_000);
    let delegated = p.h.svm.get_account(&receipt).unwrap();
    assert_eq!(delegated.owner, DELEGATION_PROGRAM_ID);
    assert_eq!(p.h.svm.get_account(&crank).unwrap().owner, hydra);
    assert_eq!(
        p.h.read::<DungeonExpedition>(expedition).status,
        DungeonStatus::Ready
    );

    assert_eq!(
        p.h.read::<DungeonExpedition>(expedition).secret,
        Some(proof_hash)
    );
    rejected(
        p.h.send(settle(&p, result((trap + 2) % 3, 0), verifier), &p.key),
        "InvalidRun",
    );

    // Model the ER's native commit entry point in a second bank. The real DLP
    // checks and restores the canonical receipt on the base bank below.
    let base = p.h.svm.clone();
    p.h.svm
        .add_builtin(MAGIC_PROGRAM_ID, DungeonCommitFixture::vm);
    let mut magic = p.h.svm.get_account(&MAGIC_PROGRAM_ID).unwrap();
    magic.owner = pubkey!("NativeLoader1111111111111111111111111111111");
    p.h.svm.set_account(MAGIC_PROGRAM_ID, magic).unwrap();
    let mut context = p.h.svm.get_account(&verifier).unwrap();
    context.owner = MAGIC_PROGRAM_ID;
    p.h.svm.set_account(MAGIC_CONTEXT_ID, context).unwrap();
    let mut reflected = delegated.clone();
    reflected.owner = dungeon_warriors::ID;
    p.h.svm.set_account(receipt, reflected).unwrap();
    let record = |result| {
        ix(
            instruction::RecordDungeonSettlement { result },
            accounts::RecordDungeonSettlement {
                settlement: receipt,
                verifier,
                payer: verifier,
                magic_context: MAGIC_CONTEXT_ID,
                magic_program: MAGIC_PROGRAM_ID,
            },
        )
    };
    rejected(p.h.send(record(result(safe, 1)), &p.key), "InvalidRun");
    p.h.send(record(proof.clone()), &p.key).unwrap();
    assert!(p.h.read::<DungeonSettlement>(receipt).result == Some(proof));
    let final_data = p.h.svm.get_account(&receipt).unwrap().data;

    p.h.svm = base;
    p.h.svm.airdrop(&validator, 2_000_000_000).unwrap();
    let mut fee_vault = p.h.svm.get_account(&validator).unwrap();
    fee_vault.data = snapshot("DUNGEON_WARRIORS_DLP_FEE_VAULT_SNAPSHOT");
    fee_vault.owner = DELEGATION_PROGRAM_ID;
    p.h.svm
        .set_account(
            validator_fees_vault_pda_from_validator(&validator),
            fee_vault,
        )
        .unwrap();
    p.h.send(init_protocol_fees_vault(verifier), &p.key)
        .unwrap();
    let mut args = CommitFinalizeArgs {
        commit_id: 1,
        lamports: delegated.lamports,
        allow_undelegation: true.into(),
        data_is_diff: false.into(),
        bumps: Default::default(),
        reserved_padding: [0; 3],
    };
    let (commit, _) = commit_finalize(validator, receipt, &mut args, &final_data);
    p.h.svm = p.h.svm.clone().with_sigverify(false);
    for instruction in [
        commit,
        undelegate(validator, receipt, dungeon_warriors::ID, verifier),
    ] {
        p.h.svm.expire_blockhash();
        let message = Message::new_with_blockhash(
            &[instruction],
            Some(&validator),
            &p.h.svm.latest_blockhash(),
        );
        let tx = VersionedTransaction {
            signatures: vec![Default::default(); message.header.num_required_signatures.into()],
            message: VersionedMessage::Legacy(message),
        };
        p.h.svm.send_transaction(tx).unwrap();
    }
    p.h.svm = p.h.svm.clone().with_sigverify(true);
    let returned = p.h.svm.get_account(&receipt).unwrap();
    assert_eq!(returned.owner, dungeon_warriors::ID);
    assert_eq!(returned.data, final_data);

    let finalize = ix(
        instruction::FinalizeDungeonSettlement { outcome: 0 },
        accounts::FinalizeDungeonSettlement {
            resolution: resolution(&p),
            settlement: receipt,
            leaderboard: board(),
            instructions: solana_instructions_sysvar::ID,
        },
    );
    rejected(p.h.send(finalize.clone(), &p.sponsor), "InvalidCrank");
    let mut clock: Clock = p.h.svm.get_sysvar();
    clock.slot += 16;
    p.h.svm.set_sysvar(&clock);
    let trigger = hydra_api::instruction::base::trigger(crank, p.sponsor.pubkey());
    let mut send = || {
        p.h.svm.expire_blockhash();
        let message = Message::new_with_blockhash(
            &[trigger.clone(), finalize.clone()],
            Some(&p.sponsor.pubkey()),
            &p.h.svm.latest_blockhash(),
        );
        let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(message), &[&p.sponsor])
            .unwrap();
        p.h.svm.send_transaction(tx)
    };
    send().unwrap();
    assert!(send().is_err());
    let e = p.h.read::<DungeonExpedition>(expedition);
    assert_eq!(e.status, DungeonStatus::Won);
    assert_eq!(e.payout, 1_425_000);
    assert_eq!(e.secret, Some(SECRET));
    let player = p.h.read::<PlayerAccount>(p.player);
    assert_eq!(player.locked_stake_base_units, 0);
    assert_eq!(player.available_base_units, 20_425_000);
    assert_eq!(player.wins, 1);
    assert_eq!(p.h.read::<Leaderboard>(board()).count, 1);
}
