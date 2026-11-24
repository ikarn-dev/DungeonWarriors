use super::house::assert_vault;
use crate::{
    constants::*,
    dungeon::*,
    error::ErrorCode,
    state::{
        collection::PlayerAccount,
        config::GameConfig,
        dungeon::{DungeonExpedition, DungeonStatus},
        economy::HouseState,
        records::{Leaderboard, LeaderboardEntry},
    },
};
use anchor_lang::prelude::*;
use anchor_spl::token::TokenAccount;
use ephemeral_rollups_sdk::vrf::anchor::vrf_callback;
use solana_sha256_hasher::hashv;

#[vrf_callback]
#[derive(Accounts)]
pub struct FulfillDungeon<'info> {
    #[account(mut,seeds=[EXPEDITION_SEED,expedition.owner.as_ref(),&expedition.nonce.to_le_bytes()],
        bump=expedition.bump,constraint=expedition.schema_version==SCHEMA_VERSION @ ErrorCode::InvalidRun)]
    pub expedition: Box<Account<'info, DungeonExpedition>>,
}
pub fn handle_fulfill_dungeon(
    ctx: Context<FulfillDungeon>,
    randomness: [u8; 32],
    seed: [u8; 32],
) -> Result<()> {
    let e = &mut ctx.accounts.expedition;
    require!(
        e.status == DungeonStatus::AwaitingRandomness
            && e.randomness.is_none()
            && e.request_seed == seed
            && e.callback_authority == ctx.accounts.vrf_program_identity.key()
            && Clock::get()?.unix_timestamp < e.randomness_deadline,
        ErrorCode::InvalidCallback
    );
    e.randomness = Some(randomness);
    e.status = DungeonStatus::Ready;
    Ok(())
}
#[derive(Accounts)]
pub struct ResolveDungeon<'info> {
    #[account(seeds=[GAME_CONFIG_SEED],bump=config.bump)]
    pub config: Box<Account<'info, GameConfig>>,
    #[account(mut,seeds=[EXPEDITION_SEED,expedition.owner.as_ref(),&expedition.nonce.to_le_bytes()],
        bump=expedition.bump,constraint=expedition.schema_version==SCHEMA_VERSION @ ErrorCode::InvalidRun)]
    pub expedition: Box<Account<'info, DungeonExpedition>>,
    #[account(mut,seeds=[PLAYER_SEED,expedition.owner.as_ref()],bump=player.bump,
        constraint=player.owner==expedition.owner @ ErrorCode::InvalidOwner)]
    pub player: Box<Account<'info, PlayerAccount>>,
    #[account(mut,seeds=[HOUSE_SEED],bump=house.bump,has_one=config)]
    pub house: Box<Account<'info, HouseState>>,
    #[account(address=house.vault)]
    pub vault: Box<Account<'info, TokenAccount>>,
}
#[derive(Accounts)]
pub struct SettleDungeon<'info> {
    pub resolution: ResolveDungeon<'info>,
    #[account(address=resolution.expedition.verifier)]
    pub verifier: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(init_if_needed,payer=payer,space=8+Leaderboard::INIT_SPACE,
        seeds=[b"dungeon-leaderboard"],bump)]
    pub leaderboard: Box<Account<'info, Leaderboard>>,
    pub system_program: Program<'info, System>,
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct DungeonResult {
    pub secret: [u8; 32],
    pub gates: [u8; MAX_ROOMS],
    pub gate_count: u8,
    // 0: banked reward, 1: trap/timeout/abandonment, 2: unstarted technical refund.
    pub outcome: u8,
}
pub fn handle_settle_dungeon(ctx: Context<SettleDungeon>, args: DungeonResult) -> Result<()> {
    let a = &mut ctx.accounts.resolution;
    let e = &mut a.expedition;
    require!(
        e.status == DungeonStatus::Ready
            && e.rules.content_hash()? == e.rules_hash
            && hashv(&[&args.secret]).to_bytes() == e.commitment
            && args.gate_count <= e.max_rooms
            && args.outcome <= 2,
        ErrorCode::InvalidRun
    );
    let random = e.randomness.ok_or(ErrorCode::InvalidRun)?;
    let mut cleared = 0u8;
    let mut trapped = false;
    for (room, gate) in args.gates.into_iter().enumerate() {
        if room >= usize::from(args.gate_count) {
            require!(gate == 255, ErrorCode::InvalidRun);
            continue;
        }
        require!(gate < 3 && !trapped, ErrorCode::InvalidRun);
        if gate == trap_gate(&e.key(), &random, &args.secret, room as u8)? {
            trapped = true;
        } else {
            cleared = cleared
                .checked_add(1)
                .ok_or(ErrorCode::ArithmeticOverflow)?;
        }
    }
    let (status, payout) = match args.outcome {
        0 => {
            require!(!trapped && cleared > 0, ErrorCode::InvalidRun);
            (
                DungeonStatus::Won,
                dungeon_payout(e.stake, cleared, &e.rules)?,
            )
        }
        1 => {
            require!(trapped || cleared < e.max_rooms, ErrorCode::InvalidRun);
            (DungeonStatus::Lost, 0)
        }
        2 => {
            require!(args.gate_count == 0, ErrorCode::InvalidRun);
            (DungeonStatus::Refunded, e.stake)
        }
        _ => return err!(ErrorCode::InvalidRun),
    };
    require!(payout <= e.max_gross, ErrorCode::InvalidRun);
    e.secret = Some(args.secret);
    e.gates = args.gates;
    e.gate_count = args.gate_count;
    e.cleared = cleared;
    if status != DungeonStatus::Refunded {
        let board = &mut ctx.accounts.leaderboard;
        if board.schema_version == 0 {
            board.schema_version = SCHEMA_VERSION;
            board.bump = ctx.bumps.leaderboard;
        }
        require!(
            board.schema_version == SCHEMA_VERSION,
            ErrorCode::InvalidRun
        );
        super::settle_returned::insert_score(
            board,
            LeaderboardEntry {
                run: e.key(),
                owner: e.owner,
                nonce: e.nonce,
                score: u64::from(cleared),
            },
        )?;
    }
    finish(a, status, payout)
}
pub fn handle_refund_dungeon_randomness(ctx: Context<ResolveDungeon>) -> Result<()> {
    let a = ctx.accounts;
    require!(
        a.expedition.status == DungeonStatus::AwaitingRandomness
            && a.expedition.randomness.is_none()
            && Clock::get()?.unix_timestamp >= a.expedition.randomness_deadline,
        ErrorCode::DrawNotExpired
    );
    let stake = a.expedition.stake;
    finish(a, DungeonStatus::Refunded, stake)
}
fn finish(a: &mut ResolveDungeon<'_>, status: DungeonStatus, payout: u64) -> Result<()> {
    assert_vault(a.house.key(), &a.house, &a.vault)?;
    let e = &mut a.expedition;
    require!(
        a.player.schema_version == SCHEMA_VERSION && a.player.locked_stake_base_units >= e.stake,
        ErrorCode::InvalidRun
    );
    a.player.locked_stake_base_units = a
        .player
        .locked_stake_base_units
        .checked_sub(e.stake)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    a.player.available_base_units = a
        .player
        .available_base_units
        .checked_add(payout)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    a.house.total_max_gross_base_units = a
        .house
        .total_max_gross_base_units
        .checked_sub(e.max_gross)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    a.house.total_available_base_units = a
        .house
        .total_available_base_units
        .checked_add(payout)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    a.player.settled_runs = a
        .player
        .settled_runs
        .checked_add(1)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    let counter = match status {
        DungeonStatus::Won => &mut a.player.wins,
        DungeonStatus::Lost => &mut a.player.losses,
        DungeonStatus::Refunded => &mut a.player.technical_refunds,
        _ => return err!(ErrorCode::InvalidRun),
    };
    *counter = counter
        .checked_add(1)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    e.status = status;
    e.payout = payout;
    e.completed_at = Some(Clock::get()?.unix_timestamp);
    assert_vault(a.house.key(), &a.house, &a.vault)
}
