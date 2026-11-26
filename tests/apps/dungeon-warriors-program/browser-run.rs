use super::*;
use anchor_lang::solana_program::system_program;
use ephemeral_rollups_sdk::consts::{MAGIC_CONTEXT_ID, MAGIC_PROGRAM_ID};
use dungeon_warriors::{
    accounts, instruction,
    instructions::browser_run::{BrowserResult, BROWSER_VERIFIER_SEED},
    protocol::TerminalReason, rules::RULES_V4,
    state::records::ResultReceipt,
};

#[test]
fn browser_result_requires_the_verifier_and_cannot_replace_a_terminal_or_exceed_time() {
    let mut p = returned_settlement::reserved();
    let (run_key, escrow_key) = returned_settlement::terminal_fixture(
        &mut p, TerminalReason::CashOut, 0);
    let verifier_key = Pubkey::find_program_address(&[BROWSER_VERIFIER_SEED], &dungeon_warriors::ID).0;
    let admin = setup::admin(&p.h);
    let configure = ix(
        instruction::ConfigureBrowserVerifier { authority: p.key.pubkey() },
        accounts::ConfigureBrowserVerifier {
            config:p.h.config,admin:admin.pubkey(),browser_verifier:verifier_key,
            system_program:system_program::ID,
        });
    p.h.send(configure, &admin).unwrap();
    let mut context = p.h.svm.get_account(&p.owner.pubkey()).unwrap();
    context.owner = MAGIC_PROGRAM_ID;
    context.data.clear();
    p.h.svm.set_account(MAGIC_CONTEXT_ID,context).unwrap();
    let mut escrow: RunEscrow=p.h.read(escrow_key);
    let mut run:RunGameState=p.h.read(run_key);
    run.snapshot.rules=RULES_V4;
    run.snapshot.rules_binding=dungeon_warriors::publication::rules_binding(&RULES_V4).unwrap();
    run.snapshot_hash=snapshot_hash(&run.snapshot).unwrap();
    escrow.snapshot=run.snapshot;
    escrow.snapshot_hash=run.snapshot_hash;
    run.phase=RunPhase::Active;
    run.terminal=None;
    run.active_ticks=0;
    run.qualified_checkpoints=0;
    run.total_coins=0;
    run.score=0;
    run.crank.clock_origin_seconds=(NOW-20) as u64;
    setup::put(&mut p.h,run_key,&run);
    setup::put(&mut p.h,escrow_key,&escrow);
    let args=BrowserResult {
        snapshot_hash:run.snapshot_hash,reason:TerminalReason::AutoCashOut,active_ticks:601,
        score:7,coins:3,qualified_checkpoints:1,final_observation:run.start_observation.unwrap(),
    };
    let instruction_for=|authority:Pubkey,args:BrowserResult| ix(
        instruction::RecordBrowserResult {args},
        accounts::RecordBrowserResult {
            run:run_key,browser_verifier:verifier_key,authority,magic_context:MAGIC_CONTEXT_ID,
        });
    let attacker=Keypair::new();
    p.h.svm.airdrop(&attacker.pubkey(),100_000_000).unwrap();
    assert!(p.h.send(instruction_for(attacker.pubkey(),args.clone()),&attacker).is_err());
    let mut accelerated=args.clone();
    accelerated.active_ticks=12_000;
    rejected(p.h.send(instruction_for(p.key.pubkey(),accelerated),&p.key),"InvalidRun");
    assert_eq!(p.h.read::<RunGameState>(run_key).phase,RunPhase::Active);
    let accepted=instruction_for(p.key.pubkey(),args);
    p.h.send(accepted.clone(),&p.key).unwrap();
    let final_run:RunGameState=p.h.read(run_key);
    assert_eq!(final_run.terminal.unwrap().gross_payout_base_units,1_100_000);
    rejected(p.h.send(accepted,&p.key),"InvalidRun");
    let settlement=returned_settlement::settlement(&p,0);
    let receipt=settlement.settlement.receipt;
    p.h.send(ix(instruction::SettleReturnedRun {},settlement),&p.key).unwrap();
    assert_eq!(p.h.read::<ResultReceipt>(receipt).terminal.gross_payout_base_units,1_100_000);
}
