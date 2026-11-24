import { Keypair } from "@solana/web3.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { deliverDungeon } from "../../../../../apps/web/lib/server/dungeon-delivery";
import type { DungeonRecord } from "../../../../../apps/web/lib/server/dungeon-store";
import { owner, record, verifier } from "../dungeon/fixtures";

const mocks = vi.hoisted(() => ({
  stored: null as DungeonRecord | null,
  rpc: {
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
beforeEach(() => {
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
