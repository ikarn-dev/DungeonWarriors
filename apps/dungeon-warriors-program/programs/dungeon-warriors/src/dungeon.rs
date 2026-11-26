use crate::error::ErrorCode;
use anchor_lang::prelude::*;
use solana_sha256_hasher::hashv;

pub const DUNGEON_CONFIG_SEED: &[u8] = b"dungeon-config";
pub const EXPEDITION_SEED: &[u8] = b"expedition";
pub const MAX_ROOMS: usize = 5;

#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Clone, Copy, Debug, PartialEq, Eq)]
pub struct DungeonRules {
    pub version: u32,
    pub engine_hash: [u8; 32],
    pub rooms: u8,
    pub return_bps: u16,
    pub room_seconds: [u16; MAX_ROOMS],
    pub collector_bonus_ms: u16,
    pub guardian_grace_ms: u16,
    pub hourglass_ms: u16,
    pub sprint_bps: u16,
    pub vrf_timeout_seconds: u16,
}
pub const DUNGEON_V3: DungeonRules = DungeonRules {
    version: 3,
    engine_hash: crate::dungeon_engine::DUNGEON_ENGINE_HASH,
    rooms: 5,
    return_bps: 9500,
    room_seconds: [30, 28, 26, 24, 22],
    collector_bonus_ms: 3000,
    guardian_grace_ms: 5000,
    hourglass_ms: 3000,
    sprint_bps: 11000,
    vrf_timeout_seconds: 300,
};
impl DungeonRules {
    pub fn validate(&self) -> Result<()> {
        require!(
            self.version == DUNGEON_V3.version
                && self.engine_hash == crate::dungeon_engine::DUNGEON_ENGINE_HASH
                && self.rooms > 0
                && usize::from(self.rooms) <= MAX_ROOMS
                && (6667..=10000).contains(&self.return_bps)
                && self.room_seconds.iter().all(|s| (10..=120).contains(s))
                && self.collector_bonus_ms <= 10000
                && self.guardian_grace_ms <= 10000
                && self.hourglass_ms <= 10000
                && (10000..=15000).contains(&self.sprint_bps)
                && (30..=600).contains(&self.vrf_timeout_seconds),
            ErrorCode::InvalidConfiguration
        );
        Ok(())
    }
    pub fn content_hash(&self) -> Result<[u8; 32]> {
        let mut bytes = Vec::new();
        self.serialize(&mut bytes)?;
        Ok(hashv(&[b"purrps:dungeon-rules:v1", &bytes]).to_bytes())
    }
}
pub fn dungeon_payout(stake: u64, cleared: u8, rules: &DungeonRules) -> Result<u64> {
    require!(cleared > 0 && cleared <= rules.rooms, ErrorCode::InvalidRun);
    let n = u32::from(cleared);
    let numerator = u128::from(stake)
        .checked_mul(u128::from(rules.return_bps))
        .and_then(|v| v.checked_mul(3u128.pow(n)))
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    u64::try_from(numerator / (10000u128 * 2u128.pow(n)))
        .map_err(|_| error!(ErrorCode::ArithmeticOverflow))
}
pub fn trap_gate(
    expedition: &Pubkey,
    random: &[u8; 32],
    secret: &[u8; 32],
    room: u8,
) -> Result<u8> {
    for counter in 0u8..8 {
        let bytes = hashv(&[
            b"purrps:dungeon-gate:v1",
            expedition.as_ref(),
            random,
            secret,
            &[room, counter],
        ])
        .to_bytes();
        if let Some(value) = bytes.into_iter().find(|v| *v < 255) {
            return Ok(value % 3);
        }
    }
    err!(ErrorCode::InvalidRun)
}
