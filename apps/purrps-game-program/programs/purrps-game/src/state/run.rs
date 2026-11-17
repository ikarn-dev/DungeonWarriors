use anchor_lang::prelude::*;
use std::io::{self, Read, Write};

use crate::{
    catalog::Power,
    contracts::RunSnapshot,
    protocol::{AcceptedIntent, FaultReason, InputAxis, RunPhase, TerminalReason},
};

pub const MAX_WORLD_ENTITIES: usize = 64;
pub const MAX_RECENT_OBSERVATIONS: usize = 16;
pub const MAX_QUEUED_INTENTS: usize = 32;

// Fixed-capacity ring storage lives on the heap. Reject its length prefix before
// allocating; InitSpace's max_len sets rent space, not deserialization limits.
fn read_buffer<T: AnchorDeserialize, R: Read, const N: usize>(
    reader: &mut R,
) -> io::Result<Vec<T>> {
    if u32::deserialize_reader(reader)? as usize != N {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Invalid run buffer length",
        ));
    }
    let mut items = Vec::with_capacity(N);
    for _ in 0..N {
        items.push(T::deserialize_reader(reader)?);
    }
    Ok(items)
}

fn read_entities<R: Read>(reader: &mut R) -> io::Result<Vec<WorldEntity>> {
    read_buffer::<_, _, MAX_WORLD_ENTITIES>(reader)
}

fn read_observations<R: Read>(reader: &mut R) -> io::Result<Vec<OracleObservation>> {
    read_buffer::<_, _, MAX_RECENT_OBSERVATIONS>(reader)
}

fn read_intents<R: Read>(reader: &mut R) -> io::Result<Vec<Option<AcceptedIntent>>> {
    read_buffer::<_, _, MAX_QUEUED_INTENTS>(reader)
}

#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntityKind {
    Terrain,
    Hazard,
    Coin,
    Star,
    Booster(Power),
}

#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Debug, Clone, Copy, PartialEq, Eq)]
pub struct WorldEntity {
    pub id: u64,
    pub kind: EntityKind,
    pub x_subpixels: i32,
    pub y_subpixels: i32,
    pub width_subpixels: i32,
    pub height_subpixels: i32,
    pub designated_coin: Option<u8>,
    // Zero-based checkpoint window; late coins cannot qualify a later window.
    pub designated_checkpoint: u64,
    pub consumed: bool,
}

// Hash decoded content, not timestamp alone: distinct same-second updates count.
#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Debug, Clone, Copy, PartialEq, Eq)]
pub struct OracleObservation {
    pub sequence: u64,
    pub price: i64,
    pub exponent: i32,
    pub published_at_seconds: i64,
    pub posted_slot: u64,
    pub content_hash: [u8; 32],
}

#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Debug, Clone, Copy, PartialEq, Eq)]
pub struct RunnerState {
    // Top-left of the fixed body, not the sprite's padded frame.
    pub x_subpixels: i32,
    pub y_subpixels: i32,
    pub vx_subpixels_per_tick: i32,
    pub vy_subpixels_per_tick: i32,
    pub automatic_speed_subpixels_per_tick: i32,
    pub grounded: bool,
    pub axis: InputAxis,
    pub dash_ends_at_tick: u64,
    pub dash_ready_at_tick: u64,
    pub shield_contact_ends_at_tick: u64,
}

// Array order is Power order. Distinct types coexist; each has at most one
// charge, exclusive expiry and its own cooldown. All stop on suspended ticks.
#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Debug, Clone, Copy, PartialEq, Eq)]
pub struct PowerState {
    pub ready_at_tick: u64,
    pub ends_at_tick: u64,
    pub charges: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Debug, Clone, Copy, PartialEq, Eq)]
// Hydra uses static templates and slot intervals. Authenticate the preceding
// Trigger via instructions sysvar; derive an ordinal in-program, never from args.
// Millisecond budget fields require verified trusted time before funded entry.
pub struct CrankState {
    pub task: Pubkey,
    pub cancel_authority: Pubkey,
    pub generation: u64,
    pub last_execution_ordinal: u64,
    pub trusted_elapsed_ms: u64,
    pub consumed_elapsed_ms: u64,
    pub completion_attempts: u16,
}

#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Debug, Clone, Copy, PartialEq, Eq)]
pub struct Suspension {
    pub reason: FaultReason,
    pub started_at_seconds: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Debug, Clone, Copy, PartialEq, Eq)]
pub struct RunTerminal {
    pub reason: TerminalReason,
    pub fault: Option<FaultReason>,
    pub active_ticks: u64,
    pub qualified_checkpoints: u64,
    pub score: u64,
    pub coins: u64,
    pub processed_sequence: u64,
    pub final_observation: Option<OracleObservation>,
    pub gross_payout_base_units: u64,
    pub refund_base_units: u64,
}

// [RUN_GAME_SEED, owner, nonce.to_le_bytes()]. Only this and SDK-required SOL
// records are delegated. Heap buffers have exactly their declared capacity;
// count/head select live entries. Unused slots do not authorize events.
// Earliest liveness deadline wins, never extends.
#[account]
#[derive(InitSpace)]
pub struct RunGameState {
    pub schema_version: u16,
    pub bump: u8,
    pub escrow: Pubkey,
    pub snapshot: RunSnapshot,
    pub snapshot_hash: [u8; 32],
    pub phase: RunPhase,
    pub active_ticks: u64,
    pub world_origin_pixels: u64,
    pub runner: RunnerState,
    #[max_len(MAX_WORLD_ENTITIES)]
    #[borsh(deserialize_with = "read_entities", serialize_with = "write_entities")]
    pub entities: Vec<WorldEntity>,
    pub entity_count: u8,
    pub next_entity_id: u64,
    #[max_len(MAX_RECENT_OBSERVATIONS)]
    #[borsh(
        deserialize_with = "read_observations",
        serialize_with = "write_observations"
    )]
    pub observations: Vec<OracleObservation>,
    pub observation_head: u8,
    pub observation_count: u8,
    pub start_observation: Option<OracleObservation>,
    #[max_len(MAX_QUEUED_INTENTS)]
    #[borsh(deserialize_with = "read_intents", serialize_with = "write_intents")]
    pub intents: Vec<Option<AcceptedIntent>>,
    pub intent_head: u8,
    pub intent_count: u8,
    pub last_accepted_sequence: u64,
    pub last_processed_sequence: u64,
    pub last_accepted_order: u64,
    pub control_window_seconds: i64,
    pub control_updates_in_window: u8,
    pub last_heartbeat_tick: u64,
    pub inactive_exit_tick: Option<u64>,
    pub key_exit_tick: Option<u64>,
    pub input_key_revoked: bool,
    pub score: u64,
    pub total_coins: u64,
    pub designated_coin_mask: u8,
    pub qualified_checkpoints: u64,
    pub powers: [PowerState; 4],
    pub crank: CrankState,
    pub suspension: Option<Suspension>,
    pub terminal: Option<RunTerminal>,
}

fn write_buffer<T: AnchorSerialize, W: Write>(
    values: &[T],
    writer: &mut W,
    capacity: usize,
) -> io::Result<()> {
    if values.len() != capacity {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "invalid run buffer capacity",
        ));
    }
    values.serialize(writer)
}

fn write_entities<W: Write>(values: &[WorldEntity], writer: &mut W) -> io::Result<()> {
    write_buffer(values, writer, MAX_WORLD_ENTITIES)
}
fn write_observations<W: Write>(values: &[OracleObservation], writer: &mut W) -> io::Result<()> {
    write_buffer(values, writer, MAX_RECENT_OBSERVATIONS)
}
fn write_intents<W: Write>(values: &[Option<AcceptedIntent>], writer: &mut W) -> io::Result<()> {
    write_buffer(values, writer, MAX_QUEUED_INTENTS)
}
