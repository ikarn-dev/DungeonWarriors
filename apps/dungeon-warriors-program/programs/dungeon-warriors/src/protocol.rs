use anchor_lang::prelude::*;

pub const PROTOCOL_VERSION: u16 = 1;
pub const MAX_INTENTS_PER_SUBMISSION: usize = 8;

#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Debug, Clone, Copy, PartialEq, Eq)]
pub enum RunPhase {
    Ready,
    Active,
    Suspended,
    TerminalRecorded,
    CompletionRequested,
}

#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Debug, Clone, Copy, PartialEq, Eq)]
pub enum TerminalReason {
    CashOut,
    Crash,
    AutoCashOut,
    Surrender,
    TechnicalAbort,
}

#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Debug, Clone, Copy, PartialEq, Eq)]
pub enum FaultReason {
    OracleInvalid,
    OracleStale,
    UnsafeWorld,
    SchedulerGap,
    ActivationExpired,
}

#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Debug, Clone, Copy, PartialEq, Eq)]
pub enum InputAxis {
    Left,
    Neutral,
    Right,
}

// Variant order is the v1 Borsh wire tag; keep old schemas immutable.
#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlayerIntent {
    Move { axis: InputAxis },
    Jump,
    Dash,
    Boost,
    CashOut,
    Surrender,
    Heartbeat { active: bool },
    Inactive,
}

// Signed as instruction data inside a Solana transaction; authority is the
// runtime-verified Signer account, never a JSON field or a web login cookie.
#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Debug, Clone, Copy, PartialEq, Eq)]
pub struct IntentEnvelope {
    pub protocol_version: u16,
    pub rules_version: u32,
    pub run: Pubkey,
    pub client_sequence: u64,
    pub action: PlayerIntent,
}

#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Debug, Clone, Copy, PartialEq, Eq)]
pub struct InputPermission {
    pub owner: Pubkey,
    pub input_key: Pubkey,
    pub program: Pubkey,
    pub session_token: Pubkey,
    pub expires_at_seconds: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Debug, Clone, Copy, PartialEq, Eq)]
pub struct AcceptedIntent {
    pub envelope: IntentEnvelope,
    pub assigned_tick: u64,
    pub accepted_order: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IntentError {
    UnsupportedVersion,
    RunMismatch,
    PermissionMismatch,
    ExpiredKey,
    RevokedKey,
    InactiveRun,
    SequenceMismatch,
    NumericOverflow,
    QueueFull,
    InvalidBatch,
}

// These values come from authenticated accounts/Clock, not instruction args.
// ER execution identity, rate-window debit and atomic queue mutation must also
// be enforced by the eventual handler; this pure check does not authenticate ER.
pub struct IntentContext {
    pub run: Pubkey,
    pub owner: Pubkey,
    pub program: Pubkey,
    pub signer: Pubkey,
    pub rules_version: u32,
    pub phase: RunPhase,
    pub now_seconds: i64,
    pub revoked: bool,
    pub last_accepted_sequence: u64,
    pub queued_intents: usize,
    pub queue_capacity: usize,
}

pub fn validate_intent_batch(
    intents: &[IntentEnvelope],
    permission: &InputPermission,
    context: &IntentContext,
) -> std::result::Result<(), IntentError> {
    if intents.is_empty() || intents.len() > MAX_INTENTS_PER_SUBMISSION {
        return Err(IntentError::InvalidBatch);
    }
    if context.queue_capacity == 0
        || context.queue_capacity > 32
        || context.queued_intents > context.queue_capacity
        || intents.len() > context.queue_capacity - context.queued_intents
    {
        return Err(IntentError::QueueFull);
    }
    if context.phase != RunPhase::Active {
        return Err(IntentError::InactiveRun);
    }
    if context.revoked {
        return Err(IntentError::RevokedKey);
    }
    if context.now_seconds >= permission.expires_at_seconds {
        return Err(IntentError::ExpiredKey);
    }
    if permission.owner != context.owner
        || permission.program != context.program
        || permission.input_key != context.signer
    {
        return Err(IntentError::PermissionMismatch);
    }
    let mut previous = context.last_accepted_sequence;
    for intent in intents {
        if intent.protocol_version != PROTOCOL_VERSION
            || intent.rules_version != context.rules_version
        {
            return Err(IntentError::UnsupportedVersion);
        }
        if intent.run != context.run {
            return Err(IntentError::RunMismatch);
        }
        let expected = previous
            .checked_add(1)
            .ok_or(IntentError::NumericOverflow)?;
        if intent.client_sequence != expected {
            return Err(IntentError::SequenceMismatch);
        }
        previous = expected;
    }
    Ok(())
}
