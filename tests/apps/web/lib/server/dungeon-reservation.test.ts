import { BN } from "@anchor-lang/core";
import { Keypair } from "@solana/web3.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { dungeonPrepareSchema } from "../../../../../apps/web/lib/dungeon/request";
import { DUNGEON_V2 } from "../../../../../apps/web/lib/dungeon/rules";
import {
  quoteDungeon,
  submitDungeon,
} from "../../../../../apps/web/lib/server/dungeon-reservation";
import type { DungeonRecord } from "../../../../../apps/web/lib/server/dungeon-store";
import { owner, record, verifier } from "../dungeon/fixtures";

const mocks = vi.hoisted(() => ({
  stored: null as DungeonRecord | null,
  setup: vi.fn(),
  checkPlaySpend: vi.fn(async () => 25000n),
  broadcast: vi.fn(),
}));
vi.mock("../../../../../apps/web/lib/server/dungeon-chain", () => ({
  dungeonSetup: mocks.setup,
  quoteDepth: () => 5,
  readExpedition: vi.fn(),
}));
vi.mock("../../../../../apps/web/lib/server/dungeon-store", () => ({
  activeDungeon: async () => null,
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
vi.mock("../../../../../apps/web/lib/server/sponsorship", () => ({
  dedicatedSponsor: async () => Keypair.fromSeed(new Uint8Array(32).fill(3)),
  checkPlaySpend: mocks.checkPlaySpend,
  admitSponsorCost: vi.fn(),
  sendReviewed: mocks.broadcast,
}));
vi.mock("../../../../../apps/web/lib/server/transaction-network", () => ({
  checkedConnection: async () => ({
    getSignatureStatuses: async () => ({ value: [null] }),
    getBlockHeight: async () => 199,
  }),
}));
vi.mock("../../../../../apps/web/lib/server/runtime", async (original) => ({
  ...(await original<
    typeof import("../../../../../apps/web/lib/server/runtime")
  >()),
  sponsorshipConfig: () => ({ SPONSOR_OPERATION_LIMIT_LAMPORTS: 200000000n }),
}));
beforeEach(() => {
  vi.stubEnv(
    "BROWSER_VERIFIER_SECRET_KEY",
    Buffer.from(verifier.secretKey).toString("base64"),
  );
  mocks.stored = { ...record(), phase: "cancelled", settled: true };
  mocks.setup.mockReset();
  mocks.checkPlaySpend.mockClear();
  mocks.broadcast.mockClear();
  mocks.setup.mockResolvedValue({
    rpc: {
      getLatestBlockhash: async () => ({
        blockhash: Keypair.generate().publicKey.toBase58(),
        lastValidBlockHeight: 200,
      }),
    },
    player: {
      availableBaseUnits: new BN(20000000),
      lockedStakeBaseUnits: new BN(0),
      nextRunNonce: new BN(0),
    },
    collection: { ownedMask: 1, cats: [{}] },
    rules: DUNGEON_V2,
    ruleHash: "00".repeat(32),
    free: 100000000n,
  });
});
afterEach(() => vi.unstubAllEnvs());
it("reuses the unchanged onchain nonce after cancellation, but never overwrites a live approval", async () => {
  const input = {
    kind: "quote" as const,
    stake: "1000000",
    cat: "collector" as const,
    maxRooms: 5,
    maxGross: "7214062",
    rulesHash: "00".repeat(32),
  };
  const next = await quoteDungeon(owner, input);
  expect(next).toMatchObject({
    nonce: "0",
    phase: "preparing",
    settled: false,
  });
  expect(next.preparation?.transaction).toBeTruthy();
  expect(mocks.stored?.reserve.signature).toBeNull();
  const original = mocks.stored?.reserve.transaction;
  await expect(quoteDungeon(owner, input)).rejects.toThrow("DUNGEON_ACTIVE");
  expect(mocks.stored?.reserve.transaction).toBe(original);
});

it("calculates and freezes the exact funded terms from one Play request", async () => {
  const input = dungeonPrepareSchema.parse({
    kind: "prepare",
    stake: "1000000",
    cat: "collector",
  });
  const quote = await quoteDungeon(owner, input);
  expect(mocks.setup).toHaveBeenCalledTimes(1);
  expect(quote).toMatchObject({
    phase: "preparing",
    stake: input.stake,
    cat: input.cat,
    maxRooms: 5,
    maxGross: "7214062",
    rulesHash: "00".repeat(32),
  });
  expect(quote.preparation?.transaction).toBeTruthy();
});

it("reuses a validated wallet approval for the same preparation, but signs again for a new blockhash", async () => {
  const { VersionedTransaction } = await import("@solana/web3.js");
  const { approveDungeonReservation } = await import(
    "../../../../../apps/web/lib/dungeon/transactions"
  );
  const quote = await quoteDungeon(owner, {
    kind: "quote",
    stake: "1000000",
    cat: "collector",
    maxRooms: 5,
    maxGross: "7214062",
    rulesHash: "00".repeat(32),
  });
  const preparation = quote.preparation;
  if (!preparation) throw new Error("Expected a prepared approval");
  const signer = Keypair.fromSeed(new Uint8Array(32).fill(1));
  const sign = vi.fn(async (tx: InstanceType<typeof VersionedTransaction>) => {
    tx.sign([signer]);
    return tx;
  });
  const first = await approveDungeonReservation(owner, quote, sign, null);
  expect(await approveDungeonReservation(owner, quote, sign, first)).toBe(
    first,
  );
  expect(sign).toHaveBeenCalledTimes(1);
  await expect(
    approveDungeonReservation(owner, { ...quote, maxGross: "1" }, sign, first),
  ).rejects.toThrow("UNEXPECTED_DUNGEON_TRANSACTION");
  expect(sign).toHaveBeenCalledTimes(1);
  const tx = VersionedTransaction.deserialize(
    Buffer.from(first.source, "base64"),
  );
  tx.message.recentBlockhash = Keypair.generate().publicKey.toBase58();
  const changed = {
    ...quote,
    preparation: {
      ...preparation,
      transaction: Buffer.from(tx.serialize()).toString("base64"),
    },
  };
  await expect(
    approveDungeonReservation(
      owner,
      quote,
      async (unsigned) => {
        unsigned.message.recentBlockhash = tx.message.recentBlockhash;
        return sign(unsigned);
      },
      null,
    ),
  ).rejects.toThrow("WALLET_CHANGED_DUNGEON_TRANSACTION");
  await approveDungeonReservation(owner, changed, sign, first);
  expect(sign).toHaveBeenCalledTimes(3);
});

it("persists the single wallet approval and reuses its signature after a repeated submit", async () => {
  const { approveDungeonReservation } = await import(
    "../../../../../apps/web/lib/dungeon/transactions"
  );
  const quote = await quoteDungeon(owner, {
    kind: "prepare",
    stake: "1000000",
    cat: "collector",
  });
  const signer = Keypair.fromSeed(new Uint8Array(32).fill(1));
  const approved = await approveDungeonReservation(
    owner,
    quote,
    async (tx) => {
      tx.sign([signer]);
      return tx;
    },
    null,
  );
  const first = await submitDungeon(owner, quote.nonce, approved.transaction);
  const signature = mocks.stored?.reserve.signature;
  expect(first.preparation).toBeNull();
  expect(signature).toBeTruthy();
  const repeated = await submitDungeon(
    owner,
    quote.nonce,
    approved.transaction,
  );
  expect(repeated.preparation).toBeNull();
  expect(mocks.stored?.reserve.signature).toBe(signature);
  expect(mocks.checkPlaySpend).toHaveBeenCalledTimes(2);
  expect(mocks.broadcast).toHaveBeenCalledTimes(2);
  expect(mocks.broadcast.mock.calls.map((call) => call[3])).toEqual([
    signature,
    signature,
  ]);
});
