use anchor_lang::prelude::*;

use crate::rules::{ContractError, RULES_V1};

#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Debug, Clone, Copy, PartialEq, Eq)]
pub enum CatId {
    Collector,
    Acrobat,
    Guardian,
    Sprinter,
}

#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Debug, Clone, Copy, PartialEq, Eq)]
pub enum Rarity {
    Common,
    Rare,
    Epic,
}

#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Debug, Clone, Copy, PartialEq, Eq)]
pub enum Power {
    Magnet,
    DoubleJump,
    Shield,
    ExtraDash,
}

#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Debug, Clone, Copy, PartialEq, Eq)]
pub struct CatDefinition {
    pub id: CatId,
    pub rarity: Rarity,
    pub weight: u16,
    pub power: Power,
    pub pickup_radius_bps: u16,
    pub air_control_bps: u16,
    pub dash_duration_bps: u16,
    pub dash_cooldown_bps: u16,
}

#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Debug, Clone, Copy, PartialEq, Eq)]
pub struct UpgradeDefinition {
    pub rarity: Rarity,
    pub weight: u16,
    pub level_gain: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Debug, Clone, Copy, PartialEq, Eq)]
pub struct Catalog {
    pub schema_version: u16,
    pub catalog_version: u32,
    pub cats: [CatDefinition; 4],
    pub upgrades: [UpgradeDefinition; 3],
    pub starter_price_base_units: u64,
    pub cat_price_base_units: u64,
    pub upgrade_price_base_units: u64,
    pub max_cat_level: u8,
    pub power_cooldown_ticks: [u16; 5],
    pub magnet_radius_bps: u16,
    pub power_charges: u8,
}

pub const CATALOG_V1: Catalog = Catalog {
    schema_version: 1,
    catalog_version: 1,
    cats: [
        CatDefinition {
            id: CatId::Collector,
            rarity: Rarity::Common,
            weight: 3_500,
            power: Power::Magnet,
            pickup_radius_bps: 12_500,
            air_control_bps: 10_000,
            dash_duration_bps: 10_000,
            dash_cooldown_bps: 12_500,
        },
        CatDefinition {
            id: CatId::Acrobat,
            rarity: Rarity::Common,
            weight: 3_500,
            power: Power::DoubleJump,
            pickup_radius_bps: 10_000,
            air_control_bps: 12_500,
            dash_duration_bps: 8_000,
            dash_cooldown_bps: 10_000,
        },
        CatDefinition {
            id: CatId::Guardian,
            rarity: Rarity::Rare,
            weight: 2_500,
            power: Power::Shield,
            pickup_radius_bps: 10_000,
            air_control_bps: 10_000,
            dash_duration_bps: 10_000,
            dash_cooldown_bps: 12_500,
        },
        CatDefinition {
            id: CatId::Sprinter,
            rarity: Rarity::Epic,
            weight: 500,
            power: Power::ExtraDash,
            pickup_radius_bps: 7_500,
            air_control_bps: 10_000,
            dash_duration_bps: 10_000,
            dash_cooldown_bps: 7_500,
        },
    ],
    upgrades: [
        UpgradeDefinition {
            rarity: Rarity::Common,
            weight: 7_000,
            level_gain: 1,
        },
        UpgradeDefinition {
            rarity: Rarity::Rare,
            weight: 2_500,
            level_gain: 2,
        },
        UpgradeDefinition {
            rarity: Rarity::Epic,
            weight: 500,
            level_gain: 3,
        },
    ],
    starter_price_base_units: 0,
    cat_price_base_units: 2_000_000,
    upgrade_price_base_units: 1_000_000,
    max_cat_level: 5,
    power_cooldown_ticks: [1_200, 1_080, 960, 840, 720],
    magnet_radius_bps: 20_000,
    power_charges: 1,
};

#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Debug, Clone, Copy, PartialEq, Eq)]
pub struct CatStats {
    pub power: Power,
    pub power_cooldown_ticks: u16,
    pub pickup_radius_subpixels: i32,
    pub air_control_subpixels_per_tick: i32,
    pub dash_duration_ticks: u16,
    pub dash_cooldown_ticks: u16,
}

pub fn cat_stats(cat: CatId, level: u8) -> std::result::Result<CatStats, ContractError> {
    if !(1..=CATALOG_V1.max_cat_level).contains(&level) {
        return Err(ContractError::InvalidLevel);
    }
    let definition = CATALOG_V1.cats[cat as usize];
    let physics = RULES_V1.physics;
    Ok(CatStats {
        power: definition.power,
        power_cooldown_ticks: CATALOG_V1.power_cooldown_ticks[usize::from(level - 1)],
        pickup_radius_subpixels: physics.pickup_radius_subpixels
            * i32::from(definition.pickup_radius_bps)
            / 10_000,
        air_control_subpixels_per_tick: physics.air_control_subpixels_per_tick
            * i32::from(definition.air_control_bps)
            / 10_000,
        dash_duration_ticks: (u32::from(physics.dash_duration_ticks)
            * u32::from(definition.dash_duration_bps)
            / 10_000) as u16,
        dash_cooldown_ticks: (u32::from(physics.dash_cooldown_ticks)
            * u32::from(definition.dash_cooldown_bps)
            / 10_000) as u16,
    })
}

pub fn eligible_cat_weights(owned_mask: u8) -> std::result::Result<([u16; 4], u16), ContractError> {
    if owned_mask & !0b1111 != 0 {
        return Err(ContractError::InvalidMask);
    }
    let weights = std::array::from_fn(|index| {
        if owned_mask & (1 << index) == 0 {
            CATALOG_V1.cats[index].weight
        } else {
            0
        }
    });
    let total = weights.iter().sum();
    if total == 0 {
        return Err(ContractError::EmptyDrawPool);
    }
    Ok((weights, total))
}

// Quantity/owner/pending/version checks belong to the atomic apply instruction.
pub fn upgraded_level(current_level: u8, grade: Rarity) -> std::result::Result<u8, ContractError> {
    if !(1..CATALOG_V1.max_cat_level).contains(&current_level) {
        return Err(ContractError::InvalidLevel);
    }
    Ok(
        (current_level + CATALOG_V1.upgrades[grade as usize].level_gain)
            .min(CATALOG_V1.max_cat_level),
    )
}
