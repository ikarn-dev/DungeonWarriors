use super::{
    collision::surface_at, step_for_rules, validate_frame, validate_world, SimulationError,
    SimulationFrame,
};
use crate::{
    catalog::{CatStats, Power},
    protocol::{PlayerIntent, RunPhase},
    rules::{platform_gap, price_change_bps, speed_bps_for_rules, GameRules, RULES_V1, RULES_V3},
    state::run::{EntityKind, GenerationState, WorldEntity, MAX_WORLD_ENTITIES},
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PriceSample {
    pub previous_price: i64,
    pub previous_exponent: i32,
    pub price: i64,
    pub exponent: i32,
}

// Projection of the persisted run fields, not a second account or clock.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorldState {
    pub frame: SimulationFrame,
    pub entities: Vec<WorldEntity>,
    pub generation: GenerationState,
    pub world_origin_pixels: u64,
    pub next_entity_id: u64,
}

fn coordinate(value: i64) -> Result<i32, SimulationError> {
    if value.abs() > i64::from(RULES_V1.physics.coordinate_limit_subpixels) {
        return Err(SimulationError::NumericOverflow);
    }
    Ok(value as i32)
}

fn coin_distance(speed: i32, target: i32, ticks: u16) -> i64 {
    let ease = i64::from(RULES_V1.physics.speed_easing_subpixels_per_tick);
    let accelerating = i64::from(ticks).min(i64::from(target - speed) / ease);
    accelerating * i64::from(speed)
        + ease * accelerating * (accelerating + 1) / 2
        + (i64::from(ticks) - accelerating) * i64::from(target)
}

// The whole hitbox must leave support for at least one tick, even at full speed.
fn minimum_gap(rules: &GameRules) -> i32 {
    rules.physics.hitbox_width_subpixels + rules.physics.max_velocity_subpixels_per_tick
}

fn validate_state(state: &WorldState, rules: &GameRules) -> Result<(), SimulationError> {
    validate_world(&state.entities)?;
    let g = state.generation;
    let p = RULES_V1.physics;
    let width = RULES_V1.generation.segment_width_subpixels;
    let checkpoint = state.frame.active_ticks / u64::from(RULES_V1.checkpoint_ticks);
    let target = i64::from(p.runner_speed_subpixels_per_tick)
        * i64::from(speed_bps_for_rules(state.frame.active_ticks, rules))
        / 10_000;
    if g.checkpoint > checkpoint
        || checkpoint - g.checkpoint > 1
        || g.spawned_coin_mask & !31 != 0
        || g.spawned_hazard_mask & !7 != 0
        || !(i64::from(p.runner_speed_subpixels_per_tick)..=target)
            .contains(&i64::from(g.checkpoint_speed_subpixels_per_tick))
        || g.checkpoint != checkpoint
            && state.frame.active_ticks % u64::from(RULES_V1.checkpoint_ticks) != 0
        || i64::from(g.next_x_subpixels) + i64::from(width)
            < i64::from(state.frame.runner.x_subpixels)
        || g.surface_y_subpixels < i32::from(p.viewport_height_pixels) * 256 / 4
        || g.surface_y_subpixels > i32::from(p.viewport_height_pixels) * 256 * 3 / 4
        || state
            .entities
            .last()
            .is_some_and(|e| e.id >= state.next_entity_id)
    {
        return Err(SimulationError::InvalidWorld);
    }
    for value in [
        g.next_x_subpixels,
        g.checkpoint_x_subpixels,
        state.frame.runner.x_subpixels,
    ] {
        coordinate(i64::from(value))?;
    }
    let mut ramps: Vec<_> = state
        .entities
        .iter()
        .filter(|e| matches!(e.kind, EntityKind::Ramp(_)))
        .collect();
    ramps.sort_by_key(|e| e.x_subpixels);
    let Some(first) = ramps.first() else {
        return Err(SimulationError::InvalidWorld);
    };
    let first_segment = g
        .next_segment
        .checked_sub(ramps.len() as u64)
        .ok_or(SimulationError::InvalidWorld)?;
    let horizon = i64::from(state.frame.runner.x_subpixels)
        + i64::from(width) * i64::from(RULES_V1.generation.lookahead_segments);
    if first.x_subpixels > state.frame.runner.x_subpixels
        || i64::from(g.next_x_subpixels) < horizon - i64::from(p.max_velocity_subpixels_per_tick)
        || i64::from(g.next_x_subpixels) > horizon + i64::from(width)
        || ramps.iter().enumerate().any(|(index, ramp)| {
            let (next_x, next_y) = ramps
                .get(index + 1)
                .map_or((g.next_x_subpixels, g.surface_y_subpixels), |next| {
                    (next.x_subpixels, next.y_subpixels)
                });
            let edge = ramp.x_subpixels + ramp.width_subpixels;
            let gap = next_x - edge;
            let has_gap = platform_gap(rules, first_segment + index as u64);
            surface_at(ramp, i64::from(edge)) != Some(i64::from(next_y))
                || (rules.rules_version >= RULES_V3.rules_version
                    && next_x - ramp.x_subpixels != width)
                || if has_gap {
                    !(minimum_gap(rules)..=rules.physics.max_required_gap_subpixels).contains(&gap)
                } else {
                    gap != 0
                }
        })
    {
        return Err(SimulationError::InvalidWorld);
    }
    Ok(())
}

fn push(state: &mut WorldState, mut entity: WorldEntity) -> Result<(), SimulationError> {
    if state.entities.len() >= MAX_WORLD_ENTITIES {
        return Err(SimulationError::InvalidWorld);
    }
    entity.id = state.next_entity_id;
    state.next_entity_id = state
        .next_entity_id
        .checked_add(1)
        .ok_or(SimulationError::NumericOverflow)?;
    state.entities.push(entity);
    Ok(())
}

fn entity(kind: EntityKind, x: i32, y: i32, width: i32, height: i32) -> WorldEntity {
    WorldEntity {
        id: 0,
        kind,
        x_subpixels: x,
        y_subpixels: y,
        width_subpixels: width,
        height_subpixels: height,
        designated_coin: None,
        designated_checkpoint: 0,
        consumed: false,
    }
}

fn rebase(state: &mut WorldState) -> Result<(), SimulationError> {
    let p = RULES_V1.physics;
    if i64::from(state.frame.runner.x_subpixels) < i64::from(p.viewport_width_pixels) * 256 * 4 {
        return Ok(());
    }
    let width = RULES_V1.generation.segment_width_subpixels;
    let shift = (state.frame.runner.x_subpixels / width - 1) * width;
    state.world_origin_pixels = state
        .world_origin_pixels
        .checked_add((shift / 256) as u64)
        .ok_or(SimulationError::NumericOverflow)?;
    state.frame.runner.x_subpixels =
        coordinate(i64::from(state.frame.runner.x_subpixels) - i64::from(shift))?;
    for e in &mut state.entities {
        e.x_subpixels = coordinate(i64::from(e.x_subpixels) - i64::from(shift))?;
    }
    state.generation.next_x_subpixels =
        coordinate(i64::from(state.generation.next_x_subpixels) - i64::from(shift))?;
    state.generation.checkpoint_x_subpixels =
        coordinate(i64::from(state.generation.checkpoint_x_subpixels) - i64::from(shift))?;
    Ok(())
}

fn prepare(
    state: &mut WorldState,
    sample: PriceSample,
    game_rules: &GameRules,
) -> Result<(), SimulationError> {
    let change = price_change_bps(
        sample.previous_price,
        sample.previous_exponent,
        sample.price,
        sample.exponent,
    )
    .map_err(|_| SimulationError::InvalidObservation)?;
    let p = game_rules.physics;
    let rules = game_rules.generation;
    let progressive = game_rules.rules_version >= 2;
    let platforms = game_rules.rules_version >= RULES_V3.rules_version;
    let terrain_step = if progressive {
        let maximum = i128::from(p.max_required_rise_subpixels);
        let change = i128::from(sample.previous_price) - i128::from(sample.price);
        (change * 10_000 * maximum
            / (i128::from(sample.previous_price) * i128::from(rules.max_sample_change_bps)))
        .clamp(-maximum, maximum) as i32
    } else {
        crate::rules::terrain_step_subpixels(change)
    };
    let width = rules.segment_width_subpixels;
    let minimum_gap = minimum_gap(game_rules);
    let cutoff = i64::from(state.frame.runner.x_subpixels) - 2 * i64::from(width);
    state.entities.retain(|e| {
        !e.consumed && i64::from(e.x_subpixels) + i64::from(e.width_subpixels) >= cutoff
    });
    rebase(state)?;
    let checkpoint = state.frame.active_ticks / u64::from(RULES_V1.checkpoint_ticks);
    if state.generation.checkpoint != checkpoint {
        state.generation.checkpoint = checkpoint;
        state.generation.checkpoint_x_subpixels = state.frame.runner.x_subpixels;
        state.generation.checkpoint_speed_subpixels_per_tick =
            state.frame.runner.automatic_speed_subpixels_per_tick;
        state.generation.spawned_coin_mask = 0;
        state.generation.spawned_hazard_mask = 0;
    }
    let horizon = i64::from(state.frame.runner.x_subpixels)
        + i64::from(width) * i64::from(rules.lookahead_segments);
    for _ in 0..=rules.lookahead_segments + 2 {
        if i64::from(state.generation.next_x_subpixels) >= horizon {
            break;
        }
        let g = state.generation;
        let gap = if platform_gap(game_rules, g.next_segment) {
            minimum_gap
                + (p.max_required_gap_subpixels - minimum_gap) * terrain_step.abs()
                    / p.max_required_rise_subpixels
        } else {
            0
        };
        let platform_width = width - gap;
        let rise_limit = p.max_required_rise_subpixels * platform_width / width;
        let rise = terrain_step.clamp(-rise_limit, rise_limit);
        let end_y = if g.next_segment < 2 {
            g.surface_y_subpixels
        } else {
            (g.surface_y_subpixels + rise).clamp(
                i32::from(p.viewport_height_pixels) * 256 / 4,
                i32::from(p.viewport_height_pixels) * 256 * 3 / 4,
            )
        };
        let ramp = entity(
            EntityKind::Ramp(end_y - g.surface_y_subpixels),
            g.next_x_subpixels,
            g.surface_y_subpixels,
            platform_width,
            p.hitbox_height_subpixels,
        );
        push(state, ramp)?;
        if g.next_segment >= 2
            && (g.next_segment % u64::from(rules.booster_stride_segments) == 0
                || (change.abs() >= i32::from(rules.sharp_move_bps) && g.next_segment % 2 == 0))
        {
            let power = [
                Power::Magnet,
                Power::DoubleJump,
                Power::Shield,
                Power::ExtraDash,
            ][(g.next_segment / u64::from(rules.booster_stride_segments) % 4) as usize];
            let booster = g.next_segment % u64::from(rules.booster_stride_segments) == 0;
            let kind = if booster {
                EntityKind::Booster(power)
            } else {
                EntityKind::Star
            };
            let x = coordinate(i64::from(g.next_x_subpixels) + i64::from(platform_width / 2))?;
            let pickup_height = if progressive && booster {
                p.hitbox_height_subpixels + 16 * 256
            } else {
                p.max_required_rise_subpixels + 8 * 256
            };
            let y =
                coordinate(surface_at(&ramp, i64::from(x)).unwrap() - i64::from(pickup_height))?;
            push(state, entity(kind, x, y, 8 * 256, 8 * 256))?;
        }
        state.generation.next_x_subpixels =
            coordinate(i64::from(g.next_x_subpixels) + i64::from(width))?;
        state.generation.surface_y_subpixels = end_y;
        state.generation.next_segment = g
            .next_segment
            .checked_add(1)
            .ok_or(SimulationError::NumericOverflow)?;
    }
    let target = (i64::from(p.runner_speed_subpixels_per_tick)
        * i64::from(speed_bps_for_rules(state.frame.active_ticks, game_rules))
        / 10_000) as i32;
    // Hazards sit between required coin opportunities, allowing a base jump and landing.
    let coins = rules.designated_coin_ticks;
    let hazards = [
        (coins[0] + coins[1]) / 2,
        (coins[2] + coins[3]) / 2,
        coins[4] + p.min_required_coin_spacing_ticks / 2,
    ];
    for (hazard, ticks) in [(false, coins.as_slice()), (true, hazards.as_slice())] {
        for (index, tick) in ticks.iter().enumerate() {
            let mask = if hazard {
                state.generation.spawned_hazard_mask
            } else {
                state.generation.spawned_coin_mask
            };
            if mask & (1 << index) != 0 {
                continue;
            }
            let mut x = coordinate(
                i64::from(state.generation.checkpoint_x_subpixels)
                    + coin_distance(
                        state.generation.checkpoint_speed_subpixels_per_tick,
                        target,
                        *tick,
                    )
                    + i64::from(p.hitbox_width_subpixels / 2),
            )?;
            let Some(tile) = state.entities.iter().find(|e| {
                matches!(e.kind, EntityKind::Ramp(_))
                    && x >= e.x_subpixels
                    && i64::from(x)
                        < i64::from(e.x_subpixels)
                            + i64::from(if platforms { width } else { e.width_subpixels })
            }) else {
                continue;
            };
            if platforms {
                // Keep the coin on its departure platform and the jump clear of hazards.
                let end = tile.x_subpixels + tile.width_subpixels;
                if tile.width_subpixels < width {
                    x = x.min(end - p.hitbox_width_subpixels / 2);
                }
                let clearance = p.min_landing_width_subpixels * 2;
                if hazard
                    && state.entities.iter().any(|e| {
                        let edge = e.x_subpixels + e.width_subpixels;
                        matches!(e.kind, EntityKind::Ramp(_))
                            && e.width_subpixels < width
                            && x >= edge - clearance
                            && x <= e.x_subpixels + width + clearance
                    })
                {
                    state.generation.spawned_hazard_mask |= 1 << index;
                    continue;
                }
            }
            let surface = surface_at(tile, i64::from(x)).unwrap();
            // Keep jump windows between coins. Later levels add baseline obstacles.
            if !hazard
                || (progressive && index <= (checkpoint / 3).min(2) as usize)
                || change.abs() >= i32::from(rules.sharp_move_bps)
            {
                let size = if hazard {
                    p.hitbox_width_subpixels / 2
                        + if progressive {
                            checkpoint.min(8) as i32 * 256
                        } else {
                            0
                        }
                } else {
                    8 * 256
                };
                let mut item = entity(
                    if hazard {
                        EntityKind::Hazard
                    } else {
                        EntityKind::Coin
                    },
                    coordinate(i64::from(x) - i64::from(size / 2))?,
                    coordinate(
                        surface
                            - i64::from(if hazard {
                                size
                            } else {
                                (p.hitbox_height_subpixels + size) / 2
                            }),
                    )?,
                    size,
                    size,
                );
                if !hazard {
                    item.designated_coin = Some(index as u8);
                    item.designated_checkpoint = checkpoint;
                }
                push(state, item)?;
            }
            if hazard {
                state.generation.spawned_hazard_mask |= 1 << index;
            } else {
                state.generation.spawned_coin_mask |= 1 << index;
            }
        }
    }
    validate_state(state, game_rules)
}

pub fn initialize_world(
    frame: SimulationFrame,
    stats: &CatStats,
    sample: PriceSample,
) -> Result<WorldState, SimulationError> {
    initialize_world_for_rules(frame, stats, sample, &RULES_V1)
}

pub fn initialize_world_for_rules(
    frame: SimulationFrame,
    stats: &CatStats,
    sample: PriceSample,
    game_rules: &GameRules,
) -> Result<WorldState, SimulationError> {
    validate_frame(&frame, stats)?;
    if frame.active_ticks != 0
        || frame.runner.x_subpixels != 0
        || !matches!(frame.phase, RunPhase::Ready | RunPhase::Active)
        || frame.runner.automatic_speed_subpixels_per_tick
            != RULES_V1.physics.runner_speed_subpixels_per_tick
        || frame.score != 0
        || frame.total_coins != 0
        || frame.qualified_checkpoints != 0
        || frame.designated_coin_mask != 0
        || frame.terminal_reason.is_some()
    {
        return Err(SimulationError::InvalidFrame);
    }
    let generation = GenerationState {
        next_segment: 0,
        next_x_subpixels: -RULES_V1.generation.segment_width_subpixels,
        surface_y_subpixels: coordinate(
            i64::from(frame.runner.y_subpixels)
                + i64::from(RULES_V1.physics.hitbox_height_subpixels),
        )?,
        checkpoint: 0,
        checkpoint_x_subpixels: 0,
        checkpoint_speed_subpixels_per_tick: frame.runner.automatic_speed_subpixels_per_tick,
        spawned_coin_mask: 0,
        spawned_hazard_mask: 0,
    };
    let mut world = WorldState {
        frame,
        generation,
        entities: Vec::new(),
        world_origin_pixels: 0,
        next_entity_id: 0,
    };
    prepare(&mut world, sample, game_rules)?;
    Ok(world)
}

pub fn step_world(
    state: &WorldState,
    stats: &CatStats,
    actions: &[PlayerIntent],
    sample: PriceSample,
) -> Result<WorldState, SimulationError> {
    step_world_for_rules(state, stats, actions, sample, &RULES_V1)
}

pub fn step_world_for_rules(
    state: &WorldState,
    stats: &CatStats,
    actions: &[PlayerIntent],
    sample: PriceSample,
    game_rules: &GameRules,
) -> Result<WorldState, SimulationError> {
    validate_state(state, game_rules)?;
    validate_frame(&state.frame, stats)?;
    let mut result = state.clone();
    if state.frame.phase != RunPhase::Active {
        return Ok(result);
    }
    prepare(&mut result, sample, game_rules)?;
    let next = step_for_rules(&result.frame, &result.entities, stats, actions, game_rules)?;
    result.frame = next.frame;
    result.entities = next.entities;
    Ok(result)
}
