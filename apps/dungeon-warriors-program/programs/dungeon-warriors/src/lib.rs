pub mod catalog;
pub mod constants;
pub mod contracts;
pub mod draw;
pub mod dungeon;
pub mod dungeon_engine;
pub mod economy;
pub mod error;
pub mod instruction_args;
pub mod instructions;
pub mod oracle;
pub mod protocol;
pub mod publication;
pub mod rules;
pub mod run_engine;
pub mod simulation;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
use contracts::Market;
use instruction_args::{
    AdvanceRunArgs, AmountArgs, ApplyUpgradeArgs, AuthorizeSessionArgs, ConfigureSponsorshipArgs,
    FundSponsorshipArgs, InitializeConfigArgs, PublishCatalogArgs, PublishRulesArgs,
    RequestCapsuleArgs, ReserveRunArgs, RunIdentityArgs, SelectCatArgs, SetAdmissionArgs,
    SubmitIntentsArgs,
};
pub use instructions::*;
use oracle::InspectedOracle;
pub use state::Counter;

declare_id!("F1cmavHq4562uJ8JmRPM5oFk8q28GW5hadXnZfVCCcUx");

#[program]
pub mod dungeon_warriors {
    use super::*;

    pub fn configure_dungeon(
        ctx: Context<ConfigureDungeon>,
        rules: dungeon::DungeonRules,
        verifier: Pubkey,
        enabled: bool,
    ) -> Result<()> {
        instructions::dungeon_config::handle_configure_dungeon(ctx, rules, verifier, enabled)
    }
    pub fn reserve_dungeon(ctx: Context<ReserveDungeon>, args: ReserveDungeonArgs) -> Result<()> {
        instructions::dungeon_reserve::handle_reserve_dungeon(ctx, args)
    }
    pub fn fulfill_dungeon(
        ctx: Context<FulfillDungeon>,
        randomness: [u8; 32],
        seed: [u8; 32],
    ) -> Result<()> {
        instructions::dungeon_settle::handle_fulfill_dungeon(ctx, randomness, seed)
    }
    pub fn settle_dungeon(ctx: Context<SettleDungeon>, args: DungeonResult) -> Result<()> {
        instructions::dungeon_settle::handle_settle_dungeon(ctx, args)
    }
    pub fn prepare_dungeon_settlement(
        ctx: Context<PrepareDungeonSettlement>,
        validator: Pubkey,
        outcome: u8,
        proof_hash: [u8; 32],
    ) -> Result<()> {
        instructions::dungeon_delivery::handle_prepare_dungeon_settlement(
            ctx, validator, outcome, proof_hash,
        )
    }
    pub fn record_dungeon_settlement(
        ctx: Context<RecordDungeonSettlement>,
        result: DungeonResult,
    ) -> Result<()> {
        instructions::dungeon_delivery::handle_record_dungeon_settlement(ctx, result)
    }
    pub fn finalize_dungeon_settlement(
        ctx: Context<FinalizeDungeonSettlement>,
        outcome: u8,
    ) -> Result<()> {
        instructions::dungeon_delivery::handle_finalize_dungeon_settlement(ctx, outcome)
    }
    pub fn refund_dungeon_randomness(ctx: Context<ResolveDungeon>) -> Result<()> {
        instructions::dungeon_settle::handle_refund_dungeon_randomness(ctx)
    }

    pub fn abort_undelegated_reservation(ctx: Context<AbortUndelegatedReservation>) -> Result<()> {
        crate::instructions::abort_reservation::handle_abort_undelegated_reservation(ctx)
    }

    pub fn settle_returned_run(ctx: Context<SettleReturnedRun>) -> Result<()> {
        crate::instructions::settle_returned::handle_settle_returned_run(ctx)
    }

    pub fn request_completion(
        ctx: Context<RequestCompletion>,
        expected_attempt: u16,
    ) -> Result<()> {
        crate::instructions::completion::handle_request_completion(ctx, expected_attempt)
    }

    pub fn settle_run_action(ctx: Context<SettleRunAction>) -> Result<()> {
        crate::instructions::completion::handle_settle_run_action(ctx)
    }

    pub fn fund_run_completion(ctx: Context<FundRunCompletion>) -> Result<()> {
        crate::instructions::completion_funding::handle_fund_run_completion(ctx)
    }

    pub fn reclaim_completion_balance(ctx: Context<ReclaimCompletionBalance>) -> Result<()> {
        crate::instructions::completion_funding::handle_reclaim_completion_balance(ctx)
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
    pub fn reclaim_expired_run_budget(
        ctx: Context<ReclaimExpiredRunBudget>,
        _nonce: u64,
    ) -> Result<()> {
        crate::instructions::sponsorship::handle_reclaim_expired_run_budget(ctx)
    }
    pub fn reserve_run(ctx: Context<ReserveRun>, args: ReserveRunArgs) -> Result<()> {
        crate::instructions::reserve::handle_reserve_run(ctx, args, None)
    }

    pub fn reserve_quoted_run(
        ctx: Context<ReserveRun>,
        args: ReserveRunArgs,
        max_gross: u64,
    ) -> Result<()> {
        crate::instructions::reserve::handle_reserve_run(ctx, args, Some(max_gross))
    }

    pub fn delegate_run(ctx: Context<DelegateRun>, args: RunIdentityArgs) -> Result<()> {
        crate::instructions::delegation::handle_delegate_run(ctx, args)
    }

    pub fn expire_delegated_activation(ctx: Context<ExpireDelegatedActivation>) -> Result<()> {
        crate::instructions::delegation::handle_expire_delegated_activation(ctx)
    }

    pub fn process_undelegation(
        ctx: Context<ReturnDelegatedRun>,
        account_seeds: Vec<Vec<u8>>,
    ) -> Result<()> {
        crate::instructions::delegation::handle_process_undelegation(ctx, account_seeds)
    }

    pub fn activate_run(ctx: Context<ActivateRun>, args: RunIdentityArgs) -> Result<()> {
        crate::instructions::run_crank::handle_activate_run(ctx, args)
    }

    pub fn configure_browser_verifier(
        ctx: Context<ConfigureBrowserVerifier>,
        authority: Pubkey,
    ) -> Result<()> {
        crate::instructions::browser_run::configure(ctx, authority)
    }
    pub fn record_browser_result(
        ctx: Context<RecordBrowserResult>,
        args: BrowserResult,
    ) -> Result<()> {
        crate::instructions::browser_run::record(ctx, args)
    }

    pub fn advance_run(ctx: Context<AdvanceRun>, args: AdvanceRunArgs) -> Result<()> {
        crate::instructions::run_crank::handle_advance_run(ctx, args)
    }

    pub fn submit_intents(ctx: Context<RunInput>, args: SubmitIntentsArgs) -> Result<()> {
        crate::instructions::run_inputs::handle_submit_intents(ctx, args)
    }
    pub fn heartbeat(ctx: Context<RunInput>, intent: protocol::IntentEnvelope) -> Result<()> {
        crate::instructions::run_inputs::handle_heartbeat(ctx, intent)
    }
    pub fn revoke_run_input_key(ctx: Context<RunInput>) -> Result<()> {
        crate::instructions::run_inputs::handle_revoke_run_input_key(ctx)
    }

    pub fn suspend_or_resume_run(ctx: Context<RecoverRunOracle>) -> Result<()> {
        crate::instructions::run_recovery::handle_recover_run_oracle(ctx, None)
    }

    pub fn resume_run(ctx: Context<RecoverRunOracle>, suspended_at: i64) -> Result<()> {
        crate::instructions::run_recovery::handle_recover_run_oracle(ctx, Some(suspended_at))
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

    pub fn set_game_device(ctx: Context<SetGameDevice>, device: Pubkey) -> Result<()> {
        crate::instructions::game_device::handle_set_game_device(ctx, device)
    }

    pub fn withdraw_with_device(
        ctx: Context<WithdrawWithDevice>,
        args: AmountArgs,
        nonce: u64,
    ) -> Result<()> {
        crate::instructions::credit::handle_withdraw_with_device(ctx, args, nonce)
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
