use super::{
    returned_settlement::{reserved, settlement},
    *,
};
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use ephemeral_rollups_sdk::consts::{EPHEMERAL_VAULT_ID, MAGIC_CONTEXT_ID, MAGIC_PROGRAM_ID};
use hydra_api::consts::ephemeral::ID as HYDRA_ID;
use magicblock_magic_program_api::instruction::MagicBlockInstruction;
use purrps_game::{
    accounts, instruction,
    instructions::{completion_balance, task_address, CRANK_RENT_HEADROOM},
    protocol::{FaultReason, TerminalReason},
};
use solana_message::{Message, VersionedMessage};
use solana_transaction::versioned::VersionedTransaction;

solana_program_runtime::declare_process_instruction!(MagicAllocationFixture, 100, |vm| {
    // The production native Magic program can allocate zero-lamport ephemeral
    // accounts. LiteSVM models that allocation with a pre-funded Magic account.
    let ctx = vm.transaction_context.get_current_instruction_context()?;
    let instruction =
        bincode::deserialize(ctx.get_instruction_data()).expect("Magic allocation ABI");
    if let MagicBlockInstruction::ScheduleIntentBundle(bundle) = instruction {
        let completion = bundle.commit_and_undelegate.expect("commit and return");
        let &[index] = completion.committed_accounts_indices().as_slice() else {
            panic!("only the game state may be committed");
        };
        let run = ctx.try_borrow_instruction_account(u16::from(index))?;
        let state = RunGameState::try_deserialize(&mut run.get_data()).unwrap();
        assert_eq!(state.phase, RunPhase::CompletionRequested);
        return Ok(());
    }
    let sponsor = ctx.try_borrow_instruction_account(0)?;
    assert_eq!(*sponsor.get_owner(), purrps_game::ID);
    drop(sponsor);
    assert!(ctx.is_instruction_account_signer(0)?);
    assert_eq!(
        *ctx.try_borrow_instruction_account(2)?.get_key(),
        EPHEMERAL_VAULT_ID
    );
    let mut crank = ctx.try_borrow_instruction_account(1)?;
    match instruction {
        MagicBlockInstruction::CreateEphemeralAccount { data_len } => {
            assert!(ctx.is_instruction_account_signer(1)?);
            crank.set_data_length(data_len as usize)?;
            crank.set_owner(HYDRA_ID.as_ref())
        }
        MagicBlockInstruction::CloseEphemeralAccount => {
            assert_eq!(*crank.get_owner(), HYDRA_ID);
            // Hydra already drained the test allocation. The zero-balance
            // fixture is removed at commit.
            assert_eq!(crank.get_lamports(), 0);
            Ok(())
        }
        _ => panic!("unexpected MagicBlock instruction"),
    }
});

fn send_crank(p: &mut Play, instructions: &[Instruction]) -> litesvm::types::TransactionResult {
    p.h.svm.expire_blockhash();
    let message = Message::new_with_blockhash(
        instructions,
        Some(&p.sponsor.pubkey()),
        &p.h.svm.latest_blockhash(),
    );
    let tx =
        VersionedTransaction::try_new(VersionedMessage::Legacy(message), &[&p.sponsor]).unwrap();
    p.h.svm.send_transaction(tx)
}

fn set_clock_and_oracle(p: &mut Play, quote: Pubkey, at: i64, slot: u64, published: i64) {
    p.h.svm.set_sysvar(&Clock {
        slot,
        unix_timestamp: at,
        ..Clock::default()
    });
    let mut data = p.h.svm.get_account(&quote).unwrap();
    data.data[93..101].copy_from_slice(&published.to_le_bytes());
    data.data[101..109].copy_from_slice(&(published - 1).to_le_bytes());
    data.data[125..133].copy_from_slice(&slot.to_le_bytes());
    p.h.svm.set_account(quote, data).unwrap();
}

#[test]
#[ignore = "requires the read-only deployed ER Hydra executable snapshot"]
fn deployed_hydra_registers_and_advances_only_trusted_elapsed_play() {
    let mut p = reserved();
    let owner = p.owner.pubkey();
    let run = pda(purrps_game::RUN_GAME_SEED, owner, 0);
    let escrow = pda(purrps_game::RUN_ESCROW_SEED, owner, 0);
    let source = p.h.read::<RunGameState>(run).snapshot.oracle;
    let crank = task_address(run);
    let mut escrow_fixture: RunEscrow = p.h.read(escrow);
    escrow_fixture.delegation_initiated = true;
    setup::put(&mut p.h, escrow, &escrow_fixture);
    let hydra = std::fs::read(std::env::var("PURRPS_HYDRA_PROGRAM_SNAPSHOT").unwrap()).unwrap();
    p.h.svm.add_program(HYDRA_ID, &hydra).unwrap();
    p.h.svm
        .add_builtin(MAGIC_PROGRAM_ID, MagicAllocationFixture::vm);
    let mut program = p.h.svm.get_account(&MAGIC_PROGRAM_ID).unwrap();
    program.owner = pubkey!("NativeLoader1111111111111111111111111111111");
    p.h.svm.set_account(MAGIC_PROGRAM_ID, program).unwrap();

    let mut fixture = p.h.svm.get_account(&owner).unwrap();
    fixture.owner = MAGIC_PROGRAM_ID;
    fixture.data.clear();
    for key in [MAGIC_CONTEXT_ID, EPHEMERAL_VAULT_ID, crank] {
        p.h.svm.set_account(key, fixture.clone()).unwrap();
    }
    let bytes = include_str!("../../fixtures/providers/oracle-v3-full.hex");
    fixture.data = bytes
        .trim()
        .as_bytes()
        .chunks_exact(2)
        .map(|pair| u8::from_str_radix(std::str::from_utf8(pair).unwrap(), 16).unwrap())
        .collect();
    fixture.owner = source.program;
    p.h.svm.set_account(source.account, fixture).unwrap();

    let start_slot = 123_456_790;
    set_clock_and_oracle(&mut p, source.account, NOW, start_slot, NOW);
    let activate = ix(
        instruction::ActivateRun {
            args: RunIdentityArgs {
                nonce: 0,
                delegation_epoch: 1,
            },
        },
        accounts::ActivateRun {
            escrow,
            run,
            play_key: p.key.pubkey(),
            price_update: source.account,
            crank,
            magic_context: MAGIC_CONTEXT_ID,
            rent_vault: EPHEMERAL_VAULT_ID,
            hydra_program: HYDRA_ID,
            magic_program: MAGIC_PROGRAM_ID,
        },
    );
    rejected(p.h.send(activate.clone(), &p.key), "InvalidSponsorBudget");
    let mut game = p.h.svm.get_account(&run).unwrap();
    game.lamports += CRANK_RENT_HEADROOM;
    p.h.svm.set_account(run, game).unwrap();
    let activation = p.h.send(activate.clone(), &p.key).unwrap();
    assert!(activation.compute_units_consumed < 200_000);
    rejected(p.h.send(activate, &p.key), "InvalidRun");
    let active: RunGameState = p.h.read(run);
    assert_eq!(
        (active.phase, active.active_ticks, active.crank.task),
        (RunPhase::Active, 0, crank)
    );

    let trigger = Instruction::new_with_bytes(
        HYDRA_ID,
        &[1],
        vec![
            AccountMeta::new(crank, false),
            AccountMeta::new(p.sponsor.pubkey(), true),
            AccountMeta::new_readonly(solana_instructions_sysvar::ID, false),
        ],
    );
    let advance = ix(
        instruction::AdvanceRun {
            args: AdvanceRunArgs {
                delegation_epoch: 1,
                task_generation: 1,
            },
        },
        accounts::AdvanceRun {
            run,
            price_update: source.account,
            crank,
            magic_context: MAGIC_CONTEXT_ID,
            instructions: solana_instructions_sysvar::ID,
        },
    );
    let pair = [trigger.clone(), advance.clone()];
    rejected(send_crank(&mut p, &[advance.clone()]), "InvalidCrank");
    assert!(
        send_crank(&mut p, &pair).is_err(),
        "not due in the activation slot"
    );
    set_clock_and_oracle(&mut p, source.account, NOW + 1, start_slot + 1, NOW + 1);
    let mut wrong_generation = advance.clone();
    *wrong_generation.data.last_mut().unwrap() = 1;
    assert!(send_crank(&mut p, &[trigger, wrong_generation]).is_err());
    send_crank(&mut p, &pair).unwrap();
    assert_eq!(p.h.read::<RunGameState>(run).active_ticks, 0);
    assert!(send_crank(&mut p, &pair).is_err(), "same-slot retry");
    for offset in 0..11 {
        set_clock_and_oracle(
            &mut p,
            source.account,
            NOW + 2,
            start_slot + 20 + offset,
            NOW + 2,
        );
        let outcome = send_crank(&mut p, &pair).unwrap();
        eprintln!(
            "Hydra plus callback CUs: {}",
            outcome.compute_units_consumed
        );
        assert!(outcome.compute_units_consumed < 600_000);
        assert_eq!(
            p.h.read::<RunGameState>(run).active_ticks,
            (offset + 1).min(10) * 6
        );
    }

    set_clock_and_oracle(&mut p, source.account, NOW + 4, start_slot + 60, NOW + 4);
    let delayed = send_crank(&mut p, &pair).unwrap();
    assert!(delayed.compute_units_consumed < 600_000);
    assert_eq!(p.h.read::<RunGameState>(run).active_ticks, 66);

    set_clock_and_oracle(&mut p, source.account, NOW + 5, start_slot + 80, NOW + 5);
    send_crank(&mut p, &pair).unwrap();
    let paused = p.h.read::<RunGameState>(run);
    assert_eq!(paused.suspension.unwrap().reason, FaultReason::SchedulerGap);
    assert_eq!(paused.active_ticks, 66);
    set_clock_and_oracle(&mut p, source.account, NOW + 6, start_slot + 100, NOW + 6);
    send_crank(&mut p, &pair).unwrap();
    assert_eq!(p.h.read::<RunGameState>(run).phase, RunPhase::Suspended);
    let recover_accounts = accounts::RecoverRunOracle {
        run,
        price_update: source.account,
        magic_context: MAGIC_CONTEXT_ID,
    };
    let recovery = ix(instruction::SuspendOrResumeRun {}, recover_accounts);
    p.h.send(recovery.clone(), &p.sponsor).unwrap();
    assert_eq!(p.h.read::<RunGameState>(run).phase, RunPhase::Suspended);
    let mut resume = recovery;
    resume.data = anchor_lang::InstructionData::data(&instruction::ResumeRun {
        suspended_at: NOW + 5,
    });
    rejected(p.h.send(resume.clone(), &p.sponsor), "InvalidSession");
    resume
        .accounts
        .push(AccountMeta::new_readonly(p.sponsor.pubkey(), true));
    rejected(p.h.send(resume.clone(), &p.sponsor), "InvalidSession");
    *resume.accounts.last_mut().unwrap() = AccountMeta::new_readonly(p.key.pubkey(), true);
    let mut outdated = resume.clone();
    outdated.data = anchor_lang::InstructionData::data(&instruction::ResumeRun {
        suspended_at: NOW + 4,
    });
    rejected(p.h.send(outdated, &p.key), "InvalidRun");
    p.h.send(resume, &p.key).unwrap();
    let resumed = p.h.read::<RunGameState>(run);
    assert_eq!(
        (resumed.phase, resumed.active_ticks),
        (RunPhase::Active, 66)
    );
    assert_eq!(resumed.crank.consumed_elapsed_ms, 0);
    assert_eq!(resumed.crank.clock_origin_seconds, (NOW + 6) as u64);

    set_clock_and_oracle(&mut p, source.account, NOW + 7, start_slot + 120, NOW);
    send_crank(&mut p, &pair).unwrap();
    let suspended = p.h.read::<RunGameState>(run).suspension.unwrap();
    assert_eq!(suspended.reason, FaultReason::OracleStale);
    set_clock_and_oracle(&mut p, source.account, NOW + 307, start_slot + 6000, NOW);
    send_crank(&mut p, &pair).unwrap();
    let terminal = p.h.read::<RunGameState>(run);
    assert_eq!(
        terminal.terminal.unwrap().reason,
        TerminalReason::TechnicalAbort
    );
    assert_eq!(terminal.terminal.unwrap().refund_base_units, 1_000_000);
    assert_eq!(terminal.active_ticks, 66);
    let terminal_bytes = account_bytes(&p, run);
    set_clock_and_oracle(
        &mut p,
        source.account,
        NOW + 308,
        start_slot + 6020,
        NOW + 308,
    );
    rejected(send_crank(&mut p, &pair), "InvalidRun");
    assert_eq!(account_bytes(&p, run), terminal_bytes);

    let request = |task| {
        ix(
            instruction::RequestCompletion {
                expected_attempt: 0,
            },
            accounts::RequestCompletion {
                run_escrow: escrow,
                run,
                budget: p.budget(0),
                action_balance: completion_balance(run),
                leaderboard: settlement(&p, 0).leaderboard,
                payer: p.sponsor.pubkey(),
                magic_context: MAGIC_CONTEXT_ID,
                magic_program: MAGIC_PROGRAM_ID,
                crank: task,
                rent_vault: Some(EPHEMERAL_VAULT_ID),
                hydra_program: Some(HYDRA_ID),
            },
        )
    };
    let omitted = request(None);
    let complete = request(Some(crank));
    rejected(send_crank(&mut p, &[omitted]), "InvalidCrank");
    send_crank(&mut p, &[complete]).unwrap();
    assert!(p.h.svm.get_account(&crank).is_none());
    let completed = p.h.read::<RunGameState>(run);
    assert_eq!(completed.phase, RunPhase::CompletionRequested);
    assert_eq!(completed.terminal, terminal.terminal);
}
