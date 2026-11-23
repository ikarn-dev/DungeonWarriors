use anchor_lang::AnchorSerialize;
use purrps_game::{
    catalog::{cat_stats, CatId},
    protocol::{PlayerIntent, RunPhase},
    rules::{RULES_V1, RULES_V2, RULES_V3},
    simulation::{
        collision::surface_at,
        world::{
            initialize_world, initialize_world_for_rules, step_world, step_world_for_rules,
            PriceSample, WorldState,
        },
        SimulationError,
    },
    state::run::EntityKind,
};
use std::io::Write;
#[path = "support/simulation.rs"]
mod fixtures;

fn sample(change: i64) -> PriceSample {
    PriceSample {
        previous_price: 10_000,
        previous_exponent: 8,
        price: 10_000 + change,
        exponent: 8,
    }
}
fn initial(cat: CatId, level: u8, change: i64) -> WorldState {
    let mut frame = fixtures::frame();
    frame.runner.y_subpixels = i32::from(RULES_V1.physics.viewport_height_pixels) * 256 / 2
        - RULES_V1.physics.hitbox_height_subpixels;
    initialize_world(frame, &cat_stats(cat, level).unwrap(), sample(change)).unwrap()
}
fn controller(state: &WorldState) -> Vec<PlayerIntent> {
    let r = state.frame.runner;
    let distance = r.automatic_speed_subpixels_per_tick * 20;
    if r.grounded
        && state.entities.iter().any(|e| {
            e.kind == EntityKind::Hazard
                && e.x_subpixels >= r.x_subpixels + RULES_V1.physics.hitbox_width_subpixels
                && e.x_subpixels - r.x_subpixels - RULES_V1.physics.hitbox_width_subpixels
                    <= distance
        })
    {
        vec![PlayerIntent::Jump]
    } else {
        vec![]
    }
}

#[test]
fn v2_quiet_and_moving_markets_have_reachable_obstacles_and_higher_speed() {
    for cat in [
        CatId::Collector,
        CatId::Acrobat,
        CatId::Guardian,
        CatId::Sprinter,
    ] {
        for level in 1..=5 {
            let stats = cat_stats(cat, level).unwrap();
            for change in [0, 1, 5, -5, 40, -40] {
                let mut state = initialize_world_for_rules(
                    initial(cat, level, 0).frame,
                    &stats,
                    sample(change),
                    &RULES_V2,
                )
                .unwrap();
                assert_eq!(
                    state
                        .entities
                        .iter()
                        .filter(|entry| entry.kind == EntityKind::Hazard)
                        .count(),
                    1
                );
                assert_eq!(
                    state
                        .entities
                        .iter()
                        .any(|entry| matches!(entry.kind, EntityKind::Ramp(rise) if rise != 0)),
                    change != 0
                );
                for _ in 0..1_200 {
                    state = step_world_for_rules(
                        &state,
                        &stats,
                        &controller(&state),
                        sample(change),
                        &RULES_V2,
                    )
                    .unwrap();
                    assert_eq!(
                        state.frame.phase,
                        RunPhase::Active,
                        "{cat:?} {level} {change}"
                    );
                }
                assert_eq!(state.frame.qualified_checkpoints, 2);
                assert!(
                    state.frame.runner.automatic_speed_subpixels_per_tick
                        > RULES_V2.physics.runner_speed_subpixels_per_tick
                );
            }
        }
    }
}

#[test]
fn v2_quiet_course_requires_jumps_and_keeps_speed_progressing_past_seven_times() {
    let cat = CatId::Collector;
    let stats = cat_stats(cat, 1).unwrap();
    let start =
        initialize_world_for_rules(initial(cat, 1, 0).frame, &stats, sample(0), &RULES_V2).unwrap();
    let mut idle = start.clone();
    for _ in 0..180 {
        idle = step_world_for_rules(&idle, &stats, &[], sample(0), &RULES_V2).unwrap();
        if idle.frame.terminal_reason.is_some() {
            break;
        }
    }
    assert_eq!(
        idle.frame.terminal_reason,
        Some(purrps_game::protocol::TerminalReason::Crash)
    );
    let mut played = start;
    for _ in 0..(16 * u64::from(RULES_V2.checkpoint_ticks)) {
        played = step_world_for_rules(&played, &stats, &controller(&played), sample(0), &RULES_V2)
            .unwrap();
        assert_eq!(played.frame.phase, RunPhase::Active);
    }
    assert!(played.frame.qualified_checkpoints >= 14);
    assert!(played.frame.runner.automatic_speed_subpixels_per_tick > 2_800);
}

#[test]
fn v3_slopes_follow_the_feed_and_a_missed_gap_records_a_crash() {
    use purrps_game::protocol::TerminalReason;
    let cat = CatId::Collector;
    let stats = cat_stats(cat, 1).unwrap();
    let frame = initial(cat, 1, 0).frame;
    let rules = &RULES_V3;
    let width = rules.generation.segment_width_subpixels;
    for change in [1, -1] {
        let world = initialize_world_for_rules(frame, &stats, sample(change), rules).unwrap();
        assert!(world
            .entities
            .iter()
            .any(|e| e.kind == EntityKind::Ramp(-1_536 * change as i32)));
        assert!(world.entities.iter().any(|e| {
            matches!(e.kind, EntityKind::Ramp(_)) && e.width_subpixels == width - 41 * 256
        }));
    }

    let initial = initialize_world_for_rules(frame, &stats, sample(0), rules).unwrap();
    let mut falling = initial.clone();
    let mut jumping = initial;
    for _ in 0..rules.checkpoint_ticks {
        if falling.frame.phase == RunPhase::Active {
            falling = step_world_for_rules(&falling, &stats, &[], sample(0), rules).unwrap();
        }
        let runner = jumping.frame.runner;
        let takeoff = jumping.entities.iter().any(|e| {
            let distance = e.x_subpixels + e.width_subpixels
                - runner.x_subpixels
                - rules.physics.hitbox_width_subpixels;
            matches!(e.kind, EntityKind::Ramp(_))
                && e.width_subpixels < width
                && (0..=rules.physics.min_landing_width_subpixels).contains(&distance)
        });
        let actions = if runner.grounded && takeoff {
            &[PlayerIntent::Jump][..]
        } else {
            &[]
        };
        jumping = step_world_for_rules(&jumping, &stats, actions, sample(0), rules).unwrap();
    }
    assert_eq!(falling.frame.terminal_reason, Some(TerminalReason::Crash));
    assert!(
        falling.frame.runner.y_subpixels >= i32::from(rules.physics.viewport_height_pixels) * 256
    );
    assert_eq!(jumping.frame.phase, RunPhase::Active);
    assert_eq!(jumping.frame.qualified_checkpoints, 1);
}

#[test]
fn generated_required_route_is_reachable_for_every_cat_and_level_without_powers() {
    let mut trace = if std::env::var("PURRPS_WORLD_TRACE").as_deref() == Ok("1") {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../../tests/.artifacts/world-parity.csv");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        Some(std::io::BufWriter::new(
            std::fs::File::create(path).unwrap(),
        ))
    } else {
        None
    };
    for (cat_index, cat) in [
        CatId::Collector,
        CatId::Acrobat,
        CatId::Guardian,
        CatId::Sprinter,
    ]
    .into_iter()
    .enumerate()
    {
        for level in 1..=5 {
            for mode in 0..4 {
                let stats = cat_stats(cat, level).unwrap();
                let mut state = initial(cat, level, if mode == 0 { 0 } else { 1000 });
                for tick in 0..1200 {
                    let change = match mode {
                        0 => 0,
                        1 => 1000,
                        2 => -1000,
                        _ => {
                            if tick / 31 % 2 == 0 {
                                1000
                            } else {
                                -1000
                            }
                        }
                    };
                    let actions = controller(&state);
                    state =
                        step_world(&state, &stats, &actions, sample(change)).unwrap_or_else(|e| {
                            panic!("cat {cat:?} level {level} mode {mode} tick {tick}: {e:?}")
                        });
                    assert_eq!(
                        state.frame.phase,
                        RunPhase::Active,
                        "{cat:?} level {level} mode {mode} tick {tick}"
                    );
                    assert!(state.entities.len() <= usize::from(RULES_V1.max_world_entities));
                    assert!(state.frame.powers.iter().all(|p| p.ends_at_tick == 0));
                    if tick == 599 {
                        assert_eq!(state.frame.total_coins, 5, "{cat:?} mode {mode}");
                    }
                    if let Some(output) = &mut trace {
                        writeln!(
                            output,
                            "{cat_index},{level},{mode},{},{}",
                            tick + 1,
                            world_hash(&state)
                        )
                        .unwrap();
                    }
                }
                assert_eq!(
                    state.frame.total_coins, 10,
                    "{cat:?} level {level} mode {mode}"
                );
                assert_eq!(state.frame.qualified_checkpoints, 2);
                assert!(state.world_origin_pixels > 0);
            }
        }
    }
    if let Some(output) = &mut trace {
        output.flush().unwrap();
    }
}

fn world_hash(state: &WorldState) -> String {
    let f = state.frame;
    let projection = (
        (
            f.phase,
            f.active_ticks,
            f.runner,
            f.powers,
            f.score,
            f.total_coins,
            f.designated_coin_mask,
            f.qualified_checkpoints,
            f.terminal_reason,
        ),
        (
            state.world_origin_pixels,
            state.next_entity_id,
            state.generation,
            &state.entities,
        ),
    );
    let mut bytes = Vec::new();
    projection.serialize(&mut bytes).unwrap();
    solana_sha256_hasher::hash(&bytes)
        .to_bytes()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

#[test]
fn generation_is_deterministic_atomic_and_freezes_while_suspended() {
    let state = initial(CatId::Collector, 1, 1000);
    let stats = cat_stats(CatId::Collector, 1).unwrap();
    assert_eq!(
        step_world(&state, &stats, &[], sample(1000)),
        step_world(&state, &stats, &[], sample(1000))
    );
    let before = state.clone();
    let mut bad = sample(0);
    bad.price = 0;
    assert_eq!(
        step_world(&state, &stats, &[], bad),
        Err(SimulationError::InvalidObservation)
    );
    assert_eq!(state, before);
    let mut suspended = state;
    suspended.frame.phase = RunPhase::Suspended;
    assert_eq!(step_world(&suspended, &stats, &[], bad).unwrap(), suspended);
    let mut overflow = before;
    overflow.next_entity_id = u64::MAX;
    overflow.frame.runner.x_subpixels += RULES_V1.physics.max_velocity_subpixels_per_tick;
    assert_eq!(
        step_world(&overflow, &stats, &[], sample(1000)),
        Err(SimulationError::NumericOverflow)
    );
}

#[test]
fn ramp_surface_uses_signed_integer_interpolation() {
    assert_eq!(surface_at(&fixtures::floor(), 0), Some(7168));
    let mut ramp = fixtures::entity(0, EntityKind::Ramp(-12_288), 0, 60_000, 32_768, 7_168);
    assert_eq!(surface_at(&ramp, 16_384), Some(53_856));
    assert_eq!(surface_at(&ramp, 1), Some(60_000));
    ramp.kind = EntityKind::Ramp(12_288);
    assert_eq!(surface_at(&ramp, 16_384), Some(66_144));
}

#[test]
fn ramp_motion_matches_independent_fixed_point_cases() {
    let rows = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../../tests/fixtures/game-v1/ramps.csv"
    ));
    let stats = cat_stats(CatId::Collector, 1).unwrap();
    let mut frame = fixtures::frame();
    let mut previous = "";
    for line in rows.lines().skip(1) {
        let fields: Vec<_> = line.split(',').collect();
        assert_eq!(fields.len(), 10);
        if previous != fields[0] {
            frame = fixtures::frame();
            frame.runner.y_subpixels = fields[4].parse().unwrap();
            previous = fields[0];
        }
        let tile = fixtures::entity(
            0,
            EntityKind::Ramp(fields[3].parse().unwrap()),
            0,
            60_000,
            32_768,
            7_168,
        );
        let actions = if fields[2] == "jump" {
            vec![PlayerIntent::Jump]
        } else {
            vec![]
        };
        frame = purrps_game::simulation::step(&frame, &[tile], &stats, &actions)
            .unwrap()
            .frame;
        assert_eq!(frame.active_ticks, fields[1].parse::<u64>().unwrap());
        assert_eq!(
            [
                frame.runner.x_subpixels,
                frame.runner.y_subpixels,
                frame.runner.vx_subpixels_per_tick,
                frame.runner.vy_subpixels_per_tick
            ],
            [fields[5], fields[6], fields[7], fields[8]].map(|v| v.parse::<i32>().unwrap()),
            "{} tick {}",
            fields[0],
            fields[1]
        );
        assert_eq!(frame.runner.grounded, fields[9] == "true");
    }
}

#[test]
fn endless_world_preserves_absolute_distance_after_speed_and_payout_caps() {
    let stats = cat_stats(CatId::Sprinter, 1).unwrap();
    let mut state = initial(CatId::Sprinter, 1, 0);
    for _ in 0..12600 {
        let before =
            u128::from(state.world_origin_pixels) * 256 + state.frame.runner.x_subpixels as u128;
        state = step_world(&state, &stats, &[], sample(0)).unwrap();
        let after =
            u128::from(state.world_origin_pixels) * 256 + state.frame.runner.x_subpixels as u128;
        assert_eq!(
            after - before,
            state.frame.runner.vx_subpixels_per_tick as u128
        );
        assert!(state.entities.len() <= 64);
    }
    assert_eq!(state.frame.total_coins, 105);
    assert_eq!(state.frame.qualified_checkpoints, 21);
    assert_eq!(
        purrps_game::rules::earned_multiplier_bps(state.frame.qualified_checkpoints),
        100000
    );
    assert!(state.world_origin_pixels > 50000);
}

#[test]
fn all_cat_levels_match_powered_worlds_beyond_the_payout_cap() {
    use purrps_game::economy::gross_payout;
    use solana_sha256_hasher::hashv;
    let mut rows = String::new();
    let generate_trace = std::env::var("PURRPS_WORLD_TRACE").as_deref() == Ok("1");
    for (cat_index, cat) in [
        CatId::Collector,
        CatId::Acrobat,
        CatId::Guardian,
        CatId::Sprinter,
    ]
    .into_iter()
    .enumerate()
    {
        for level in 1..=5 {
            let stats = cat_stats(cat, level).unwrap();
            let ability = stats.power as usize;
            let cooldown = u64::from(stats.power_cooldown_ticks);
            let mut state = initial(cat, level, 0);
            let mut digest = [0; 32];
            for tick in 1..=12_600u64 {
                state = step_world(&state, &stats, &[PlayerIntent::Boost], sample(0)).unwrap();
                assert_eq!(state.frame.phase, RunPhase::Active);
                assert_eq!(state.frame.active_ticks, tick);
                assert_eq!(state.frame.qualified_checkpoints, tick / 600);
                assert_eq!(
                    state.frame.powers[ability].ready_at_tick,
                    1 + ((tick - 1) / cooldown + 1) * cooldown
                );
                if generate_trace {
                    digest = hashv(&[&digest, world_hash(&state).as_bytes()]).to_bytes();
                }
            }
            assert_eq!(purrps_game::rules::run_level(state.frame.active_ticks), 22);
            assert_eq!(
                gross_payout(1_000_000, state.frame.qualified_checkpoints),
                Ok(10_000_000)
            );
            rows.push_str(&format!(
                "{cat_index},{level},{}\n",
                digest
                    .iter()
                    .map(|b| format!("{b:02x}"))
                    .collect::<String>()
            ));
        }
    }
    if generate_trace {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../../tests/.artifacts/powered-world-parity.csv");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, rows).unwrap();
    }
}
