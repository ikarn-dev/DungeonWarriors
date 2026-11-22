use anchor_lang::prelude::*;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ContractError {
    InvalidAmount,
    InvalidLevel,
    InvalidMask,
    EmptyDrawPool,
    Unqualified,
    NumericOverflow,
    InvalidObservation,
}

#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Debug, Clone, Copy, PartialEq, Eq)]
pub struct GameRules {
    pub schema_version: u16,
    pub rules_version: u32,
    pub ticks_per_second: u16,
    pub checkpoint_ticks: u16,
    pub designated_coins: u8,
    pub qualification_coins: u8,
    pub initial_multiplier_bps: [u32; 6],
    pub multiplier_step_bps: u32,
    pub max_multiplier_bps: u32,
    pub speed_step_bps: u16,
    pub max_speed_bps: u16,
    pub power_duration_ticks: u16,
    pub shield_contact_ticks: u16,
    pub heartbeat_grace_ticks: u16,
    pub activation_timeout_seconds: u16,
    pub suspension_timeout_seconds: u16,
    pub paid_draw_timeout_seconds: u16,
    pub crank_interval_ms: u16,
    pub max_ticks_per_crank: u8,
    pub max_queued_intents: u8,
    pub max_control_updates_per_second: u8,
    pub max_prediction_ticks: u8,
    pub max_local_intents: u16,
    pub max_world_entities: u8,
    pub max_recent_observations: u8,
    pub physics: PhysicsRules,
    pub generation: GenerationRules,
    pub score: ScoreRules,
}

// Price changes use same-exponent positive i64 observations, widened to i128.
// Delta BPS truncate toward zero, clamp before mapping to a terrain step, and
// values inside the flat band produce zero rise. Positive price -> negative y.
#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Debug, Clone, Copy, PartialEq, Eq)]
pub struct GenerationRules {
    pub segment_width_subpixels: i32,
    pub lookahead_segments: u8,
    pub flat_band_bps: u16,
    pub sharp_move_bps: u16,
    pub max_sample_change_bps: u16,
    pub designated_coin_ticks: [u16; 5],
    pub max_hazards_per_segment: u8,
    pub max_optional_pickups_per_segment: u8,
    pub booster_stride_segments: u16,
}

#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Debug, Clone, Copy, PartialEq, Eq)]
pub struct ScoreRules {
    pub coin_points: u16,
    pub star_points: u16,
}

/// Positions are segment-local signed subpixels (256/pixel), y increases down.
/// Velocities are subpixels/tick; gravity is subpixels/tick². Widen products to
/// i64 and divide toward zero; money uses u128 and rounds down. Never use floats.
/// Rebase the world origin before a coordinate leaves the published bound;
/// distance/score/ticks/sequences use checked u64, never wrapping counters.
/// Each tick: ordered commands -> gravity/velocity -> swept terrain X then Y ->
/// hazards by entity ID -> pickups by entity ID -> checkpoint if still alive.
/// Touching edges count as terrain contact, but not hazard/pickup overlap.
/// MOVE is a -1/0/+1 airborne horizontal offset, not an acceleration. Grounded
/// Jump sets vy to jump_velocity; gravity applies before position integration.
/// Ease automatic speed toward the level target while grounded, retain it in
/// air, then add air control and any dash bonus; clamp velocity before sweeping.
/// Geometry caps are necessary, not a reachability proof: generated required
/// routes must still pass the base-control solver for every cat at level 1.
/// The first terminal stops the tick. Effect end ticks are exclusive; a power
/// armed at tick t is live through t+179. Suspension advances no active timers.
#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Debug, Clone, Copy, PartialEq, Eq)]
pub struct PhysicsRules {
    pub subpixels_per_pixel: u16,
    pub viewport_width_pixels: u16,
    pub viewport_height_pixels: u16,
    pub coordinate_limit_subpixels: i32,
    pub max_velocity_subpixels_per_tick: i32,
    pub runner_speed_subpixels_per_tick: i32,
    pub speed_easing_subpixels_per_tick: i32,
    pub jump_velocity_subpixels_per_tick: i32,
    pub gravity_subpixels_per_tick_squared: i32,
    pub air_control_subpixels_per_tick: i32,
    pub dash_bonus_subpixels_per_tick: i32,
    pub dash_duration_ticks: u16,
    pub dash_cooldown_ticks: u16,
    pub pickup_radius_subpixels: i32,
    pub hitbox_width_subpixels: i32,
    pub hitbox_height_subpixels: i32,
    pub max_required_gap_subpixels: i32,
    pub max_required_rise_subpixels: i32,
    pub min_landing_width_subpixels: i32,
    pub min_required_coin_spacing_ticks: u16,
}

// PRD 3.3 owns the financial/catalog values. Geometry is the v1 implementation
// contract: generator reachability and six-tick compute still require evidence.
pub const RULES_V1: GameRules = GameRules {
    schema_version: 1,
    rules_version: 1,
    ticks_per_second: 60,
    checkpoint_ticks: 600,
    designated_coins: 5,
    qualification_coins: 3,
    initial_multiplier_bps: [11_000, 12_500, 15_000, 19_000, 24_000, 30_000],
    multiplier_step_bps: 5_000,
    max_multiplier_bps: 100_000,
    speed_step_bps: 1_200,
    max_speed_bps: 18_000,
    power_duration_ticks: 180,
    shield_contact_ticks: 18,
    heartbeat_grace_ticks: 300,
    activation_timeout_seconds: 300,
    suspension_timeout_seconds: 300,
    paid_draw_timeout_seconds: 300,
    crank_interval_ms: 100,
    max_ticks_per_crank: 6,
    max_queued_intents: 32,
    max_control_updates_per_second: 20,
    max_prediction_ticks: 15,
    max_local_intents: 128,
    max_world_entities: 64,
    max_recent_observations: 16,
    physics: PhysicsRules {
        subpixels_per_pixel: 256,
        viewport_width_pixels: 960,
        viewport_height_pixels: 540,
        coordinate_limit_subpixels: 16_777_216,
        max_velocity_subpixels_per_tick: 4_096,
        runner_speed_subpixels_per_tick: 1_024,
        speed_easing_subpixels_per_tick: 4,
        jump_velocity_subpixels_per_tick: -3_072,
        gravity_subpixels_per_tick_squared: 128,
        air_control_subpixels_per_tick: 256,
        dash_bonus_subpixels_per_tick: 2_048,
        dash_duration_ticks: 12,
        dash_cooldown_ticks: 60,
        pickup_radius_subpixels: 4_096,
        hitbox_width_subpixels: 6_144,
        hitbox_height_subpixels: 7_168,
        max_required_gap_subpixels: 24_576,
        max_required_rise_subpixels: 12_288,
        min_landing_width_subpixels: 8_192,
        min_required_coin_spacing_ticks: 90,
    },
    generation: GenerationRules {
        segment_width_subpixels: 32_768,
        lookahead_segments: 8,
        flat_band_bps: 5,
        sharp_move_bps: 100,
        max_sample_change_bps: 1_000,
        designated_coin_ticks: [90, 180, 270, 360, 450],
        max_hazards_per_segment: 1,
        max_optional_pickups_per_segment: 1,
        booster_stride_segments: 16,
    },
    score: ScoreRules {
        coin_points: 1,
        star_points: 5,
    },
};

// Preserve existing runs while making small market changes legible in new runs.
pub const RULES_V2: GameRules = GameRules {
    rules_version: 2,
    generation: GenerationRules {
        flat_band_bps: 0,
        sharp_move_bps: 5,
        max_sample_change_bps: 40,
        booster_stride_segments: 8,
        ..RULES_V1.generation
    },
    ..RULES_V1
};

pub fn price_change_bps(
    previous_price: i64,
    previous_exponent: i32,
    next_price: i64,
    next_exponent: i32,
) -> std::result::Result<i32, ContractError> {
    if previous_price <= 0
        || next_price <= 0
        || previous_exponent != next_exponent
        || !(-18..=18).contains(&previous_exponent)
    {
        return Err(ContractError::InvalidObservation);
    }
    let delta =
        (i128::from(next_price) - i128::from(previous_price)) * 10_000 / i128::from(previous_price);
    let bound = i128::from(RULES_V1.generation.max_sample_change_bps);
    i32::try_from(delta.clamp(-bound, bound)).map_err(|_| ContractError::NumericOverflow)
}

pub fn terrain_step_subpixels(change_bps: i32) -> i32 {
    let generation = RULES_V1.generation;
    let bound = i32::from(generation.max_sample_change_bps);
    let change = change_bps.clamp(-bound, bound);
    if change.abs() <= i32::from(generation.flat_band_bps) {
        return 0;
    }
    // Both factors are bounded by the immutable v1 rules, well inside i64/i32.
    (-i64::from(change) * i64::from(RULES_V1.physics.max_required_rise_subpixels)
        / i64::from(bound)) as i32
}

pub fn run_level(active_ticks: u64) -> u64 {
    active_ticks / u64::from(RULES_V1.checkpoint_ticks) + 1
}

pub fn speed_bps(active_ticks: u64) -> u16 {
    let steps = (run_level(active_ticks) - 1).min(7) as u16;
    (10_000 + steps * RULES_V1.speed_step_bps).min(RULES_V1.max_speed_bps)
}

pub fn earned_multiplier_bps(qualified_checkpoints: u64) -> u32 {
    earned_multiplier_for_rules(&RULES_V1, qualified_checkpoints)
}

pub fn earned_multiplier_for_rules(rules: &GameRules, qualified_checkpoints: u64) -> u32 {
    let tiers = &rules.initial_multiplier_bps;
    if qualified_checkpoints == 0 {
        return 0;
    }
    if qualified_checkpoints <= tiers.len() as u64 {
        return tiers[(qualified_checkpoints - 1) as usize];
    }
    let steps = qualified_checkpoints - tiers.len() as u64;
    let earned = u64::from(tiers[tiers.len() - 1])
        .saturating_add(steps.saturating_mul(u64::from(rules.multiplier_step_bps)));
    earned.min(u64::from(rules.max_multiplier_bps)) as u32
}
