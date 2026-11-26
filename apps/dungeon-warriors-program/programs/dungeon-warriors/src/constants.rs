use anchor_lang::prelude::*;

#[constant]
pub const COUNTER_SEED: &[u8] = b"counter";

#[constant]
pub const HELLO_WORLD_LAMPORTS: u64 = 1;

#[constant]
pub const MAX_COUNT: u64 = 10;

pub const SCHEMA_VERSION: u16 = 1;
pub const USDC_MINT: Pubkey = pubkey!("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
pub const HOSTED_ORACLE_PROGRAM: Pubkey = pubkey!("PriCems5tHihc6UDXDjzjeawomAwBduWMGAi8ZUjppd");
pub const GAME_CONFIG_SEED: &[u8] = b"game-config";
pub const RULES_SEED: &[u8] = b"rules";
pub const CATALOG_SEED: &[u8] = b"catalog";
pub const PLAYER_SEED: &[u8] = b"player";
pub const COLLECTION_SEED: &[u8] = b"collection";
pub const SESSION_SEED: &[u8] = b"session";
pub const HOUSE_SEED: &[u8] = b"house";
pub const RUN_ESCROW_SEED: &[u8] = b"run-escrow";
pub const RUN_GAME_SEED: &[u8] = b"run-game";
pub const DRAW_SEED: &[u8] = b"draw";
pub const RESULT_SEED: &[u8] = b"result";
pub const LEADERBOARD_SEED: &[u8] = b"leaderboard";
pub const SPONSOR_SEED: &[u8] = b"sponsor";
pub const SPONSOR_POLICY_SEED: &[u8] = b"sponsor-policy";
