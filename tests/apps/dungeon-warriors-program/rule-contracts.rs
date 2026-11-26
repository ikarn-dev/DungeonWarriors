use anchor_lang::{AnchorDeserialize, AnchorSerialize, Space};
use dungeon_warriors::{
    catalog::{cat_stats, eligible_cat_weights, upgraded_level, Catalog, Rarity, CATALOG_V1},
    economy::{gross_payout, max_gross_reservation, required_vault_balance},
    rules::{
        earned_multiplier_bps, price_change_bps, run_level, speed_bps, terrain_step_subpixels,
        ContractError, GameRules, RULES_V1,
    },
};

const PROGRESSION: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../../tests/fixtures/game-v1/progression.csv"
));
const PAYOUTS: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../../tests/fixtures/game-v1/payouts.csv"
));
const CATS: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../../tests/fixtures/game-v1/cats.csv"
));
const PHYSICS: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../../tests/fixtures/game-v1/physics.csv"
));
const GENERATION: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../../tests/fixtures/game-v1/generation.csv"
));
const PRICE_DELTAS: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../../tests/fixtures/game-v1/price-deltas.csv"
));

#[test]
fn price_mapping_uses_exact_signed_deltas_and_bounded_traversable_steps() {
    for line in PRICE_DELTAS.lines().skip(1) {
        let row: Vec<i64> = line
            .split(',')
            .map(|value| value.parse().unwrap())
            .collect();
        let bps = price_change_bps(
            row[0],
            i32::try_from(row[1]).unwrap(),
            row[2],
            i32::try_from(row[3]).unwrap(),
        )
        .unwrap();
        assert_eq!(i64::from(bps), row[4]);
        assert_eq!(i64::from(terrain_step_subpixels(bps)), row[5]);
    }
    assert_eq!(
        price_change_bps(0, -8, 1, -8),
        Err(ContractError::InvalidObservation)
    );
    assert_eq!(
        price_change_bps(1, -8, -1, -8),
        Err(ContractError::InvalidObservation)
    );
    assert_eq!(
        price_change_bps(1, -8, 1, -9),
        Err(ContractError::InvalidObservation)
    );
    assert_eq!(
        price_change_bps(1, -19, 1, -19),
        Err(ContractError::InvalidObservation)
    );
    assert_eq!(
        terrain_step_subpixels(i32::MIN),
        RULES_V1.physics.max_required_rise_subpixels
    );
    assert_eq!(
        terrain_step_subpixels(i32::MAX),
        -RULES_V1.physics.max_required_rise_subpixels
    );
}

#[test]
fn generation_and_arcade_scoring_match_shared_contract() {
    let g = RULES_V1.generation;
    let actual = [
        i64::from(g.segment_width_subpixels),
        i64::from(g.lookahead_segments),
        i64::from(g.flat_band_bps),
        i64::from(g.sharp_move_bps),
        i64::from(g.max_sample_change_bps),
        i64::from(g.designated_coin_ticks[0]),
        i64::from(g.designated_coin_ticks[1]),
        i64::from(g.designated_coin_ticks[2]),
        i64::from(g.designated_coin_ticks[3]),
        i64::from(g.designated_coin_ticks[4]),
        i64::from(g.max_hazards_per_segment),
        i64::from(g.max_optional_pickups_per_segment),
        i64::from(g.booster_stride_segments),
        i64::from(RULES_V1.score.coin_points),
        i64::from(RULES_V1.score.star_points),
    ];
    let expected: Vec<i64> = GENERATION
        .lines()
        .nth(1)
        .unwrap()
        .split(',')
        .map(|value| value.parse().unwrap())
        .collect();
    assert_eq!(actual.as_slice(), expected.as_slice());
    assert!(g
        .designated_coin_ticks
        .windows(2)
        .all(|pair| pair[1] - pair[0] >= RULES_V1.physics.min_required_coin_spacing_ticks));
    assert!(g.designated_coin_ticks[4] < RULES_V1.checkpoint_ticks);
    assert!(
        i64::from(g.segment_width_subpixels) * i64::from(g.lookahead_segments)
            >= i64::from(RULES_V1.physics.viewport_width_pixels)
                * i64::from(RULES_V1.physics.subpixels_per_pixel)
    );
}

fn fixture_rows(input: &str) -> impl Iterator<Item = Vec<u64>> + '_ {
    input.lines().skip(1).map(|line| {
        line.split(',')
            .map(|value| value.parse().unwrap())
            .collect()
    })
}

#[test]
fn checkpoint_clock_and_capped_tiers_match_shared_fixtures() {
    for row in fixture_rows(PROGRESSION) {
        assert_eq!(row.len(), 5);
        assert_eq!(run_level(row[0]), row[2]);
        assert_eq!(u64::from(speed_bps(row[0])), row[3]);
        assert_eq!(u64::from(earned_multiplier_bps(row[1])), row[4]);
    }
}

#[test]
fn exact_payouts_match_shared_fixtures_and_reject_unfundable_stakes() {
    for row in fixture_rows(PAYOUTS) {
        assert_eq!(row.len(), 4);
        assert_eq!(gross_payout(row[0], row[1]), Ok(row[2]));
        assert_eq!(max_gross_reservation(row[0]), Ok(row[3]));
    }
    assert_eq!(max_gross_reservation(0), Err(ContractError::InvalidAmount));
    assert_eq!(gross_payout(1, 0), Err(ContractError::Unqualified));
    assert_eq!(
        max_gross_reservation(u64::MAX / 10 + 1),
        Err(ContractError::NumericOverflow)
    );
    assert_eq!(
        required_vault_balance(5_000_000, 2_000_000, 10_000_000, 1_000_000),
        Ok(18_000_000)
    );
    assert_eq!(
        required_vault_balance(u64::MAX, 1, 0, 0),
        Err(ContractError::NumericOverflow)
    );
}

#[test]
fn every_cat_and_level_matches_shared_snapshot_values() {
    let mut combinations = 0;
    for row in fixture_rows(CATS) {
        assert_eq!(row.len(), 10);
        let cat = CATALOG_V1.cats[usize::try_from(row[0]).unwrap()];
        let stats = cat_stats(cat.id, u8::try_from(row[1]).unwrap()).unwrap();
        assert_eq!(cat.rarity as u64, row[2]);
        assert_eq!(u64::from(cat.weight), row[3]);
        assert_eq!(stats.power as u64, row[4]);
        assert_eq!(u64::from(stats.power_cooldown_ticks), row[5]);
        assert_eq!(
            i64::from(stats.pickup_radius_subpixels),
            i64::try_from(row[6]).unwrap()
        );
        assert_eq!(
            i64::from(stats.air_control_subpixels_per_tick),
            i64::try_from(row[7]).unwrap()
        );
        assert_eq!(u64::from(stats.dash_duration_ticks), row[8]);
        assert_eq!(u64::from(stats.dash_cooldown_ticks), row[9]);
        combinations += 1;
    }
    assert_eq!(combinations, 20);
    assert_eq!(
        cat_stats(CATALOG_V1.cats[0].id, 0),
        Err(ContractError::InvalidLevel)
    );
    assert_eq!(
        cat_stats(CATALOG_V1.cats[0].id, 6),
        Err(ContractError::InvalidLevel)
    );
}

#[test]
fn owned_cats_are_removed_without_changing_remaining_weights() {
    for mask in 0u8..15 {
        let (weights, total) = eligible_cat_weights(mask).unwrap();
        assert_eq!(total, weights.iter().sum::<u16>());
        for (index, weight) in weights.iter().enumerate() {
            assert_eq!(
                *weight,
                if mask & (1 << index) == 0 {
                    CATALOG_V1.cats[index].weight
                } else {
                    0
                }
            );
        }
    }
    assert_eq!(eligible_cat_weights(1), Ok(([0, 3_500, 2_500, 500], 6_500)));
    assert_eq!(eligible_cat_weights(15), Err(ContractError::EmptyDrawPool));
    assert_eq!(eligible_cat_weights(16), Err(ContractError::InvalidMask));
}

#[test]
fn upgrades_clip_without_changing_passives_or_financial_clock() {
    assert_eq!(upgraded_level(1, Rarity::Common), Ok(2));
    assert_eq!(upgraded_level(1, Rarity::Rare), Ok(3));
    assert_eq!(upgraded_level(1, Rarity::Epic), Ok(4));
    assert_eq!(upgraded_level(4, Rarity::Epic), Ok(5));
    assert_eq!(
        upgraded_level(5, Rarity::Common),
        Err(ContractError::InvalidLevel)
    );
    assert_eq!(
        upgraded_level(0, Rarity::Common),
        Err(ContractError::InvalidLevel)
    );
    assert_eq!(
        CATALOG_V1.upgrades.map(|grade| grade.weight),
        [7_000, 2_500, 500]
    );
    assert_eq!(CATALOG_V1.starter_price_base_units, 0);
    assert_eq!(CATALOG_V1.cat_price_base_units, 2_000_000);
    assert_eq!(CATALOG_V1.upgrade_price_base_units, 1_000_000);
    assert_eq!(CATALOG_V1.power_charges, 1);
    assert_eq!(CATALOG_V1.magnet_radius_bps, 20_000);
    assert_eq!(RULES_V1.checkpoint_ticks, 600);
    assert_eq!(
        (RULES_V1.qualification_coins, RULES_V1.designated_coins),
        (3, 5)
    );
}

#[test]
fn versioned_numeric_contracts_have_bounded_borsh_layouts() {
    let mut rules = Vec::new();
    let mut catalog = Vec::new();
    RULES_V1.serialize(&mut rules).unwrap();
    CATALOG_V1.serialize(&mut catalog).unwrap();
    assert_eq!(rules.len(), GameRules::INIT_SPACE);
    assert_eq!(catalog.len(), Catalog::INIT_SPACE);
    assert_eq!(GameRules::try_from_slice(&rules).unwrap(), RULES_V1);
    assert_eq!(Catalog::try_from_slice(&catalog).unwrap(), CATALOG_V1);
    assert_eq!(GameRules::INIT_SPACE, 167);
    assert_eq!(Catalog::INIT_SPACE, 108);
}

#[test]
fn fixed_point_geometry_matches_the_predictor_contract() {
    let p = RULES_V1.physics;
    let actual = [
        i64::from(p.subpixels_per_pixel),
        i64::from(p.viewport_width_pixels),
        i64::from(p.viewport_height_pixels),
        i64::from(p.coordinate_limit_subpixels),
        i64::from(p.max_velocity_subpixels_per_tick),
        i64::from(p.runner_speed_subpixels_per_tick),
        i64::from(p.speed_easing_subpixels_per_tick),
        i64::from(p.jump_velocity_subpixels_per_tick),
        i64::from(p.gravity_subpixels_per_tick_squared),
        i64::from(p.air_control_subpixels_per_tick),
        i64::from(p.dash_bonus_subpixels_per_tick),
        i64::from(p.dash_duration_ticks),
        i64::from(p.dash_cooldown_ticks),
        i64::from(p.pickup_radius_subpixels),
        i64::from(p.hitbox_width_subpixels),
        i64::from(p.hitbox_height_subpixels),
        i64::from(p.max_required_gap_subpixels),
        i64::from(p.max_required_rise_subpixels),
        i64::from(p.min_landing_width_subpixels),
        i64::from(p.min_required_coin_spacing_ticks),
    ];
    let expected: Vec<i64> = PHYSICS
        .lines()
        .nth(1)
        .unwrap()
        .split(',')
        .map(|value| value.parse().unwrap())
        .collect();
    assert_eq!(actual.as_slice(), expected.as_slice());
}
