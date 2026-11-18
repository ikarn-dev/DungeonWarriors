use anchor_lang::{
    prelude::*,
    solana_program::{instruction::Instruction, system_program},
    InstructionData, ToAccountMetas,
};
use purrps_game::{
    catalog::CATALOG_V1,
    contracts::{Market, VersionBinding},
    instruction_args::{InitializeConfigArgs, PublishCatalogArgs, PublishRulesArgs},
    rules::RULES_V1,
};
use solana_keypair::Keypair;
use solana_signer::Signer;
#[path = "oracle-binding.rs"]
mod oracle;
use super::support::Harness;
pub fn admin(h: &Harness) -> Keypair {
    Keypair::try_from(h.admin.to_bytes().as_slice()).unwrap()
}
pub fn initialize(h: &mut Harness) {
    let admin = admin(h);
    let ix = Instruction::new_with_bytes(
        purrps_game::ID,
        &purrps_game::instruction::InitializeConfig {
            args: InitializeConfigArgs {
                oracle_bindings: [Market::Btc, Market::Eth, Market::Sol].map(oracle::binding),
            },
        }
        .data(),
        purrps_game::accounts::InitializeConfig {
            program: purrps_game::ID,
            program_data: h.program_data,
            admin: admin.pubkey(),
            config: h.config,
            usdc_mint: purrps_game::USDC_MINT,
            token_program: anchor_spl::token::ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    h.send(ix, &admin).unwrap();
}
pub fn publish(h: &mut Harness) -> (Pubkey, Pubkey) {
    let a = admin(h);
    let rules = Pubkey::find_program_address(
        &[purrps_game::RULES_SEED, &1u32.to_le_bytes()],
        &purrps_game::ID,
    )
    .0;
    let catalog = Pubkey::find_program_address(
        &[purrps_game::CATALOG_SEED, &1u32.to_le_bytes()],
        &purrps_game::ID,
    )
    .0;
    h.send(
        Instruction::new_with_bytes(
            purrps_game::ID,
            &purrps_game::instruction::PublishRules {
                args: PublishRulesArgs {
                    expected_current_version: 0,
                    rules: RULES_V1,
                },
            }
            .data(),
            purrps_game::accounts::PublishRules {
                config: h.config,
                admin: a.pubkey(),
                rules,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        ),
        &a,
    )
    .unwrap();
    h.send(
        Instruction::new_with_bytes(
            purrps_game::ID,
            &purrps_game::instruction::PublishCatalog {
                args: PublishCatalogArgs {
                    expected_current_version: 0,
                    catalog: CATALOG_V1,
                    asset_manifest: VersionBinding {
                        version: 1,
                        content_hash: [7; 32],
                    },
                },
            }
            .data(),
            purrps_game::accounts::PublishCatalog {
                config: h.config,
                admin: a.pubkey(),
                catalog,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        ),
        &a,
    )
    .unwrap();
    (rules, catalog)
}
pub fn create(h: &mut Harness, owner: &Keypair) -> (Pubkey, Pubkey) {
    h.svm.airdrop(&owner.pubkey(), 1_000_000_000).unwrap();
    let player = Pubkey::find_program_address(
        &[purrps_game::PLAYER_SEED, owner.pubkey().as_ref()],
        &purrps_game::ID,
    )
    .0;
    let collection = Pubkey::find_program_address(
        &[purrps_game::COLLECTION_SEED, owner.pubkey().as_ref()],
        &purrps_game::ID,
    )
    .0;
    h.send(
        Instruction::new_with_bytes(
            purrps_game::ID,
            &purrps_game::instruction::CreatePlayer {}.data(),
            purrps_game::accounts::CreatePlayer {
                config: h.config,
                owner: owner.pubkey(),
                payer: owner.pubkey(),
                player,
                collection,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        ),
        owner,
    )
    .unwrap();
    (player, collection)
}
pub fn put<T: AccountSerialize>(h: &mut Harness, key: Pubkey, value: &T) {
    let mut account = h
        .svm
        .get_account(&key)
        .unwrap_or_else(|| h.svm.get_account(&h.admin.pubkey()).unwrap());
    let mut data = Vec::new();
    value.try_serialize(&mut data).unwrap();
    account.data = data;
    account.owner = purrps_game::ID;
    account.lamports = h.svm.minimum_balance_for_rent_exemption(account.data.len());
    h.svm.set_account(key, account).unwrap();
}
