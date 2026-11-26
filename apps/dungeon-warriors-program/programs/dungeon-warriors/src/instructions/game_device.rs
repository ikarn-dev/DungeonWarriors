use crate::{constants::*, error::ErrorCode, state::collection::PlayerAccount};
use anchor_lang::prelude::*;

pub const GAME_DEVICE_SEED: &[u8] = b"game-device";

#[account]
#[derive(InitSpace)]
pub struct GameDevice {
    pub owner: Pubkey,
    pub device: Pubkey,
    pub next_withdrawal: u64,
}

#[derive(Accounts)]
pub struct SetGameDevice<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds=[PLAYER_SEED,owner.key().as_ref()],bump=player.bump,has_one=owner)]
    pub player: Box<Account<'info, PlayerAccount>>,
    #[account(init_if_needed,payer=owner,space=8+GameDevice::INIT_SPACE,
        seeds=[GAME_DEVICE_SEED,owner.key().as_ref()],bump)]
    pub access: Account<'info, GameDevice>,
    pub system_program: Program<'info, System>,
}

pub fn handle_set_game_device(ctx: Context<SetGameDevice>, device: Pubkey) -> Result<()> {
    let a = ctx.accounts;
    require!(
        device == Pubkey::default() || (device != a.owner.key() && device.is_on_curve()),
        ErrorCode::InvalidSession
    );
    a.access.owner = a.owner.key();
    a.access.device = device;
    // Keep the withdrawal nonce across browser changes and revocation.
    Ok(())
}

pub fn authorize_wager(owner: &AccountInfo<'_>, remaining: &[AccountInfo<'_>]) -> Result<()> {
    if owner.is_signer {
        return Ok(());
    }
    let [device, access] = remaining else {
        return err!(ErrorCode::InvalidSession);
    };
    let expected =
        Pubkey::find_program_address(&[GAME_DEVICE_SEED, owner.key.as_ref()], &crate::ID).0;
    require!(
        device.is_signer && *access.key == expected && access.owner == &crate::ID,
        ErrorCode::InvalidSession
    );
    let grant = GameDevice::try_deserialize(&mut &access.try_borrow_data()?[..])?;
    require!(
        grant.owner == *owner.key && grant.device == *device.key,
        ErrorCode::InvalidSession
    );
    Ok(())
}
