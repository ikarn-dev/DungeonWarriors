import { DELEGATION_PROGRAM_ID } from "@magicblock-labs/ephemeral-rollups-sdk";
import { Keypair, PublicKey, TransactionMessage } from "@solana/web3.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { expeditionAddress } from "../../../../../apps/web/lib/dungeon/transactions";
import { deliverDungeon } from "../../../../../apps/web/lib/server/dungeon-delivery";
import { settlementAddress } from "../../../../../apps/web/lib/server/dungeon-settlement-instructions";
import type { DungeonRecord } from "../../../../../apps/web/lib/server/dungeon-store";
import { coder, program } from "../../../../../apps/web/lib/solana/program";
import { owner, record, verifier } from "../dungeon/fixtures";

const mocks = vi.hoisted(() => ({
  stored: null as DungeonRecord | null,
  rpc: {
    getAccountInfo: vi.fn(),
    getLatestBlockhash: vi.fn(),
    getSignatureStatuses: vi.fn(),
    getBlockHeight: vi.fn(),
  },
  read: vi.fn(),
  admit: vi.fn(),
  send: vi.fn(),
  cost: vi.fn(),
}));
vi.mock("../../../../../apps/web/lib/server/dungeon-store", () => ({
  withDungeon: async (
    _owner: string,
    _nonce: string,
    work: (
      r: DungeonRecord | null,
    ) => Promise<{ record: DungeonRecord | null; value: unknown }>,
  ) => {
    const result = await work(
      mocks.stored ? structuredClone(mocks.stored) : null,
    );
    mocks.stored = result.record;
    return result.value;
  },
}));
vi.mock("../../../../../apps/web/lib/server/dungeon-chain", () => ({
  readExpedition: mocks.read,
  matchExpedition: vi.fn(),
}));
vi.mock("../../../../../apps/web/lib/server/transaction-network", () => ({
  checkedConnection: async () => mocks.rpc,
}));
vi.mock("../../../../../apps/web/lib/server/sponsorship", () => ({
  dedicatedSponsor: async () => Keypair.fromSeed(new Uint8Array(32).fill(3)),
  checkPlaySpend: mocks.cost,
  admitSponsorCost: mocks.admit,
  sendReviewed: mocks.send,
}));
beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubEnv(
    "BROWSER_VERIFIER_SECRET_KEY",
    Buffer.from(verifier.secretKey).toString("base64"),
  );
  mocks.stored = {
    ...record(),
    phase: "lost",
    outcome: 1,
    reason: "gas",
    payout: "0",
  };
  mocks.read.mockResolvedValue({
    status: { ready: {} },
    randomness: Array(32).fill(7),
  });
  mocks.rpc.getLatestBlockhash.mockResolvedValue({
    blockhash: Keypair.generate().publicKey.toBase58(),
    lastValidBlockHeight: 100,
  });
  mocks.rpc.getAccountInfo.mockResolvedValue({
    owner: program,
    data: await coder.accounts.encode("dungeonSettlement", {
      expedition: expeditionAddress(owner, "0"),
      verifier: verifier.publicKey,
      crank: Keypair.generate().publicKey,
      outcome: 1,
      result: null,
    }),
  });
  mocks.rpc.getSignatureStatuses.mockResolvedValue({ value: [null] });
  mocks.rpc.getBlockHeight.mockResolvedValue(50);
  mocks.cost.mockResolvedValue(25000n);
  mocks.admit.mockImplementation(async () => {
    expect(mocks.stored?.delivery).not.toBeNull();
  });
  mocks.send.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());
it("persists fully signed delivery before spending or broadcast and reuses it after a lost response", async () => {
  mocks.send.mockRejectedValueOnce(new Error("network timeout"));
  await expect(deliverDungeon(owner, "0")).rejects.toThrow("network timeout");
  const first = mocks.stored?.delivery;
  expect(first?.transaction).toBeTruthy();
  await deliverDungeon(owner, "0");
  expect(mocks.stored?.delivery).toEqual(first);
  expect(mocks.rpc.getLatestBlockhash).toHaveBeenCalledTimes(1);
  expect(mocks.send).toHaveBeenCalledTimes(2);
});
it("keeps a processed error pending and replaces only after finalized expiry plus the second lookup", async () => {
  await deliverDungeon(owner, "0");
  const first = mocks.stored?.delivery;
  mocks.rpc.getSignatureStatuses.mockResolvedValue({
    value: [
      {
        err: { InstructionError: [0, "AccountInUse"] },
        confirmationStatus: "processed",
      },
    ],
  });
  await deliverDungeon(owner, "0");
  expect(mocks.stored?.delivery).toEqual(first);
  expect(mocks.rpc.getLatestBlockhash).toHaveBeenCalledTimes(1);
  mocks.rpc.getSignatureStatuses.mockResolvedValue({ value: [null] });
  mocks.rpc.getBlockHeight.mockResolvedValue(101);
  mocks.rpc.getLatestBlockhash.mockResolvedValue({
    blockhash: Keypair.generate().publicKey.toBase58(),
    lastValidBlockHeight: 200,
  });
  await deliverDungeon(owner, "0");
  expect(mocks.stored?.delivery?.signature).not.toBe(first?.signature);
  expect(mocks.rpc.getSignatureStatuses).toHaveBeenCalledTimes(3);
});
it("reconciles finalized settlement without sending or crediting again", async () => {
  mocks.read.mockResolvedValue({
    status: { lost: {} },
    payout: { toString: () => "0" },
    cleared: 0,
    gates: [255, 255, 255, 255, 255],
    gateCount: 0,
    randomness: Array(32).fill(7),
  });
  await deliverDungeon(owner, "0");
  expect(mocks.stored?.settled).toBe(true);
  expect(mocks.send).not.toHaveBeenCalled();
  await deliverDungeon(owner, "0");
  expect(mocks.read).toHaveBeenCalledTimes(1);
});

it("schedules on base, commits on ER, and recovers a delayed Hydra trigger without another wallet signature", async () => {
  vi.stubEnv("MAGICBLOCK_ER_HTTP_URL", "https://devnet-us.magicblock.app");
  vi.stubEnv("MAGICBLOCK_VALIDATOR_IDENTITY", owner);
  const hydra = new PublicKey("Hydra17i1feui9deaxu6d1TzSQMRNHeBRkDR1Awy7zea");
  const receipt = settlementAddress(owner, "0");
  const crank = Keypair.generate().publicKey;
  const result = {
    secret: Array(32).fill(7),
    gates: Array(5).fill(255),
    gateCount: 0,
    outcome: 1,
  };
  mocks.rpc.getAccountInfo
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce({ owner: program })
    .mockResolvedValueOnce({ owner: DELEGATION_PROGRAM_ID });
  await deliverDungeon(owner, "0");
  expect(mocks.send.mock.calls.map((call) => call[2])).toEqual(["base", "er"]);
  const names = (tx: Parameters<typeof TransactionMessage.decompile>[0]) =>
    TransactionMessage.decompile(tx)
      .instructions.filter((ix) => ix.programId.equals(program))
      .map((ix) => coder.instruction.decode(ix.data)?.name);
  expect(names(mocks.send.mock.calls[0]?.[1].message)).toEqual([
    "prepareDungeonSettlement",
  ]);
  expect(names(mocks.send.mock.calls[1]?.[1].message)).toEqual([
    "recordDungeonSettlement",
  ]);
  expect(
    mocks.rpc.getAccountInfo.mock.calls.map(([key]) => key.toBase58()),
  ).toEqual(Array(3).fill(receipt.toBase58()));
  const data = await coder.accounts.encode("dungeonSettlement", {
    expedition: expeditionAddress(owner, "0"),
    verifier: verifier.publicKey,
    crank,
    outcome: 1,
    result,
  });
  mocks.rpc.getAccountInfo.mockResolvedValueOnce({ owner: program, data });
  await deliverDungeon(owner, "0");
  expect(mocks.send).toHaveBeenCalledTimes(2);
  if (!mocks.stored?.delivery)
    throw new Error("expected persisted ER delivery");
  mocks.stored.delivery.sentAt = Date.now() - 20_000;
  mocks.rpc.getAccountInfo
    .mockResolvedValueOnce({ owner: program, data })
    .mockResolvedValueOnce({ owner: hydra });
  await deliverDungeon(owner, "0");
  const trigger = mocks.send.mock.calls[2];
  expect(trigger?.[2]).toBe("base");
  const instructions = TransactionMessage.decompile(
    trigger?.[1].message,
  ).instructions;
  expect(instructions[1]?.programId.equals(hydra)).toBe(true);
  expect(instructions[1]?.keys[0]?.pubkey.equals(crank)).toBe(true);
  expect(names(trigger?.[1].message)).toEqual(["finalizeDungeonSettlement"]);
  expect(trigger?.[1].signatures).toHaveLength(1);
});
