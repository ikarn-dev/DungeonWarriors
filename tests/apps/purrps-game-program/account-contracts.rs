use anchor_lang::{
    AccountDeserialize, AccountSerialize, AnchorDeserialize, AnchorSerialize, Discriminator, Space,
};
use purrps_game::{
    contracts::Market,
    rules::RULES_V1,
    state::{
        collection::{Collection, PlayerAccount, SessionAuthorization},
        config::{CatalogVersion, GameConfig, GameRulesVersion},
        draws::CapsuleDraw,
        economy::{HouseState, RunEscrow, SponsorBudget},
        records::{Leaderboard, ResultReceipt},
        run::{RunGameState, MAX_QUEUED_INTENTS, MAX_RECENT_OBSERVATIONS, MAX_WORLD_ENTITIES},
    },
};

#[path = "support/run-state.rs"]
mod run_fixture;

fn account_size<T: Space + Discriminator>() -> usize {
    T::DISCRIMINATOR.len() + T::INIT_SPACE
}

#[test]
fn every_account_has_bounded_rent_and_fits_a_single_initial_allocation() {
    let sizes = [
        account_size::<GameConfig>(),
        account_size::<GameRulesVersion>(),
        account_size::<CatalogVersion>(),
        account_size::<PlayerAccount>(),
        account_size::<Collection>(),
        account_size::<SessionAuthorization>(),
        account_size::<HouseState>(),
        account_size::<RunEscrow>(),
        account_size::<SponsorBudget>(),
        account_size::<CapsuleDraw>(),
        account_size::<ResultReceipt>(),
        account_size::<Leaderboard>(),
        account_size::<RunGameState>(),
    ];
    for size in sizes {
        assert!(
            size > 8 && size <= 10_240,
            "account size {size} requires a different initialization path"
        );
    }
    assert!(
        account_size::<RunGameState>() > 4_096,
        "serialized capacity still exceeds one SBF stack frame"
    );
    assert!(std::mem::size_of::<RunGameState>() < 4096);
}

#[test]
fn full_run_buffers_round_trip_with_the_reserved_account_space() {
    let state = run_fixture::max_layout();
    let mut bytes = Vec::new();
    state.try_serialize(&mut bytes).unwrap();
    assert_eq!(bytes.len(), account_size::<RunGameState>());
    let decoded = RunGameState::try_deserialize(&mut bytes.as_slice()).unwrap();
    assert_eq!(decoded.entities, state.entities);
    assert_eq!(decoded.observations, state.observations);
    assert_eq!(decoded.intents, state.intents);
    assert_eq!(decoded.terminal, state.terminal);
    assert_eq!(decoded.world_generation, state.world_generation);
}

fn encoded_size<T: AnchorSerialize>(value: &T) -> usize {
    let mut bytes = Vec::new();
    value.serialize(&mut bytes).unwrap();
    bytes.len()
}

#[test]
fn run_buffer_lengths_are_checked_before_allocating_or_reading_elements() {
    let state = run_fixture::max_layout();
    let mut bytes = Vec::new();
    state.try_serialize(&mut bytes).unwrap();
    let entities = RunGameState::DISCRIMINATOR.len()
        + encoded_size(&(
            state.schema_version,
            state.bump,
            state.escrow,
            state.snapshot,
            state.snapshot_hash,
            state.phase,
            state.active_ticks,
            state.world_origin_pixels,
            state.runner,
        ));
    let observations = entities + encoded_size(&state.entities) + 1 + 8;
    let intents = observations
        + encoded_size(&state.observations)
        + 2
        + encoded_size(&state.start_observation);
    for (offset, capacity) in [
        (entities, MAX_WORLD_ENTITIES),
        (observations, MAX_RECENT_OBSERVATIONS),
        (intents, MAX_QUEUED_INTENTS),
    ] {
        for bad in [0, capacity as u32 + 1, u32::MAX] {
            let mut corrupt = bytes[..offset + 4].to_vec();
            corrupt[offset..offset + 4].copy_from_slice(&bad.to_le_bytes());
            let body = &corrupt[RunGameState::DISCRIMINATOR.len()..];
            match RunGameState::deserialize_reader(&mut &body[..]) {
                Err(error) => assert_eq!(error.kind(), std::io::ErrorKind::InvalidData),
                Ok(_) => panic!("malformed capacity accepted"),
            }
        }
    }
}

#[test]
fn run_buffer_serialization_rejects_resizing_the_fixed_slot_buffers() {
    let mut state = run_fixture::max_layout();
    state.entities.pop();
    assert!(state.try_serialize(&mut Vec::new()).is_err());
    let mut state = run_fixture::max_layout();
    state.observations.push(state.observations[0]);
    assert!(state.try_serialize(&mut Vec::new()).is_err());
    let mut state = run_fixture::max_layout();
    state.intents.clear();
    assert!(state.try_serialize(&mut Vec::new()).is_err());
}

#[test]
fn account_capacity_matches_the_published_rule_bounds() {
    assert_eq!(MAX_WORLD_ENTITIES, usize::from(RULES_V1.max_world_entities));
    assert_eq!(
        MAX_RECENT_OBSERVATIONS,
        usize::from(RULES_V1.max_recent_observations)
    );
    assert_eq!(MAX_QUEUED_INTENTS, usize::from(RULES_V1.max_queued_intents));
    assert_eq!(
        [
            Market::Btc.feed_id(),
            Market::Eth.feed_id(),
            Market::Sol.feed_id()
        ],
        [1, 2, 6]
    );
}

#[test]
fn account_types_cannot_be_substituted_by_reusing_a_discriminator() {
    let discriminators = [
        GameConfig::DISCRIMINATOR,
        GameRulesVersion::DISCRIMINATOR,
        CatalogVersion::DISCRIMINATOR,
        PlayerAccount::DISCRIMINATOR,
        Collection::DISCRIMINATOR,
        SessionAuthorization::DISCRIMINATOR,
        HouseState::DISCRIMINATOR,
        RunEscrow::DISCRIMINATOR,
        SponsorBudget::DISCRIMINATOR,
        CapsuleDraw::DISCRIMINATOR,
        ResultReceipt::DISCRIMINATOR,
        Leaderboard::DISCRIMINATOR,
        RunGameState::DISCRIMINATOR,
    ];
    for (index, discriminator) in discriminators.iter().enumerate() {
        assert_eq!(discriminator.len(), 8);
        assert!(!discriminators[..index].contains(discriminator));
    }
}
