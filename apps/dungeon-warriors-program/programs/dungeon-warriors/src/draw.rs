use crate::{
    catalog::{CatId, Catalog, Rarity},
    error::ErrorCode,
    state::{
        collection::{Collection, OwnedCat, StarterClaim},
        config::CatalogVersion,
        draws::{CapsuleDraw, CapsuleKind, DrawResult, DrawStatus},
    },
};
use anchor_lang::prelude::*;
use solana_sha256_hasher::hashv;

pub fn eligible_weights(catalog: &Catalog, mask: u8) -> Result<([u16; 4], u16)> {
    require!(mask & !15 == 0, ErrorCode::InvalidInventory);
    let weights = std::array::from_fn(|i| {
        if mask & (1 << i) == 0 {
            catalog.cats[i].weight
        } else {
            0
        }
    });
    let total = weights
        .iter()
        .try_fold(0u16, |sum, v| sum.checked_add(*v))
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    require!(total > 0, ErrorCode::InvalidInventory);
    Ok((weights, total))
}

// Rejection sampling avoids modulo bias; no client/server random choice is used.
pub fn weighted_cat(
    randomness: [u8; 32],
    seed: [u8; 32],
    weights: [u16; 4],
    total: u16,
) -> Result<CatId> {
    let index = sample_index(b"purrps:starter-draw:v1", randomness, seed, weights, total)?;
    Ok(CATS[index])
}

const CATS: [CatId; 4] = [
    CatId::Collector,
    CatId::Acrobat,
    CatId::Guardian,
    CatId::Sprinter,
];
const GRADES: [Rarity; 3] = [Rarity::Common, Rarity::Rare, Rarity::Epic];

fn sample_index(
    domain: &[u8],
    randomness: [u8; 32],
    seed: [u8; 32],
    weights: [u16; 4],
    total: u16,
) -> Result<usize> {
    require!(
        total > 0 && weights.iter().map(|v| u32::from(*v)).sum::<u32>() == u32::from(total),
        ErrorCode::InvalidInventory
    );
    let zone = u64::MAX - u64::MAX % u64::from(total);
    for counter in 0u32..8 {
        let digest = hashv(&[domain, &randomness, &seed, &counter.to_le_bytes()]).to_bytes();
        let sample = u64::from_le_bytes(
            digest[..8]
                .try_into()
                .map_err(|_| error!(ErrorCode::InvalidCallback))?,
        );
        if sample >= zone {
            continue;
        }
        let mut cursor = (sample % u64::from(total)) as u16;
        for (index, weight) in weights.iter().enumerate() {
            if cursor < *weight {
                return Ok(index);
            }
            cursor -= weight;
        }
    }
    err!(ErrorCode::InvalidCallback)
}

pub fn grant_starter(
    draw_key: Pubkey,
    draw: &mut CapsuleDraw,
    collection: &mut Collection,
    catalog: &CatalogVersion,
    randomness: [u8; 32],
    seed: [u8; 32],
    now: i64,
) -> Result<()> {
    require!(
        draw.kind == CapsuleKind::StarterCat
            && draw.status == DrawStatus::Pending
            && draw.result.is_none()
            && draw.committed_seed_hash == seed
            && draw.owner == collection.owner
            && collection.pending_draw == Some(draw_key)
            && draw.completed_at_seconds.is_none()
            && collection.starter == StarterClaim::Pending
            && collection.inventory_version == draw.inventory_version
            && draw.catalog == catalog.binding
            && draw.price_base_units == 0
            && draw.paid_deadline_seconds.is_none()
            && draw.eligible_mask == (!collection.owned_mask & 15),
        ErrorCode::InvalidCallback
    );
    let (weights, total) = eligible_weights(&catalog.catalog, collection.owned_mask)?;
    require!(
        draw.weights == weights && draw.total_weight == total,
        ErrorCode::InvalidCallback
    );
    let cat = weighted_cat(randomness, seed, weights, total)?;
    award_cat(collection, catalog, cat)?;
    collection.starter = StarterClaim::Fulfilled;
    finish_draw(draw, collection, DrawResult::Cat(cat), now);
    Ok(())
}

fn award_cat(collection: &mut Collection, catalog: &CatalogVersion, cat: CatId) -> Result<()> {
    let index = cat as usize;
    require!(
        collection.cats[index].is_none(),
        ErrorCode::InvalidInventory
    );
    let version = collection
        .inventory_version
        .checked_add(1)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    let definition = catalog.catalog.cats[index];
    require!(definition.id == cat, ErrorCode::InvalidInventory);
    collection.cats[index] = Some(OwnedCat {
        cat,
        rarity: definition.rarity,
        defining_catalog: catalog.binding,
        level: 1,
    });
    collection.owned_mask |= 1 << index;
    if collection.selected_cat.is_none() {
        collection.selected_cat = Some(cat);
    }
    collection.inventory_version = version;
    Ok(())
}

fn finish_draw(draw: &mut CapsuleDraw, collection: &mut Collection, result: DrawResult, now: i64) {
    collection.pending_draw = None;
    draw.status = DrawStatus::Fulfilled;
    draw.result = Some(result);
    draw.completed_at_seconds = Some(now);
}

pub fn paid_pool(
    kind: CapsuleKind,
    collection: &Collection,
    catalog: &Catalog,
) -> Result<(u8, [u16; 4], u16, u64)> {
    require!(
        collection.starter == StarterClaim::Fulfilled,
        ErrorCode::InvalidInventory
    );
    match kind {
        CapsuleKind::PaidCat => {
            let (weights, total) = eligible_weights(catalog, collection.owned_mask)?;
            Ok((
                !collection.owned_mask & 15,
                weights,
                total,
                catalog.cat_price_base_units,
            ))
        }
        CapsuleKind::Upgrade => {
            require!(
                collection
                    .cats
                    .iter()
                    .flatten()
                    .any(|cat| (1..catalog.max_cat_level).contains(&cat.level)),
                ErrorCode::InvalidInventory
            );
            let mut weights = [0; 4];
            for (index, grade) in catalog.upgrades.iter().enumerate() {
                require!(grade.rarity == GRADES[index], ErrorCode::InvalidCatalog);
                weights[index] = grade.weight;
            }
            let total = weights
                .iter()
                .try_fold(0u16, |sum, weight| sum.checked_add(*weight))
                .ok_or(ErrorCode::ArithmeticOverflow)?;
            require!(total > 0, ErrorCode::InvalidInventory);
            Ok((7, weights, total, catalog.upgrade_price_base_units))
        }
        CapsuleKind::StarterCat => err!(ErrorCode::InvalidInventory),
    }
}

pub fn paid_deadline(draw_key: Pubkey, draw: &CapsuleDraw, collection: &Collection) -> Result<i64> {
    require!(
        draw.kind != CapsuleKind::StarterCat
            && draw.status == DrawStatus::Pending
            && draw.result.is_none()
            && draw.completed_at_seconds.is_none()
            && draw.owner == collection.owner
            && collection.pending_draw == Some(draw_key)
            && collection.inventory_version == draw.inventory_version
            && draw.price_base_units > 0,
        ErrorCode::InvalidInventory
    );
    draw.paid_deadline_seconds
        .ok_or_else(|| error!(ErrorCode::InvalidInventory))
}

pub fn grant_paid(
    draw_key: Pubkey,
    draw: &mut CapsuleDraw,
    collection: &mut Collection,
    catalog: &CatalogVersion,
    randomness: [u8; 32],
    seed: [u8; 32],
    now: i64,
) -> Result<()> {
    let deadline = paid_deadline(draw_key, draw, collection)?;
    require!(now < deadline, ErrorCode::DrawExpired);
    require!(
        draw.committed_seed_hash == seed && draw.catalog == catalog.binding,
        ErrorCode::InvalidCallback
    );
    require!(
        paid_pool(draw.kind, collection, &catalog.catalog)?
            == (
                draw.eligible_mask,
                draw.weights,
                draw.total_weight,
                draw.price_base_units
            ),
        ErrorCode::InvalidCallback
    );
    let index = sample_index(
        b"purrps:paid-draw:v1",
        randomness,
        seed,
        draw.weights,
        draw.total_weight,
    )?;
    let result = match draw.kind {
        CapsuleKind::PaidCat => {
            let cat = CATS[index];
            award_cat(collection, catalog, cat)?;
            DrawResult::Cat(cat)
        }
        CapsuleKind::Upgrade => {
            let grade = *GRADES.get(index).ok_or(ErrorCode::InvalidCallback)?;
            let quantity = collection.upgrade_quantities[index]
                .checked_add(1)
                .ok_or(ErrorCode::ArithmeticOverflow)?;
            collection.inventory_version = collection
                .inventory_version
                .checked_add(1)
                .ok_or(ErrorCode::ArithmeticOverflow)?;
            collection.upgrade_quantities[index] = quantity;
            DrawResult::Upgrade(grade)
        }
        CapsuleKind::StarterCat => return err!(ErrorCode::InvalidCallback),
    };
    finish_draw(draw, collection, result, now);
    Ok(())
}
