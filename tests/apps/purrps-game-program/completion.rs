use super::{
    returned_settlement::{reserved, settlement, terminal_fixture},
    *,
};
use anchor_lang::{
    solana_program::{instruction::AccountMeta, system_program},
    ToAccountMetas,
};
use ephemeral_rollups_sdk::{
    anchor::{DelegationProgram, MagicProgram},
    consts::MAGIC_CONTEXT_ID,
    instruction_builder::{call_handler, call_handler_v2},
    pda::validator_fees_vault_pda_from_validator,
    CallHandlerArgs,
};
use purrps_game::{
    accounts, instruction,
    instructions::{completion_balance, COMPLETION_ESCROW_INDEX},
    protocol::TerminalReason,
    state::records::ResultReceipt,
};
use solana_message::{Message, VersionedMessage};
use solana_transaction::versioned::VersionedTransaction;
use std::{fs, str::FromStr};

#[test]
fn action_dispatch_rejects_a_wallet_and_completion_funding_is_scoped_once() {
    let mut p = reserved();
    let (run, run_escrow) = terminal_fixture(&mut p, TerminalReason::Crash, 0);
    let budget = p.budget(0);
    let balance = completion_balance(run);
    let fund = |sponsor, action_balance| {
        ix(
            instruction::FundRunCompletion {},
            accounts::FundRunCompletion {
                run_escrow,
                budget,
                sponsor,
                action_balance,
            },
        )
    };
    rejected(
        p.h.send(fund(p.key.pubkey(), balance), &p.key),
        "InvalidSponsorBudget",
    );
    rejected(
        p.h.send(fund(p.sponsor.pubkey(), p.key.pubkey()), &p.sponsor),
        "InvalidSponsorBudget",
    );
    p.h.send(fund(p.sponsor.pubkey(), balance), &p.sponsor)
        .unwrap();
    assert_eq!(p.h.svm.get_balance(&balance), Some(1_000_000));
    assert_eq!(p.h.read::<SponsorBudget>(budget).spent_lamports, 1_000_000);
    rejected(
        p.h.send(fund(p.sponsor.pubkey(), balance), &p.sponsor),
        "InvalidSponsorBudget",
    );
    let result = settlement(&p, 0);
    let receipt = result.settlement.receipt;
    let wrong = ix(
        instruction::SettleRunAction {},
        accounts::SettleRunAction {
            settlement: result.settlement,
            leaderboard: result.leaderboard,
            system_program: result.system_program,
            instructions: solana_instructions_sysvar::ID,
            escrow_auth: run,
            escrow: p.key.pubkey(),
        },
    );
    rejected(p.h.send(wrong, &p.key), "InvalidCompletionAction");
    assert!(p.h.svm.get_account(&receipt).is_none());
    assert_eq!(
        p.h.read::<RunEscrow>(run_escrow).status,
        EscrowStatus::Reserved
    );
}

#[test]
fn completion_guard_checks_terminal_and_failed_provider_cpi_restores_state() {
    let mut p = reserved();
    let (run, run_escrow) = terminal_fixture(&mut p, TerminalReason::Crash, 0);
    let payer = p.key.pubkey();
    p.h.svm
        .add_program(
            MagicProgram::id(),
            include_bytes!(concat!(
                env!("CARGO_TARGET_TMPDIR"),
                "/../deploy/purrps_game.so"
            )),
        )
        .unwrap();
    let mut ctx = p.h.svm.get_account(&payer).unwrap();
    ctx.owner = MagicProgram::id();
    p.h.svm.set_account(MAGIC_CONTEXT_ID, ctx).unwrap();
    let balance = completion_balance(run);
    let budget = p.budget(0);
    let leaderboard = settlement(&p, 0).leaderboard;
    let request = |expected_attempt| {
        ix(
            instruction::RequestCompletion { expected_attempt },
            accounts::RequestCompletion {
                run_escrow,
                run,
                budget,
                action_balance: balance,
                leaderboard,
                payer,
                magic_context: MAGIC_CONTEXT_ID,
                magic_program: MagicProgram::id(),
            },
        )
    };
    rejected(p.h.send(request(1), &p.key), "InvalidSponsorBudget");
    let fields = [run, run_escrow, p.player, p.house, budget];
    let initial = fields.map(|key| account_bytes(&p, key));
    rejected(p.h.send(request(0), &p.key), "DeclaredProgramIdMismatch");
    assert_eq!(fields.map(|key| account_bytes(&p, key)), initial);
    p.h.svm.airdrop(&balance, 50_000_000).unwrap();
    rejected(p.h.send(request(0), &p.key), "DeclaredProgramIdMismatch");
    assert_eq!(fields.map(|key| account_bytes(&p, key)), initial);
}

#[test]
#[ignore = "requires read-only Devnet delegation program and validator vault snapshots"]
fn devnet_dlp_executes_pinned_actions_and_reclaims_unused_sol() {
    let snapshot = |name| fs::read(std::env::var(name).unwrap()).unwrap();
    let provider = snapshot("PURRPS_DLP_PROGRAM_SNAPSHOT");
    let fee_bytes = snapshot("PURRPS_DLP_FEE_VAULT_SNAPSHOT");
    let validator = Pubkey::from_str(
        std::str::from_utf8(&snapshot("PURRPS_DLP_VALIDATOR_SNAPSHOT"))
            .unwrap()
            .trim(),
    )
    .unwrap();
    for v2 in [false, true] {
        let mut p = reserved();
        let reason = if v2 {
            TerminalReason::CashOut
        } else {
            TerminalReason::Crash
        };
        let (run, escrow_key) = terminal_fixture(&mut p, reason, 0);
        let mut escrow: RunEscrow = p.h.read(escrow_key);
        let mut game: RunGameState = p.h.read(run);
        escrow.snapshot.oracle.validator = validator;
        escrow.snapshot_hash = snapshot_hash(&escrow.snapshot).unwrap();
        game.phase = RunPhase::CompletionRequested;
        game.crank.completion_attempts = 1;
        game.snapshot = escrow.snapshot;
        game.snapshot_hash = escrow.snapshot_hash;
        setup::put(&mut p.h, run, &game);
        setup::put(&mut p.h, escrow_key, &escrow);
        let dlp = DelegationProgram::id();
        p.h.svm.add_program(dlp, &provider).unwrap();
        p.h.svm.airdrop(&validator, 100_000_000).unwrap();
        let mut fee_account = p.h.svm.get_account(&validator).unwrap();
        fee_account.owner = dlp;
        fee_account.data = fee_bytes.clone();
        p.h.svm
            .set_account(
                validator_fees_vault_pda_from_validator(&validator),
                fee_account,
            )
            .unwrap();
        let action_balance = completion_balance(run);
        p.h.svm.airdrop(&action_balance, 50_000_000).unwrap();

        let mut result = settlement(&p, 0);
        result.settlement.payer = action_balance;
        let receipt = result.settlement.receipt;
        let mut metas = result.to_account_metas(Some(false));
        metas.push(AccountMeta::new_readonly(
            solana_instructions_sysvar::ID,
            false,
        ));
        let args = CallHandlerArgs {
            escrow_index: COMPLETION_ESCROW_INDEX,
            data: anchor_lang::InstructionData::data(&instruction::SettleRunAction {}),
        };
        let action = if v2 {
            call_handler_v2(
                validator,
                purrps_game::ID,
                purrps_game::ID,
                run,
                metas,
                args,
            )
        } else {
            call_handler(validator, purrps_game::ID, run, metas, args)
        };
        p.h.svm.expire_blockhash();
        let message = Message::new_with_blockhash(
            &[action.clone()],
            Some(&validator),
            &p.h.svm.latest_blockhash(),
        );
        // Fixture validator transaction signature. The Devnet DLP still has to
        // invoke Purrps with its real derived balance signer.
        let tx = VersionedTransaction {
            signatures: vec![Default::default(); message.header.num_required_signatures.into()],
            message: VersionedMessage::Legacy(message),
        };
        assert!(p.h.svm.send_transaction(tx.clone()).is_err());
        p.h.svm = p.h.svm.clone().with_sigverify(false);
        let result = p.h.svm.send_transaction(tx);
        p.h.svm = p.h.svm.clone().with_sigverify(true);
        if let Err(failure) = result {
            panic!("{:?}: {:?}", failure.err, failure.meta.logs);
        }
        let landed: ResultReceipt = p.h.read(receipt);
        assert_eq!(landed.terminal.reason, reason);
        assert_eq!(landed.owner, p.owner.pubkey());
        let player: PlayerAccount = p.h.read(p.player);
        assert_eq!(player.settled_runs, 1);
        assert_eq!(
            player.available_base_units,
            if v2 { 20_100_000 } else { 19_000_000 }
        );

        let budget = p.budget(0);
        let sponsor = p.sponsor.pubkey();
        let remaining = p.h.svm.get_balance(&action_balance).unwrap();
        let previous = p.h.svm.get_balance(&sponsor).unwrap();
        let reclaim = ix(
            instruction::ReclaimCompletionBalance {},
            accounts::ReclaimCompletionBalance {
                run_escrow: escrow_key,
                budget,
                run,
                sponsor,
                action_balance,
                delegation_program: dlp,
                system_program: system_program::ID,
            },
        );
        p.h.send(reclaim.clone(), &p.key).unwrap();
        p.h.send(reclaim, &p.key).unwrap();
        assert_eq!(p.h.svm.get_balance(&action_balance).unwrap_or(0), 0);
        assert_eq!(
            p.h.svm.get_balance(&sponsor).unwrap(),
            previous + remaining + 2_000_000
        );
    }
}

solana_program_runtime::declare_process_instruction!(
    CheckCompletionBundle,
    100,
    |invoke_context| {
        use magicblock_magic_program_api::{
            args::UndelegateTypeArgs, instruction::MagicBlockInstruction,
        };
        let context = invoke_context
            .transaction_context
            .get_current_instruction_context()?;
        let MagicBlockInstruction::ScheduleIntentBundle(bundle) =
            bincode::deserialize(context.get_instruction_data()).expect("valid MagicBlock ABI")
        else {
            panic!("expected a scheduler bundle");
        };
        assert!(bundle.commit.is_none());
        assert!(bundle.commit_finalize.is_none());
        assert!(bundle.commit_finalize_and_undelegate.is_none());
        assert!(bundle.standalone_actions.is_empty());
        let completion = bundle.commit_and_undelegate.expect("commit and return");
        let &[index] = completion.committed_accounts_indices().as_slice() else {
            panic!("only the game state may be committed");
        };
        let run_data = context.try_borrow_instruction_account(u16::from(index))?;
        let run = RunGameState::try_deserialize(&mut run_data.get_data()).unwrap();
        assert_eq!(run.phase, RunPhase::CompletionRequested);
        assert_eq!(run.crank.completion_attempts, 1);
        let signed = context.is_instruction_account_signer(u16::from(index))?;
        let funded = context.try_borrow_instruction_account(1)?.get_data() == [1];
        assert_eq!(
            funded,
            matches!(
                completion.undelegate_type,
                UndelegateTypeArgs::WithBaseActions { .. }
            )
        );
        match completion.undelegate_type {
            UndelegateTypeArgs::WithBaseActions { base_actions } => {
                assert!(signed);
                let [action] = base_actions.as_slice() else {
                    panic!("exactly one settlement action");
                };
                assert_eq!(action.escrow_authority, index);
                assert_eq!(action.destination_program, purrps_game::ID);
                assert_eq!(action.args.escrow_index, COMPLETION_ESCROW_INDEX);
                assert_eq!(
                    action.args.data,
                    anchor_lang::InstructionData::data(&instruction::SettleRunAction {})
                );
                assert_eq!(action.accounts[0].pubkey, run.escrow);
                assert_eq!(action.accounts[1].pubkey, run.snapshot.run);
                assert_eq!(
                    action.accounts[5].pubkey,
                    completion_balance(run.snapshot.run)
                );
                assert_eq!(action.accounts[10].pubkey, solana_instructions_sysvar::ID);
            }
            UndelegateTypeArgs::Standalone => assert!(!signed),
        }
        Ok(())
    }
);

#[test]
fn compiled_completion_schedules_one_fixed_action_or_a_bare_return() {
    for funded in [false, true] {
        let mut p = reserved();
        let (run, run_escrow) = terminal_fixture(&mut p, TerminalReason::Crash, 0);
        let payer = p.key.pubkey();
        let balance = completion_balance(run);
        if funded {
            p.h.svm.airdrop(&balance, 50_000_000).unwrap();
        }
        p.h.svm
            .add_builtin(MagicProgram::id(), CheckCompletionBundle::vm);
        // LiteSVM's custom-builtin helper initially marks the account as BPF loaded.
        let mut program = p.h.svm.get_account(&MagicProgram::id()).unwrap();
        program.owner = Pubkey::from_str("NativeLoader1111111111111111111111111111111").unwrap();
        p.h.svm.set_account(MagicProgram::id(), program).unwrap();
        let mut context = p.h.svm.get_account(&payer).unwrap();
        context.owner = MagicProgram::id();
        context.data = vec![u8::from(funded)];
        p.h.svm.set_account(MAGIC_CONTEXT_ID, context).unwrap();
        let budget = p.budget(0);
        let leaderboard = settlement(&p, 0).leaderboard;
        let request = ix(
            instruction::RequestCompletion {
                expected_attempt: 0,
            },
            accounts::RequestCompletion {
                run_escrow,
                run,
                budget,
                action_balance: balance,
                leaderboard,
                payer,
                magic_context: MAGIC_CONTEXT_ID,
                magic_program: MagicProgram::id(),
            },
        );
        let before: RunGameState = p.h.read(run);
        p.h.send(request.clone(), &p.key).unwrap();
        let after: RunGameState = p.h.read(run);
        assert_eq!(after.phase, RunPhase::CompletionRequested);
        assert_eq!(after.terminal, before.terminal);
        assert_eq!(after.crank.completion_attempts, 1);
        rejected(p.h.send(request, &p.key), "InvalidSponsorBudget");
    }
}
