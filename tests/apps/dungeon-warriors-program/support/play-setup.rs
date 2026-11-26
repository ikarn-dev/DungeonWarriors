use super::{setup, support::Harness};
use anchor_lang::{
    prelude::*,
    solana_program::{instruction::Instruction, system_program},
    InstructionData, ToAccountMetas,
};
use dungeon_warriors::{
    catalog::CatId,
    contracts::Market,
    instruction_args::*,
    state::{
        collection::{Collection, OwnedCat},
        config::{CatalogVersion, GameConfig},
        economy::SponsorPurpose,
    },
};
use session_keys::SessionToken;
use solana_keypair::Keypair;
use solana_signer::Signer;
pub const NOW: i64 = 1_700_000_002;
pub struct Play {
    pub h: Harness,
    pub owner: Keypair,
    pub key: Keypair,
    pub sponsor: Keypair,
    pub rules: Pubkey,
    pub catalog: Pubkey,
    pub player: Pubkey,
    pub collection: Pubkey,
    pub token: Pubkey,
    pub authorization: Pubkey,
    pub house: Pubkey,
    pub vault: Pubkey,
    pub policy: Pubkey,
}
pub fn pda(seed: &[u8], owner: Pubkey, nonce: u64) -> Pubkey {
    Pubkey::find_program_address(
        &[seed, owner.as_ref(), &nonce.to_le_bytes()],
        &dungeon_warriors::ID,
    )
    .0
}
pub fn ix<T: InstructionData, A: ToAccountMetas>(data: T, accounts: A) -> Instruction {
    Instruction::new_with_bytes(
        dungeon_warriors::ID,
        &data.data(),
        accounts.to_account_metas(None),
    )
}
impl Play {
    pub fn new() -> Self {
        let mut h = Harness::new();
        setup::initialize(&mut h);
        let (rules, catalog) = setup::publish(&mut h);
        let owner = Keypair::new();
        let key = Keypair::new();
        let sponsor = Keypair::new();
        let (player, collection) = setup::create(&mut h, &owner);
        for k in [&key, &sponsor] {
            h.svm.airdrop(&k.pubkey(), 1_000_000_000).unwrap();
        }
        let binding: CatalogVersion = h.read(catalog);
        // Isolated owned-cat fixture, never a production starter-grant bypass.
        let mut cats: Collection = h.read(collection);
        cats.owned_mask = 1;
        cats.selected_cat = Some(CatId::Collector);
        cats.cats[0] = Some(OwnedCat {
            cat: CatId::Collector,
            rarity: binding.catalog.cats[0].rarity,
            defining_catalog: binding.binding,
            level: 1,
        });
        setup::put(&mut h, collection, &cats);
        let token = Pubkey::find_program_address(
            &[
                SessionToken::SEED_PREFIX.as_bytes(),
                dungeon_warriors::ID.as_ref(),
                key.pubkey().as_ref(),
                owner.pubkey().as_ref(),
            ],
            &session_keys::ID,
        )
        .0;
        // External SDK-owned token fixture; the target program must validate its owner/PDA/content.
        let value = SessionToken {
            authority: owner.pubkey(),
            target_program: dungeon_warriors::ID,
            session_signer: key.pubkey(),
            valid_until: NOW + 7200,
        };
        let mut data = Vec::new();
        value.try_serialize(&mut data).unwrap();
        let mut account = h.svm.get_account(&owner.pubkey()).unwrap();
        account.owner = session_keys::ID;
        account.data = data;
        account.lamports = h.svm.minimum_balance_for_rent_exemption(account.data.len());
        h.svm.set_account(token, account).unwrap();
        let authorization = pda(dungeon_warriors::SESSION_SEED, owner.pubkey(), 0);
        let house = Pubkey::find_program_address(&[dungeon_warriors::HOUSE_SEED], &dungeon_warriors::ID).0;
        let vault = anchor_spl::associated_token::get_associated_token_address(
            &house,
            &dungeon_warriors::USDC_MINT,
        );
        let admin = setup::admin(&h);
        h.send(
            ix(
                dungeon_warriors::instruction::InitializeHouse {},
                dungeon_warriors::accounts::InitializeHouse {
                    config: h.config,
                    admin: admin.pubkey(),
                    house,
                    vault,
                    usdc_mint: dungeon_warriors::USDC_MINT,
                    token_program: anchor_spl::token::ID,
                    associated_token_program: anchor_spl::associated_token::ID,
                    system_program: system_program::ID,
                },
            ),
            &admin,
        )
        .unwrap();
        // Seed classic token sources, then exercise the real checked SPL transfer CPIs.
        let source = Self::tokens(&mut h, owner.pubkey(), 20_000_000);
        let equity = Self::tokens(&mut h, admin.pubkey(), 100_000_000);
        h.send(
            ix(
                dungeon_warriors::instruction::FundHouse {
                    args: AmountArgs {
                        amount_base_units: 100_000_000,
                    },
                },
                dungeon_warriors::accounts::ManageHouse {
                    config: h.config,
                    admin: admin.pubkey(),
                    house,
                    vault,
                    admin_tokens: equity,
                    usdc_mint: dungeon_warriors::USDC_MINT,
                    token_program: anchor_spl::token::ID,
                },
            ),
            &admin,
        )
        .unwrap();
        h.send(
            ix(
                dungeon_warriors::instruction::Deposit {
                    args: AmountArgs {
                        amount_base_units: 20_000_000,
                    },
                },
                dungeon_warriors::accounts::TransferCredit {
                    config: h.config,
                    owner: owner.pubkey(),
                    player,
                    house,
                    vault,
                    owner_tokens: source,
                    usdc_mint: dungeon_warriors::USDC_MINT,
                    token_program: anchor_spl::token::ID,
                },
            ),
            &owner,
        )
        .unwrap();
        let policy =
            Pubkey::find_program_address(&[dungeon_warriors::SPONSOR_POLICY_SEED], &dungeon_warriors::ID).0;
        let mut p = Self {
            h,
            owner,
            key,
            sponsor,
            rules,
            catalog,
            player,
            collection,
            token,
            authorization,
            house,
            vault,
            policy,
        };
        p.configure(p.policy_args()).unwrap();
        p
    }
    pub(super) fn tokens(h: &mut Harness, owner: Pubkey, amount: u64) -> Pubkey {
        let address = Pubkey::new_unique();
        let mut a = h.svm.get_account(&dungeon_warriors::USDC_MINT).unwrap();
        a.data = vec![0; 165];
        a.data[..32].copy_from_slice(dungeon_warriors::USDC_MINT.as_ref());
        a.data[32..64].copy_from_slice(owner.as_ref());
        a.data[64..72].copy_from_slice(&amount.to_le_bytes());
        a.data[108] = 1;
        a.lamports = h.svm.minimum_balance_for_rent_exemption(165);
        h.svm.set_account(address, a).unwrap();
        address
    }
    pub fn policy_args(&self) -> ConfigureSponsorshipArgs {
        ConfigureSponsorshipArgs {
            authority: self.sponsor.pubkey(),
            max_operation_lamports: 3_000_000,
            min_completion_lamports: 1_000_000,
            max_attempts: 3,
            paused: false,
        }
    }
    pub fn configure(
        &mut self,
        args: ConfigureSponsorshipArgs,
    ) -> litesvm::types::TransactionResult {
        let admin = setup::admin(&self.h);
        self.h.send(
            ix(
                dungeon_warriors::instruction::ConfigureSponsorship { args },
                dungeon_warriors::accounts::ConfigureSponsorship {
                    config: self.h.config,
                    admin: admin.pubkey(),
                    policy: self.policy,
                    system_program: system_program::ID,
                },
            ),
            &admin,
        )
    }
    pub fn auth_args(&self) -> AuthorizeSessionArgs {
        AuthorizeSessionArgs {
            expected_session_nonce: 0,
            input_key: self.key.pubkey(),
            session_token: self.token,
            expires_at_seconds: NOW + 3600,
            allowance_base_units: 2_000_000,
        }
    }
    pub fn auth_ix(&self, args: AuthorizeSessionArgs) -> Instruction {
        let authorization = pda(
            dungeon_warriors::SESSION_SEED,
            self.owner.pubkey(),
            args.expected_session_nonce,
        );
        ix(
            dungeon_warriors::instruction::AuthorizeSession { args: args.clone() },
            dungeon_warriors::accounts::AuthorizeSession {
                config: self.h.config,
                owner: self.owner.pubkey(),
                player: self.player,
                session_token: args.session_token,
                authorization,
                system_program: system_program::ID,
            },
        )
    }
    pub fn authorize(&mut self) {
        self.h
            .send(self.auth_ix(self.auth_args()), &self.owner)
            .unwrap();
    }
    pub fn budget(&self, nonce: u64) -> Pubkey {
        let run = pda(dungeon_warriors::RUN_GAME_SEED, self.owner.pubkey(), nonce);
        Pubkey::find_program_address(&[dungeon_warriors::SPONSOR_SEED, run.as_ref()], &dungeon_warriors::ID).0
    }
    pub fn fund_args(&self, nonce: u64) -> FundSponsorshipArgs {
        FundSponsorshipArgs {
            operation: pda(dungeon_warriors::RUN_GAME_SEED, self.owner.pubkey(), nonce),
            beneficiary: self.owner.pubkey(),
            purpose: SponsorPurpose::RunCompletion,
            limit_lamports: 2_000_000,
            reserved_completion_lamports: 1_000_000,
            max_attempts: 3,
            expires_at_seconds: NOW + 3600,
        }
    }
    pub fn fund_ix(&self, args: FundSponsorshipArgs) -> Instruction {
        let budget = Pubkey::find_program_address(
            &[dungeon_warriors::SPONSOR_SEED, args.operation.as_ref()],
            &dungeon_warriors::ID,
        )
        .0;
        ix(
            dungeon_warriors::instruction::FundSponsorship { args },
            dungeon_warriors::accounts::FundSponsorship {
                config: self.h.config,
                policy: self.policy,
                funder: self.sponsor.pubkey(),
                budget,
                system_program: system_program::ID,
            },
        )
    }
    pub fn fund(&mut self, nonce: u64) {
        self.h
            .send(self.fund_ix(self.fund_args(nonce)), &self.sponsor)
            .unwrap();
    }
    pub fn admit_fixture(&mut self) {
        let config = self.h.config;
        let admin = setup::admin(&self.h);
        let state: GameConfig = self.h.read(config);
        self.h
            .send(
                ix(
                    dungeon_warriors::instruction::SetAdmission {
                        args: dungeon_warriors::instruction_args::SetAdmissionArgs {
                            starter: state.allow_starter,
                            purchases: state.allow_purchases,
                            reservations: true,
                        },
                    },
                    dungeon_warriors::accounts::SetAdmission {
                        config,
                        admin: admin.pubkey(),
                    },
                ),
                &admin,
            )
            .unwrap();
    }
    pub fn args(&self, nonce: u64) -> ReserveRunArgs {
        ReserveRunArgs {
            expected_run_nonce: nonce,
            session_nonce: 0,
            expected_inventory_version: 0,
            expected_rules_version: 1,
            expected_catalog_version: 1,
            cat: CatId::Collector,
            market: Market::Sol,
            stake_base_units: 1_000_000,
        }
    }
    pub fn reserve_ix(&self, args: ReserveRunArgs, authority: Pubkey) -> Instruction {
        let nonce = args.expected_run_nonce;
        ix(
            dungeon_warriors::instruction::ReserveRun { args },
            dungeon_warriors::accounts::ReserveRun {
                config: self.h.config,
                allocation: dungeon_warriors::accounts::ReservationAllocation {
                    owner: self.owner.pubkey(),
                    payer: authority,
                    escrow: pda(dungeon_warriors::RUN_ESCROW_SEED, self.owner.pubkey(), nonce),
                    run: pda(dungeon_warriors::RUN_GAME_SEED, self.owner.pubkey(), nonce),
                    system_program: system_program::ID,
                },
                authority,
                authorization: self.authorization,
                session_token: self.token,
                player: self.player,
                collection: self.collection,
                rules: self.rules,
                catalog: self.catalog,
                defining_catalog: self.catalog,
                house: self.house,
                vault: self.vault,
                policy: self.policy,
                budget: self.budget(nonce),
            },
        )
    }
    pub fn reserve(&mut self, nonce: u64) -> litesvm::types::TransactionResult {
        self.h.send(
            self.reserve_ix(self.args(nonce), self.key.pubkey()),
            &self.key,
        )
    }
}
