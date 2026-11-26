use anchor_lang::{
    prelude::{Clock, Pubkey},
    solana_program::{bpf_loader_upgradeable, instruction::Instruction},
    AccountDeserialize,
};
use litesvm::{types::TransactionResult, LiteSVM};
use solana_keypair::Keypair;
use solana_message::{Message, VersionedMessage};
use solana_signer::Signer;
use solana_transaction::versioned::VersionedTransaction;

pub struct Harness {
    pub svm: LiteSVM,
    pub admin: Keypair,
    pub program_data: Pubkey,
    pub config: Pubkey,
}

impl Harness {
    pub fn new() -> Self {
        let mut svm = LiteSVM::new();
        let admin = Keypair::new();
        svm.airdrop(&admin.pubkey(), 2_000_000_000).unwrap();
        let bytes = include_bytes!(concat!(
            env!("CARGO_TARGET_TMPDIR"),
            "/../deploy/dungeon_warriors.so"
        ));
        svm.add_program(dungeon_warriors::id(), bytes).unwrap();
        let program_data =
            Pubkey::find_program_address(&[dungeon_warriors::ID.as_ref()], &bpf_loader_upgradeable::ID)
                .0;
        let mut account = svm.get_account(&program_data).unwrap();
        // LiteSVM installs an immutable loader fixture; assign a test upgrade authority.
        account.data[12] = 1;
        account.data[13..45].copy_from_slice(admin.pubkey().as_ref());
        svm.set_account(program_data, account).unwrap();
        let mut mint = svm.get_account(&admin.pubkey()).unwrap();
        mint.owner = anchor_spl::token::ID;
        mint.data = vec![0; 82];
        mint.data[44] = 6;
        mint.data[45] = 1;
        mint.lamports = svm.minimum_balance_for_rent_exemption(82);
        svm.set_account(dungeon_warriors::USDC_MINT, mint).unwrap();
        svm.set_sysvar(&Clock {
            slot: 123_456_790,
            unix_timestamp: 1_700_000_002,
            ..Clock::default()
        });
        let config =
            Pubkey::find_program_address(&[dungeon_warriors::GAME_CONFIG_SEED], &dungeon_warriors::ID).0;
        Self {
            svm,
            admin,
            program_data,
            config,
        }
    }

    pub fn send(&mut self, instruction: Instruction, signer: &Keypair) -> TransactionResult {
        self.svm.expire_blockhash();
        let message = Message::new_with_blockhash(
            &[instruction],
            Some(&signer.pubkey()),
            &self.svm.latest_blockhash(),
        );
        let tx =
            VersionedTransaction::try_new(VersionedMessage::Legacy(message), &[signer]).unwrap();
        self.svm.send_transaction(tx)
    }

    pub fn read<T: AccountDeserialize>(&self, key: Pubkey) -> T {
        let account = self.svm.get_account(&key).unwrap();
        T::try_deserialize(&mut account.data.as_slice()).unwrap()
    }
}
