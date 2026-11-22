use purrps_game::{
    catalog::{cat_stats, CatId, Power},
    protocol::{PlayerIntent, RunPhase, TerminalReason},
    rules::RULES_V2,
    simulation::{step, step_for_rules, SimulationError},
};
#[path = "support/simulation.rs"]
mod support;
use support::*;

#[test]
fn v2_second_jump_uses_one_charge_on_a_later_tick() {
    let stats = cat_stats(CatId::Acrobat, 1).unwrap();
    let terrain = [floor()];
    let first = step_for_rules(
        &frame(),
        &terrain,
        &stats,
        &[PlayerIntent::Jump, PlayerIntent::Jump],
        &RULES_V2,
    )
    .unwrap()
    .frame;
    assert_eq!(first.powers[Power::DoubleJump as usize].ready_at_tick, 0);
    let second = step_for_rules(&first, &terrain, &stats, &[PlayerIntent::Jump], &RULES_V2)
        .unwrap()
        .frame;
    assert_eq!(
        second.runner.vy_subpixels_per_tick,
        first.runner.vy_subpixels_per_tick
    );
    let charge = second.powers[Power::DoubleJump as usize];
    assert_eq!(charge.charges, 0);
    assert!(charge.ready_at_tick > second.active_ticks);
    let third = step_for_rules(&second, &terrain, &stats, &[PlayerIntent::Jump], &RULES_V2)
        .unwrap()
        .frame;
    assert!(third.runner.vy_subpixels_per_tick > second.runner.vy_subpixels_per_tick);
}

#[test]
fn step_trace_matches_independent_fixture() {
    let rows = include_str!("../../fixtures/game-v1/motion.csv");
    let mut name = "";
    let mut f = frame();
    let mut world = vec![floor()];
    for row in rows.lines().skip(1) {
        let p: Vec<_> = row.split(',').collect();
        if name != p[0] {
            name = p[0];
            f = frame();
            world = vec![floor()];
        }
        let actions = match p[2] {
            "jump" => vec![PlayerIntent::Jump],
            "dash" => vec![PlayerIntent::Dash],
            "boost_jump" => vec![PlayerIntent::Boost, PlayerIntent::Jump],
            _ => vec![],
        };
        let stats = cat_stats(
            if name == "double" {
                CatId::Acrobat
            } else {
                CatId::Collector
            },
            1,
        )
        .unwrap();
        let result = step(&f, &world, &stats, &actions).unwrap();
        f = result.frame;
        world = result.entities;
        assert_eq!(f.active_ticks, p[1].parse::<u64>().unwrap());
        assert_eq!(
            [
                f.runner.x_subpixels,
                f.runner.y_subpixels,
                f.runner.vx_subpixels_per_tick,
                f.runner.vy_subpixels_per_tick
            ],
            p[3..7]
                .iter()
                .map(|s| s.parse::<i32>().unwrap())
                .collect::<Vec<_>>()
                .as_slice()
        );
        assert_eq!(f.runner.grounded, p[7].parse::<bool>().unwrap());
    }
}

#[test]
fn terrain_walls_ceilings_and_tunneling_are_resolved() {
    let stats = cat_stats(CatId::Collector, 1).unwrap();
    let wall = entity(
        2,
        purrps_game::state::run::EntityKind::Terrain,
        6500,
        -100,
        100,
        8000,
    );
    let result = step(&frame(), &[floor(), wall], &stats, &[]).unwrap();
    assert_eq!(result.frame.runner.x_subpixels, 356);
    let mut falling = frame();
    falling.runner.grounded = false;
    falling.runner.vy_subpixels_per_tick = 4000;
    assert_eq!(
        step(&falling, &[floor()], &stats, &[])
            .unwrap()
            .frame
            .runner
            .y_subpixels,
        0
    );
    let ceiling = entity(
        2,
        purrps_game::state::run::EntityKind::Terrain,
        -5000,
        -800,
        20000,
        100,
    );
    assert_eq!(
        step(&frame(), &[floor(), ceiling], &stats, &[PlayerIntent::Jump])
            .unwrap()
            .frame
            .runner
            .y_subpixels,
        -700
    );
}

#[test]
fn hazards_precede_pickups_and_cashout_precedes_collisions() {
    use purrps_game::state::run::EntityKind;
    let stats = cat_stats(CatId::Collector, 1).unwrap();
    let result = step(
        &frame(),
        &[
            floor(),
            entity(2, EntityKind::Hazard, 6500, 0, 100, 7000),
            entity(3, EntityKind::Coin, 0, 0, 100, 100),
        ],
        &stats,
        &[],
    )
    .unwrap();
    assert_eq!(result.frame.terminal_reason, Some(TerminalReason::Crash));
    assert_eq!(result.frame.score, 0);
    let mut f = frame();
    f.qualified_checkpoints = 1;
    let result = step(
        &f,
        &[floor()],
        &stats,
        &[PlayerIntent::CashOut, PlayerIntent::Jump],
    )
    .unwrap();
    assert_eq!(result.frame.active_ticks, 0);
    assert_eq!(result.frame.runner.y_subpixels, 0);
    assert_eq!(result.frame.terminal_reason, Some(TerminalReason::CashOut));
}

#[test]
fn expired_and_refreshed_powers_and_all_levels_obey_boundaries() {
    for cat in [
        CatId::Collector,
        CatId::Acrobat,
        CatId::Guardian,
        CatId::Sprinter,
    ] {
        for level in 1..=5 {
            let stats = cat_stats(cat, level).unwrap();
            let f = step(&frame(), &[floor()], &stats, &[PlayerIntent::Boost])
                .unwrap()
                .frame;
            assert_eq!(
                f.powers[stats.power as usize].ready_at_tick,
                1 + u64::from(stats.power_cooldown_ticks)
            );
        }
    }
    let stats = cat_stats(CatId::Acrobat, 1).unwrap();
    let mut f = frame();
    f.active_ticks = 179;
    f.runner.grounded = false;
    f.powers[Power::DoubleJump as usize].ends_at_tick = 180;
    f.powers[Power::DoubleJump as usize].charges = 1;
    let result = step(&f, &[], &stats, &[PlayerIntent::Jump]).unwrap();
    assert_eq!(result.frame.runner.vy_subpixels_per_tick, 128);
}

#[test]
fn shield_contact_and_boosters_do_not_stack() {
    use purrps_game::state::run::EntityKind;
    let stats = cat_stats(CatId::Guardian, 1).unwrap();
    let result = step(
        &frame(),
        &[
            floor(),
            entity(2, EntityKind::Hazard, 0, 0, 100, 100),
            entity(3, EntityKind::Hazard, 0, 0, 100, 100),
        ],
        &stats,
        &[PlayerIntent::Boost],
    )
    .unwrap();
    assert_eq!(result.frame.terminal_reason, None);
    assert_eq!(result.frame.runner.shield_contact_ends_at_tick, 19);
    let mut f = frame();
    f.powers[Power::Shield as usize].ends_at_tick = 500;
    let result = step(
        &f,
        &[
            floor(),
            entity(2, EntityKind::Booster(Power::Shield), 3000, 3000, 100, 100),
        ],
        &stats,
        &[],
    )
    .unwrap();
    assert_eq!(result.frame.powers[2].ends_at_tick, 181);
    assert_eq!(result.frame.powers[2].charges, 1);
}

#[test]
fn checkpoint_resets_no_carry_and_overflow_is_atomic() {
    use purrps_game::state::run::EntityKind;
    let stats = cat_stats(CatId::Collector, 1).unwrap();
    let mut f = frame();
    f.active_ticks = 599;
    f.designated_coin_mask = 3;
    let mut coin = entity(2, EntityKind::Coin, 2000, 3000, 100, 100);
    coin.designated_coin = Some(2);
    let result = step(&f, &[floor(), coin], &stats, &[]).unwrap();
    assert_eq!(result.frame.qualified_checkpoints, 1);
    assert_eq!(result.frame.designated_coin_mask, 0);
    let mut later = result.frame;
    assert_eq!(
        step(&later, &[floor(), coin], &stats, &[])
            .unwrap()
            .frame
            .designated_coin_mask,
        0
    );
    later.score = u64::MAX;
    assert_eq!(
        step(&later, &[floor(), coin], &stats, &[]),
        Err(SimulationError::NumericOverflow)
    );
    assert_eq!(later.score, u64::MAX);
}

#[test]
fn suspended_ticks_and_invalid_world_are_rejected() {
    let stats = cat_stats(CatId::Collector, 1).unwrap();
    let mut f = frame();
    f.phase = RunPhase::Suspended;
    assert_eq!(step(&f, &[floor()], &stats, &[]).unwrap().frame, f);
    assert_eq!(
        step(&f, &[floor(), floor()], &stats, &[]),
        Err(SimulationError::InvalidWorld)
    );
}
