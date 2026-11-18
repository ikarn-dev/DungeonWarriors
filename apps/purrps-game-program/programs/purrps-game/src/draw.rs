use crate::{
    catalog::{CatId, Catalog},
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
    require!(
        total > 0 && weights.iter().map(|v| u32::from(*v)).sum::<u32>() == u32::from(total),
        ErrorCode::InvalidInventory
    );
    let zone = u64::MAX - u64::MAX % u64::from(total);
    for counter in 0u32..8 {
        let digest = hashv(&[
            b"purrps:starter-draw:v1",
            &randomness,
            &seed,
            &counter.to_le_bytes(),
        ])
        .to_bytes();
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
                return Ok([
                    CatId::Collector,
                    CatId::Acrobat,
                    CatId::Guardian,
                    CatId::Sprinter,
                ][index]);
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
        defining_catalog: draw.catalog,
        level: 1,
    });
    collection.owned_mask |= 1 << index;
    if collection.selected_cat.is_none() {
        collection.selected_cat = Some(cat);
    }
    collection.inventory_version = version;
    collection.starter = StarterClaim::Fulfilled;
    collection.pending_draw = None;
    draw.status = DrawStatus::Fulfilled;
    draw.result = Some(DrawResult::Cat(cat));
    draw.completed_at_seconds = Some(now);
    Ok(())
}
