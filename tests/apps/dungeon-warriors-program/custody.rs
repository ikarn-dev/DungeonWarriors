use anchor_lang::{
    prelude::*,
    solana_program::{instruction::Instruction, system_program},
    InstructionData, ToAccountMetas,
};
use dungeon_warriors::{
    contracts::Market,
    instruction_args::{AmountArgs, InitializeConfigArgs},
    state::{collection::PlayerAccount, economy::HouseState},
};
use solana_keypair::Keypair;
use solana_signer::Signer;
#[path = "support/oracle-binding.rs"]
mod fixtures;
#[path = "support/harness.rs"]
mod support;
use support::Harness;

struct Custody {
    h: Harness,
    owner: Keypair,
    house: Pubkey,
    vault: Pubkey,
    player: Pubkey,
    tokens: Pubkey,
    admin_tokens: Pubkey,
}

impl Custody {
    fn new() -> Self {
        let mut h = Harness::new();
        let admin = Keypair::try_from(h.admin.to_bytes().as_slice()).unwrap();
        let init = Instruction::new_with_bytes(
            dungeon_warriors::ID,
            &dungeon_warriors::instruction::InitializeConfig {
                args: InitializeConfigArgs {
                    oracle_bindings: [Market::Btc, Market::Eth, Market::Sol].map(fixtures::binding),
                },
            }
            .data(),
            dungeon_warriors::accounts::InitializeConfig {
                program: dungeon_warriors::ID,
                program_data: h.program_data,
                admin: admin.pubkey(),
                config: h.config,
                usdc_mint: dungeon_warriors::USDC_MINT,
                token_program: anchor_spl::token::ID,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        );
        h.send(init, &admin).unwrap();
        let house = Pubkey::find_program_address(&[dungeon_warriors::HOUSE_SEED], &dungeon_warriors::ID).0;
        let vault = anchor_spl::associated_token::get_associated_token_address(
            &house,
            &dungeon_warriors::USDC_MINT,
        );
        let init = Instruction::new_with_bytes(
            dungeon_warriors::ID,
            &dungeon_warriors::instruction::InitializeHouse {}.data(),
            dungeon_warriors::accounts::InitializeHouse {
                config: h.config,
                admin: admin.pubkey(),
                house,
                vault,
                usdc_mint: dungeon_warriors::USDC_MINT,
                token_program: anchor_spl::token::ID,
                associated_token_program: anchor_spl::associated_token::ID,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        );
        h.send(init, &admin).unwrap();
        let owner = Keypair::new();
        h.svm.airdrop(&owner.pubkey(), 100_000_000).unwrap();
        let player = Pubkey::find_program_address(
            &[dungeon_warriors::PLAYER_SEED, owner.pubkey().as_ref()],
            &dungeon_warriors::ID,
        )
        .0;
        let collection = Pubkey::find_program_address(
            &[dungeon_warriors::COLLECTION_SEED, owner.pubkey().as_ref()],
            &dungeon_warriors::ID,
        )
        .0;
        let create = Instruction::new_with_bytes(
            dungeon_warriors::ID,
            &dungeon_warriors::instruction::CreatePlayer {}.data(),
            dungeon_warriors::accounts::CreatePlayer {
                config: h.config,
                owner: owner.pubkey(),
                payer: owner.pubkey(),
                player,
                collection,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        );
        h.send(create, &owner).unwrap();
        let tokens = Self::token_account(&mut h, owner.pubkey(), 10_000_000);
        let admin_tokens = Self::token_account(&mut h, admin.pubkey(), 20_000_000);
        Self {
            h,
            owner,
            house,
            vault,
            player,
            tokens,
            admin_tokens,
        }
    }
    fn token_account(h: &mut Harness, owner: Pubkey, amount: u64) -> Pubkey {
        let key = Pubkey::new_unique();
        let mut account = h.svm.get_account(&dungeon_warriors::USDC_MINT).unwrap();
        account.data = vec![0; 165];
        account.data[..32].copy_from_slice(dungeon_warriors::USDC_MINT.as_ref());
        account.data[32..64].copy_from_slice(owner.as_ref());
        account.data[64..72].copy_from_slice(&amount.to_le_bytes());
        account.data[108] = 1;
        account.lamports = h.svm.minimum_balance_for_rent_exemption(165);
        h.svm.set_account(key, account).unwrap();
        key
    }
    fn balance(&self, key: Pubkey) -> u64 {
        u64::from_le_bytes(
            self.h.svm.get_account(&key).unwrap().data[64..72]
                .try_into()
                .unwrap(),
        )
    }
    fn transfer(&self, withdraw: bool, amount: u64) -> Instruction {
        let args = AmountArgs {
            amount_base_units: amount,
        };
        let data = if withdraw {
            dungeon_warriors::instruction::Withdraw { args }.data()
        } else {
            dungeon_warriors::instruction::Deposit { args }.data()
        };
        Instruction::new_with_bytes(
            dungeon_warriors::ID,
            &data,
            dungeon_warriors::accounts::TransferCredit {
                config: self.h.config,
                owner: self.owner.pubkey(),
                player: self.player,
                house: self.house,
                vault: self.vault,
                owner_tokens: self.tokens,
                usdc_mint: dungeon_warriors::USDC_MINT,
                token_program: anchor_spl::token::ID,
            }
            .to_account_metas(None),
        )
    }
    fn manage(&self, withdraw: bool, amount: u64) -> Instruction {
        let args = AmountArgs {
            amount_base_units: amount,
        };
        let data = if withdraw {
            dungeon_warriors::instruction::WithdrawSurplus { args }.data()
        } else {
            dungeon_warriors::instruction::FundHouse { args }.data()
        };
        Instruction::new_with_bytes(
            dungeon_warriors::ID,
            &data,
            dungeon_warriors::accounts::ManageHouse {
                config: self.h.config,
                admin: self.h.admin.pubkey(),
                house: self.house,
                vault: self.vault,
                admin_tokens: self.admin_tokens,
                usdc_mint: dungeon_warriors::USDC_MINT,
                token_program: anchor_spl::token::ID,
            }
            .to_account_metas(None),
        )
    }
    fn buffer(&self, amount: u64) -> Instruction {
        Instruction::new_with_bytes(
            dungeon_warriors::ID,
            &dungeon_warriors::instruction::SetHouseBuffer {
                args: AmountArgs {
                    amount_base_units: amount,
                },
            }
            .data(),
            dungeon_warriors::accounts::SetHouseBuffer {
                config: self.h.config,
                admin: self.h.admin.pubkey(),
                house: self.house,
                vault: self.vault,
            }
            .to_account_metas(None),
        )
    }
    fn admin(&self) -> Keypair {
        Keypair::try_from(self.h.admin.to_bytes().as_slice()).unwrap()
    }
}

#[test]
fn real_spl_transfers_credit_once_and_only_settled_credit_is_withdrawable() {
    let mut c = Custody::new();
    let admin = c.admin();
    assert_eq!(c.balance(c.vault), 0);
    c.h.send(c.manage(false, 5_000_000), &admin).unwrap();
    c.h.send(c.buffer(2_000_000), &admin).unwrap();
    c.h.send(c.transfer(false, 3_000_000), &c.owner).unwrap();
    assert_eq!(c.balance(c.vault), 8_000_000);
    assert_eq!(c.balance(c.tokens), 7_000_000);
    let p: PlayerAccount = c.h.read(c.player);
    let house: HouseState = c.h.read(c.house);
    assert_eq!(p.available_base_units, 3_000_000);
    assert_eq!(house.total_available_base_units, 3_000_000);
    assert!(c.h.send(c.transfer(true, 3_000_001), &c.owner).is_err());
    assert!(c.h.send(c.manage(true, 3_000_001), &admin).is_err());
    c.h.send(c.manage(true, 3_000_000), &admin).unwrap();
    c.h.send(c.transfer(true, 3_000_000), &c.owner).unwrap();
    assert_eq!(c.balance(c.vault), 2_000_000);
    assert_eq!(c.balance(c.tokens), 10_000_000);
    let p: PlayerAccount = c.h.read(c.player);
    assert_eq!(p.available_base_units, 0);
    assert_eq!(
        (
            p.locked_stake_base_units,
            p.purchase_escrow_base_units,
            p.next_run_nonce
        ),
        (0, 0, 0)
    );
    assert!(c.h.send(c.buffer(2_000_001), &admin).is_err());
    let house: HouseState = c.h.read(c.house);
    assert_eq!(house.buffer_base_units, 2_000_000);
}

#[test]
fn token_cpi_failure_rolls_back_credit_and_house_and_zero_amounts_fail() {
    let mut c = Custody::new();
    for withdraw in [false, true] {
        assert!(c.h.send(c.transfer(withdraw, 0), &c.owner).is_err());
    }
    let mut account = c.h.svm.get_account(&c.tokens).unwrap();
    account.data[108] = 2;
    c.h.svm.set_account(c.tokens, account).unwrap();
    assert!(c.h.send(c.transfer(false, 1_000_000), &c.owner).is_err());
    let p: PlayerAccount = c.h.read(c.player);
    let house: HouseState = c.h.read(c.house);
    assert_eq!(p.available_base_units, 0);
    assert_eq!(house.total_available_base_units, 0);
    assert_eq!(c.balance(c.vault), 0);
}

#[test]
fn rejects_cross_owner_unsigned_wrong_mint_program_vault_and_decimals() {
    let mut c = Custody::new();
    let other = Keypair::new();
    c.h.svm.airdrop(&other.pubkey(), 100_000_000).unwrap();
    let other_tokens = Custody::token_account(&mut c.h, other.pubkey(), 1_000_000);
    for (index, key) in [
        (1, other.pubkey()),
        (5, other_tokens),
        (4, other_tokens),
        (7, system_program::ID),
    ] {
        let mut ix = c.transfer(false, 1);
        ix.accounts[index].pubkey = key;
        let signer = if index == 1 { &other } else { &c.owner };
        assert!(c.h.send(ix, signer).is_err());
    }
    let mut ix = c.transfer(false, 1);
    ix.accounts[1].is_signer = false;
    assert!(c.h.send(ix, &other).is_err());
    let mut mint = c.h.svm.get_account(&dungeon_warriors::USDC_MINT).unwrap();
    mint.data[44] = 9;
    c.h.svm.set_account(dungeon_warriors::USDC_MINT, mint).unwrap();
    assert!(c.h.send(c.transfer(false, 1), &c.owner).is_err());
    let p: PlayerAccount = c.h.read(c.player);
    assert_eq!(p.available_base_units, 0);
    let mut ix = c.manage(false, 1);
    ix.accounts[1].pubkey = other.pubkey();
    assert!(c.h.send(ix, &other).is_err());
}

#[test]
fn surplus_respects_purchase_escrow_max_gross_and_buffer_without_double_counting_stakes() {
    let mut c = Custody::new();
    let admin = c.admin();
    c.h.send(c.manage(false, 10_000_000), &admin).unwrap();
    let mut house: HouseState = c.h.read(c.house);
    house.total_purchase_escrow_base_units = 2_000_000;
    house.total_max_gross_base_units = 5_000_000;
    house.buffer_base_units = 1_000_000;
    let mut account = c.h.svm.get_account(&c.house).unwrap();
    let mut data = Vec::new();
    house.try_serialize(&mut data).unwrap();
    account.data = data;
    c.h.svm.set_account(c.house, account).unwrap();
    assert!(c.h.send(c.manage(true, 2_000_001), &admin).is_err());
    c.h.send(c.manage(true, 2_000_000), &admin).unwrap();
    assert_eq!(c.balance(c.vault), 8_000_000);
}

#[test]
fn overflow_and_external_vault_authorities_never_create_credit() {
    let mut c = Custody::new();
    let mut p: PlayerAccount = c.h.read(c.player);
    p.available_base_units = u64::MAX;
    let mut account = c.h.svm.get_account(&c.player).unwrap();
    let mut data = Vec::new();
    p.try_serialize(&mut data).unwrap();
    account.data = data;
    c.h.svm.set_account(c.player, account).unwrap();
    assert!(c.h.send(c.transfer(false, 1), &c.owner).is_err());
    assert_eq!(c.balance(c.tokens), 10_000_000);
    assert_eq!(c.balance(c.vault), 0);
    p.available_base_units = 0;
    let mut account = c.h.svm.get_account(&c.player).unwrap();
    let mut data = Vec::new();
    p.try_serialize(&mut data).unwrap();
    account.data = data;
    c.h.svm.set_account(c.player, account).unwrap();
    for offset in [72, 129] {
        let original = c.h.svm.get_account(&c.vault).unwrap();
        let mut bad = original.clone();
        bad.data[offset..offset + 4].copy_from_slice(&1u32.to_le_bytes());
        bad.data[offset + 4..offset + 36].copy_from_slice(c.owner.pubkey().as_ref());
        c.h.svm.set_account(c.vault, bad).unwrap();
        assert!(c.h.send(c.transfer(false, 1), &c.owner).is_err());
        c.h.svm.set_account(c.vault, original).unwrap();
    }
}
