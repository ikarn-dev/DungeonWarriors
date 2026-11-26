use super::{
    paid_capsules::{install_vrf_fixture, open_fixture, purchase},
    *,
};
use dungeon_warriors::{
    accounts, economy::required_vault_balance, instruction, state::draws::CapsuleKind,
};

fn tokens(p: &Play, key: Pubkey) -> u64 {
    let data = account_bytes(p, key);
    u64::from_le_bytes(data[64..72].try_into().unwrap())
}

#[test]
#[ignore = "requires the read-only Devnet VRF program and queue snapshots"]
fn shared_credit_allows_only_funded_spends_in_every_execution_order() {
    let provider = std::fs::read(std::env::var("DUNGEON_WARRIORS_VRF_PROGRAM_SNAPSHOT").unwrap()).unwrap();
    let queue = std::fs::read(std::env::var("DUNGEON_WARRIORS_VRF_QUEUE_SNAPSHOT").unwrap()).unwrap();
    const STAKE: u64 = 1_000_000;
    const PRICE: u64 = 2_000_000;
    const WITHDRAWAL: u64 = 18_000_000;
    // Writable player/house accounts serialize competing spends. Exercise each
    // possible ordering using the compiled instructions and actual provider CPI.
    for order in [
        [0, 1, 2],
        [0, 2, 1],
        [1, 0, 2],
        [1, 2, 0],
        [2, 0, 1],
        [2, 1, 0],
    ] {
        let mut p = Play::new();
        p.authorize();
        p.admit_fixture();
        p.fund(0);
        let config = open_fixture(&mut p);
        install_vrf_fixture(&mut p, &config, &provider, &queue);
        let owner = p.owner.pubkey();
        let owner_tokens = Play::tokens(&mut p.h, owner, 0);
        let vault_before = tokens(&p, p.vault);
        let withdraw = ix(
            instruction::Withdraw {
                args: AmountArgs {
                    amount_base_units: WITHDRAWAL,
                },
            },
            accounts::TransferCredit {
                config: p.h.config,
                owner,
                player: p.player,
                house: p.house,
                vault: p.vault,
                owner_tokens,
                usdc_mint: dungeon_warriors::USDC_MINT,
                token_program: anchor_spl::token::ID,
            },
        );
        let buy = purchase(&p, CapsuleKind::PaidCat, 0, 100_000_000);
        for (index, spend) in order.into_iter().enumerate() {
            let result = match spend {
                0 => p.reserve(0),
                1 => p.h.send(buy.clone(), &p.owner),
                _ => p.h.send(withdraw.clone(), &p.owner),
            };
            if index < 2 {
                result.unwrap();
            } else {
                rejected(result, "InsufficientCredit");
            }
        }
        let [reserved, pending, withdrawn] = [0, 1, 2].map(|op| order[2] != op);
        let (stake, price, withdrawal) = (
            u64::from(reserved) * STAKE,
            u64::from(pending) * PRICE,
            u64::from(withdrawn) * WITHDRAWAL,
        );
        let available = 20_000_000 - stake - price - withdrawal;
        let player: PlayerAccount = p.h.read(p.player);
        let house: HouseState = p.h.read(p.house);
        let auth: SessionAuthorization = p.h.read(p.authorization);
        assert_eq!(player.available_base_units, available);
        assert_eq!(player.locked_stake_base_units, stake);
        assert_eq!(player.purchase_escrow_base_units, price);
        assert_eq!(player.next_run_nonce, u64::from(reserved));
        assert_eq!(player.next_draw_nonce, u64::from(pending));
        assert_eq!(auth.spent_base_units, stake);
        assert_eq!(house.total_available_base_units, available);
        assert_eq!(house.total_purchase_escrow_base_units, price);
        assert_eq!(house.total_max_gross_base_units, stake * 10);
        assert_eq!(tokens(&p, p.vault), vault_before - withdrawal);
        assert_eq!(tokens(&p, owner_tokens), withdrawal);
        assert!(
            tokens(&p, p.vault)
                >= required_vault_balance(available, price, stake * 10, house.buffer_base_units,)
                    .unwrap()
        );
        if !reserved {
            no_run(&p, 0);
        }
        if !pending {
            assert!(p
                .h
                .svm
                .get_account(&pda(dungeon_warriors::DRAW_SEED, owner, 0))
                .is_none());
        }
    }
}
