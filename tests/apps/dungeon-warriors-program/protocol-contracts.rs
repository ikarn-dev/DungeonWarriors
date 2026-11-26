use anchor_lang::{prelude::Pubkey, AnchorDeserialize, AnchorSerialize};
use dungeon_warriors::protocol::{
    validate_intent_batch, InputAxis, InputPermission, IntentContext, IntentEnvelope, IntentError,
    PlayerIntent, RunPhase, PROTOCOL_VERSION,
};

const INTENTS: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../../tests/fixtures/game-v1/intents.csv"
));

#[test]
fn crank_template_binds_epoch_and_generation_without_a_caller_progress_counter() {
    let args = dungeon_warriors::instruction_args::AdvanceRunArgs {
        delegation_epoch: 4,
        task_generation: 7,
    };
    let mut bytes = Vec::new();
    args.serialize(&mut bytes).unwrap();
    assert_eq!(bytes, [4, 0, 0, 0, 0, 0, 0, 0, 7, 0, 0, 0, 0, 0, 0, 0]);
}

fn permission() -> InputPermission {
    InputPermission {
        owner: Pubkey::new_from_array([1; 32]),
        input_key: Pubkey::new_from_array([2; 32]),
        program: dungeon_warriors::id(),
        session_token: Pubkey::new_from_array([3; 32]),
        expires_at_seconds: 300,
    }
}

fn context() -> IntentContext {
    let permission = permission();
    IntentContext {
        run: Pubkey::new_from_array([42; 32]),
        owner: permission.owner,
        program: permission.program,
        signer: permission.input_key,
        rules_version: 1,
        phase: RunPhase::Active,
        now_seconds: 100,
        revoked: false,
        last_accepted_sequence: 0,
        queued_intents: 0,
        queue_capacity: 32,
    }
}

fn intent(sequence: u64, action: PlayerIntent) -> IntentEnvelope {
    IntentEnvelope {
        protocol_version: PROTOCOL_VERSION,
        rules_version: 1,
        run: Pubkey::new_from_array([42; 32]),
        client_sequence: sequence,
        action,
    }
}

fn fixture_action(name: &str, payload: &str) -> PlayerIntent {
    match name {
        "move" => PlayerIntent::Move {
            axis: match payload {
                "left" => InputAxis::Left,
                "neutral" => InputAxis::Neutral,
                "right" => InputAxis::Right,
                _ => panic!("invalid fixture axis"),
            },
        },
        "jump" => PlayerIntent::Jump,
        "dash" => PlayerIntent::Dash,
        "boost" => PlayerIntent::Boost,
        "cashOut" => PlayerIntent::CashOut,
        "surrender" => PlayerIntent::Surrender,
        "heartbeat" => PlayerIntent::Heartbeat {
            active: match payload {
                "true" => true,
                "false" => false,
                _ => panic!("invalid heartbeat fixture"),
            },
        },
        "inactive" => PlayerIntent::Inactive,
        _ => panic!("invalid fixture intent"),
    }
}

#[test]
fn signed_intent_bodies_match_the_browser_byte_for_byte() {
    for line in INTENTS.lines().skip(1) {
        let row: Vec<&str> = line.split(',').collect();
        assert_eq!(row.len(), 4);
        let envelope = intent(row[2].parse().unwrap(), fixture_action(row[0], row[1]));
        let mut bytes = Vec::new();
        envelope.serialize(&mut bytes).unwrap();
        let hex: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
        assert_eq!(hex, row[3]);
        assert_eq!(IntentEnvelope::try_from_slice(&bytes).unwrap(), envelope);
        bytes.push(0);
        assert!(IntentEnvelope::try_from_slice(&bytes).is_err());
    }
}

#[test]
fn batches_require_contiguous_sequences_and_available_queue_capacity() {
    let batch = [
        intent(1, PlayerIntent::Jump),
        intent(2, PlayerIntent::CashOut),
    ];
    assert_eq!(
        validate_intent_batch(&batch, &permission(), &context()),
        Ok(())
    );
    let mut ctx = context();
    ctx.last_accepted_sequence = 1;
    assert_eq!(
        validate_intent_batch(&batch, &permission(), &ctx),
        Err(IntentError::SequenceMismatch)
    );
    let gap = [
        intent(1, PlayerIntent::Jump),
        intent(3, PlayerIntent::CashOut),
    ];
    assert_eq!(
        validate_intent_batch(&gap, &permission(), &context()),
        Err(IntentError::SequenceMismatch)
    );
    ctx = context();
    ctx.queued_intents = 31;
    assert_eq!(
        validate_intent_batch(&batch, &permission(), &ctx),
        Err(IntentError::QueueFull)
    );
    assert_eq!(ctx.last_accepted_sequence, 0);
    ctx.queued_intents = 0;
    ctx.last_accepted_sequence = u64::MAX;
    assert_eq!(
        validate_intent_batch(&[intent(1, PlayerIntent::Jump)], &permission(), &ctx),
        Err(IntentError::NumericOverflow)
    );
    assert_eq!(
        validate_intent_batch(&[], &permission(), &context()),
        Err(IntentError::InvalidBatch)
    );
    assert_eq!(
        validate_intent_batch(&[batch[0]; 9], &permission(), &context()),
        Err(IntentError::InvalidBatch)
    );
}

#[test]
fn permission_expiry_revocation_phase_and_scope_cannot_be_bypassed() {
    let batch = [intent(1, PlayerIntent::Jump)];
    let mut ctx = context();
    ctx.now_seconds = permission().expires_at_seconds;
    assert_eq!(
        validate_intent_batch(&batch, &permission(), &ctx),
        Err(IntentError::ExpiredKey)
    );
    ctx = context();
    ctx.revoked = true;
    assert_eq!(
        validate_intent_batch(&batch, &permission(), &ctx),
        Err(IntentError::RevokedKey)
    );
    for phase in [
        RunPhase::Ready,
        RunPhase::Suspended,
        RunPhase::TerminalRecorded,
        RunPhase::CompletionRequested,
    ] {
        ctx = context();
        ctx.phase = phase;
        assert_eq!(
            validate_intent_batch(&batch, &permission(), &ctx),
            Err(IntentError::InactiveRun)
        );
    }
    ctx = context();
    ctx.signer = permission().owner;
    assert_eq!(
        validate_intent_batch(&batch, &permission(), &ctx),
        Err(IntentError::PermissionMismatch)
    );
    ctx = context();
    ctx.program = Pubkey::new_from_array([99; 32]);
    assert_eq!(
        validate_intent_batch(&batch, &permission(), &ctx),
        Err(IntentError::PermissionMismatch)
    );
    ctx = context();
    ctx.owner = Pubkey::new_from_array([99; 32]);
    assert_eq!(
        validate_intent_batch(&batch, &permission(), &ctx),
        Err(IntentError::PermissionMismatch)
    );
    let mut wrong = batch[0];
    wrong.run = Pubkey::new_from_array([99; 32]);
    assert_eq!(
        validate_intent_batch(&[wrong], &permission(), &context()),
        Err(IntentError::RunMismatch)
    );
    wrong = batch[0];
    wrong.rules_version = 2;
    assert_eq!(
        validate_intent_batch(&[wrong], &permission(), &context()),
        Err(IntentError::UnsupportedVersion)
    );
    wrong = batch[0];
    wrong.protocol_version = 2;
    assert_eq!(
        validate_intent_batch(&[wrong], &permission(), &context()),
        Err(IntentError::UnsupportedVersion)
    );
}

#[test]
fn borsh_rejects_unknown_actions_axes_and_noncanonical_booleans() {
    let mut bytes = Vec::new();
    intent(1, PlayerIntent::Heartbeat { active: true })
        .serialize(&mut bytes)
        .unwrap();
    bytes[47] = 2;
    assert!(IntentEnvelope::try_from_slice(&bytes).is_err());
    bytes[46] = 0;
    bytes[47] = 3;
    assert!(IntentEnvelope::try_from_slice(&bytes).is_err());
    bytes[46] = 255;
    assert!(IntentEnvelope::try_from_slice(&bytes).is_err());
}
