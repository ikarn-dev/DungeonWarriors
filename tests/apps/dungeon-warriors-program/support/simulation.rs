use dungeon_warriors::{
    protocol::RunPhase,
    simulation::SimulationFrame,
    state::run::{EntityKind, PowerState, RunnerState, WorldEntity},
};
pub fn frame() -> SimulationFrame {
    SimulationFrame {
        phase: RunPhase::Active,
        active_ticks: 0,
        runner: RunnerState {
            x_subpixels: 0,
            y_subpixels: 0,
            vx_subpixels_per_tick: 0,
            vy_subpixels_per_tick: 0,
            automatic_speed_subpixels_per_tick: 1024,
            grounded: true,
            axis: dungeon_warriors::protocol::InputAxis::Neutral,
            dash_ends_at_tick: 0,
            dash_ready_at_tick: 0,
            shield_contact_ends_at_tick: 0,
        },
        powers: [PowerState {
            ready_at_tick: 0,
            ends_at_tick: 0,
            charges: 0,
        }; 4],
        score: 0,
        total_coins: 0,
        designated_coin_mask: 0,
        qualified_checkpoints: 0,
        terminal_reason: None,
    }
}
pub fn entity(id: u64, kind: EntityKind, x: i32, y: i32, w: i32, h: i32) -> WorldEntity {
    WorldEntity {
        id,
        kind,
        x_subpixels: x,
        y_subpixels: y,
        width_subpixels: w,
        height_subpixels: h,
        designated_coin: None,
        designated_checkpoint: 0,
        consumed: false,
    }
}
pub fn floor() -> WorldEntity {
    entity(1, EntityKind::Terrain, -10000, 7168, 100000, 1000)
}
