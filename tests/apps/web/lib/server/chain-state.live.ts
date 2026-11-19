import { Keypair } from "@solana/web3.js";
import { expect, it } from "vitest";
import {
  readState,
  stateInput,
} from "../../../../../apps/web/lib/server/chain";

it("reads a fresh wallet without creating a player or requesting receipt pages", async () => {
  const wallet = Keypair.generate().publicKey.toBase58();
  const [balances, history] = await Promise.all([
    readState(wallet, stateInput.parse({ kind: "balances" })),
    readState(wallet, stateInput.parse({ kind: "history" })),
  ]);
  expect(balances).toMatchObject({ commitment: "finalized", balances: null });
  expect(history).toMatchObject({
    commitment: "finalized",
    accounts: [],
    history: { fromNonce: "0", nextFromNonce: null, entries: [] },
  });
});

const { PURRPS_DEVNET_ACCOUNT_WALLET: testWallet } = process.env;
it.skipIf(testWallet === undefined)(
  "decodes a registered player's actual finalized balance accounts",
  async () => {
    const result = await readState(
      testWallet ?? "",
      stateInput.parse({ kind: "balances" }),
    );
    expect(result).toMatchObject({
      commitment: "finalized",
      balances: {
        availableBaseUnits: expect.stringMatching(/^\d+$/),
        lockedStakeBaseUnits: expect.stringMatching(/^\d+$/),
        purchaseEscrowBaseUnits: expect.stringMatching(/^\d+$/),
      },
    });
  },
);
