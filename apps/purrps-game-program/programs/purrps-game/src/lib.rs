pub mod catalog;
pub mod constants;
pub mod contracts;
pub mod draw;
pub mod economy;
pub mod error;
pub mod instruction_args;
pub mod instructions;
pub mod oracle;
pub mod protocol;
pub mod publication;
pub mod rules;
pub mod simulation;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
use contracts::Market;
use instruction_args::{
    AmountArgs, ApplyUpgradeArgs, AuthorizeSessionArgs, ConfigureSponsorshipArgs,
    FundSponsorshipArgs, InitializeConfigArgs, PublishCatalogArgs, PublishRulesArgs,
    RequestCapsuleArgs, ReserveRunArgs, SelectCatArgs, SetAdmissionArgs,
};
pub use instructions::*;
use oracle::InspectedOracle;
pub use state::Counter;

declare_id!("F1cmavHq4562uJ8JmRPM5oFk8q28GW5hadXnZfVCCcUx");

#[program]
pub mod purrps_game {
    use super::*;

    pub fn abort_undelegated_reservation(ctx: Context<AbortUndelegatedReservation>) -> Result<()> {
        crate::instructions::abort_reservation::handle_abort_undelegated_reservation(ctx)
    }

    pub fn settle_returned_run(ctx: Context<SettleReturnedRun>) -> Result<()> {
        crate::instructions::settle_returned::handle_settle_returned_run(ctx)
    }

    pub fn authorize_session(
        ctx: Context<AuthorizeSession>,
        args: AuthorizeSessionArgs,
    ) -> Result<()> {
        crate::instructions::session::handle_authorize_session(ctx, args)
    }
    pub fn revoke_session(ctx: Context<RevokeSession>) -> Result<()> {
        crate::instructions::session::handle_revoke_session(ctx)
    }
    pub fn configure_sponsorship(
        ctx: Context<ConfigureSponsorship>,
        args: ConfigureSponsorshipArgs,
    ) -> Result<()> {
        crate::instructions::sponsorship::handle_configure_sponsorship(ctx, args)
    }
    pub fn fund_sponsorship(
        ctx: Context<FundSponsorship>,
        args: FundSponsorshipArgs,
    ) -> Result<()> {
        crate::instructions::sponsorship::handle_fund_sponsorship(ctx, args)
    }
    pub fn reserve_run(ctx: Context<ReserveRun>, args: ReserveRunArgs) -> Result<()> {
        crate::instructions::reserve::handle_reserve_run(ctx, args)
    }

    pub fn claim_starter(ctx: Context<ClaimStarter>, args: RequestCapsuleArgs) -> Result<()> {
        crate::instructions::starter::handle_claim_starter(ctx, args)
    }
    pub fn fulfill_starter(
        ctx: Context<FulfillStarter>,
        randomness: [u8; 32],
        seed: [u8; 32],
    ) -> Result<()> {
        crate::instructions::starter::handle_fulfill_starter(ctx, randomness, seed)
    }
    pub fn select_cat(ctx: Context<SelectCat>, args: SelectCatArgs) -> Result<()> {
        crate::instructions::starter::handle_select_cat(ctx, args)
    }

    pub fn purchase_capsule(ctx: Context<PurchaseCapsule>, args: RequestCapsuleArgs) -> Result<()> {
        crate::instructions::capsules::handle_purchase_capsule(ctx, args)
    }
    pub fn fulfill_capsule(
        ctx: Context<FulfillCapsule>,
        randomness: [u8; 32],
        seed: [u8; 32],
    ) -> Result<()> {
        crate::instructions::capsules::handle_fulfill_capsule(ctx, randomness, seed)
    }
    pub fn refund_capsule(ctx: Context<ResolveCapsule>) -> Result<()> {
        crate::instructions::capsules::handle_refund_capsule(ctx)
    }
    pub fn apply_upgrade(ctx: Context<ApplyUpgrade>, args: ApplyUpgradeArgs) -> Result<()> {
        crate::instructions::upgrade::handle_apply_upgrade(ctx, args)
    }
    pub fn set_admission(ctx: Context<SetAdmission>, args: SetAdmissionArgs) -> Result<()> {
        crate::instructions::starter::handle_set_admission(ctx, args)
    }

    pub fn initialize_house(ctx: Context<InitializeHouse>) -> Result<()> {
        crate::instructions::house::handle_initialize_house(ctx)
    }

    pub fn fund_house(ctx: Context<ManageHouse>, args: AmountArgs) -> Result<()> {
        crate::instructions::house::handle_fund_house(ctx, args)
    }

    pub fn withdraw_surplus(ctx: Context<ManageHouse>, args: AmountArgs) -> Result<()> {
        crate::instructions::house::handle_withdraw_surplus(ctx, args)
    }

    pub fn set_house_buffer(ctx: Context<SetHouseBuffer>, args: AmountArgs) -> Result<()> {
        crate::instructions::house::handle_set_house_buffer(ctx, args)
    }

    pub fn deposit(ctx: Context<TransferCredit>, args: AmountArgs) -> Result<()> {
        crate::instructions::credit::handle_deposit(ctx, args)
    }

    pub fn withdraw(ctx: Context<TransferCredit>, args: AmountArgs) -> Result<()> {
        crate::instructions::credit::handle_withdraw(ctx, args)
    }

    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        args: InitializeConfigArgs,
    ) -> Result<()> {
        crate::instructions::initialize_config::handle_initialize_config(ctx, args)
    }

    pub fn publish_rules(ctx: Context<PublishRules>, args: PublishRulesArgs) -> Result<()> {
        crate::instructions::publish::handle_publish_rules(ctx, args)
    }

    pub fn publish_catalog(ctx: Context<PublishCatalog>, args: PublishCatalogArgs) -> Result<()> {
        crate::instructions::publish::handle_publish_catalog(ctx, args)
    }

    pub fn create_player(ctx: Context<CreatePlayer>) -> Result<()> {
        crate::instructions::create_player::handle_create_player(ctx)
    }

    pub fn inspect_oracle(ctx: Context<InspectOracle>, market: Market) -> Result<InspectedOracle> {
        crate::instructions::inspect_oracle::handle_inspect_oracle(ctx, market)
    }

    pub fn inspect_run_oracle(
        ctx: Context<InspectRunOracle>,
    ) -> Result<state::run::OracleObservation> {
        crate::instructions::inspect_oracle::handle_inspect_run_oracle(ctx)
    }

    pub fn inspect_run(ctx: Context<InspectRun>) -> Result<RunStatusView> {
        crate::instructions::inspect_run::handle_inspect_run(ctx)
    }

    pub fn inspect_run_escrow(ctx: Context<InspectRunEscrow>) -> Result<()> {
        crate::instructions::inspect_run::handle_inspect_run_escrow(ctx)
    }

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        crate::instructions::initialize::handle_initialize(ctx)
    }

    pub fn increment(ctx: Context<Increment>) -> Result<()> {
        crate::instructions::increment::handle_increment(ctx)
    }
}
