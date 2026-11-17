use anchor_lang::{Discriminator, Space};
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
        "game state must use boxed account access"
    );
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
