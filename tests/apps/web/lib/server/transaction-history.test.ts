import { utils } from "@anchor-lang/core";
import {
  type ConfirmedSignatureInfo,
  type ParsedTransactionWithMeta,
  type PartiallyDecodedInstruction,
  PublicKey,
} from "@solana/web3.js";
import { beforeEach, expect, it, vi } from "vitest";
import { transactionPageSize } from "../../../../../apps/web/lib/game/transaction-history";
import { readTransactionHistory } from "../../../../../apps/web/lib/server/transaction-history";
import { programInstruction } from "../../../../../apps/web/lib/solana/instruction";
import { pda } from "../../../../../apps/web/lib/solana/program";
import { owner } from "../dungeon/fixtures";

const rpc = vi.hoisted(() => ({
  getSignaturesForAddress: vi.fn(),
  getParsedTransactions: vi.fn(),
}));
vi.mock("../../../../../apps/web/lib/server/transaction-network", () => ({
  checkedConnection: async () => rpc,
}));

const wallet = new PublicKey(owner);
const player = pda("player", wallet.toBytes());
const collection = pda("collection", wallet.toBytes());
const bytes = Array.from({ length: 32 }, () => 1);
const signature = (slot: number): ConfirmedSignatureInfo => ({
  signature: utils.bytes.bs58.encode(
    Uint8Array.from({ length: 64 }, () => slot),
  ),
  slot,
  err: null,
  memo: null,
});
function instruction(
  name: string,
  values: Record<string, PublicKey>,
  args: object,
): PartiallyDecodedInstruction {
  const ix = programInstruction(name, values, args);
  return {
    programId: ix.programId,
    accounts: ix.keys.map((key) => key.pubkey),
    data: utils.bytes.bs58.encode(ix.data),
  };
}
function transaction(
  info: ConfirmedSignatureInfo,
  direct: PartiallyDecodedInstruction[],
  inner: PartiallyDecodedInstruction[] = [],
): ParsedTransactionWithMeta {
  return {
    slot: info.slot,
    transaction: {
      signatures: [info.signature],
      message: { recentBlockhash: "", accountKeys: [], instructions: direct },
    },
    meta: {
      err: null,
      fee: 5000,
      preBalances: [],
      postBalances: [],
      innerInstructions: [{ index: 0, instructions: inner }],
    },
  };
}

beforeEach(() => vi.resetAllMocks());

it("links scoped payouts and inner starter grants, deduplicating a shared signature", async () => {
  const payout = signature(21);
  const starter = signature(20);
  const unrelated = signature(19);
  const settleAccounts = {
    config: wallet,
    expedition: wallet,
    player,
    house: wallet,
    vault: wallet,
    verifier: wallet,
    payer: wallet,
    leaderboard: wallet,
    systemProgram: wallet,
  };
  const settleArgs = {
    args: {
      secret: bytes,
      gates: [0, 255, 255, 255, 255],
      gateCount: 1,
      outcome: 0,
    },
  };
  const otherWallet = instruction(
    "settleDungeon",
    { ...settleAccounts, player: wallet },
    settleArgs,
  );
  otherWallet.accounts.push(player);
  rpc.getSignaturesForAddress
    .mockResolvedValueOnce([payout, unrelated])
    .mockResolvedValueOnce([payout, starter]);
  rpc.getParsedTransactions.mockResolvedValue([
    transaction(unrelated, [otherWallet]),
    transaction(payout, [
      instruction("settleDungeon", settleAccounts, settleArgs),
    ]),
    transaction(
      starter,
      [],
      [
        instruction(
          "fulfillStarter",
          {
            vrfProgramIdentity: wallet,
            config: wallet,
            draw: wallet,
            collection,
            catalog: wallet,
          },
          { randomness: bytes, seed: bytes },
        ),
      ],
    ),
  ]);

  const result = await readTransactionHistory(owner);
  expect(rpc.getParsedTransactions).toHaveBeenCalledWith(
    [payout.signature, starter.signature, unrelated.signature],
    { commitment: "finalized", maxSupportedTransactionVersion: 0 },
  );
  expect(
    result.entries.map(({ signature, activities }) => ({
      signature,
      activities,
    })),
  ).toEqual([
    { signature: payout.signature, activities: ["Payout"] },
    { signature: starter.signature, activities: ["Starter cat granted"] },
  ]);
  expect(result.next).toBeNull();
});

it("keeps older collection signatures reachable when the player stream fills the first page", async () => {
  const recent = Array.from({ length: transactionPageSize }, (_, i) =>
    signature(50 - i),
  );
  const old = signature(10);
  rpc.getSignaturesForAddress
    .mockResolvedValueOnce(recent)
    .mockResolvedValueOnce([old])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([old]);
  rpc.getParsedTransactions
    .mockResolvedValueOnce(recent.map(() => null))
    .mockResolvedValueOnce([null]);

  const first = await readTransactionHistory(owner);
  expect(first.next).toEqual({
    player: recent.at(-1)?.signature,
    collection: "latest",
  });
  expect(first.entries).toHaveLength(transactionPageSize);
  const next = await readTransactionHistory(owner, first.next ?? undefined);
  expect(next.entries.map(({ signature }) => signature)).toEqual([
    old.signature,
  ]);
  expect(next.next).toBeNull();
});
