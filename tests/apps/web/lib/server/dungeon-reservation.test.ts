import { BN } from "@anchor-lang/core";
import { Keypair } from "@solana/web3.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DUNGEON_V2 } from "../../../../../apps/web/lib/dungeon/rules";
import { quoteDungeon } from "../../../../../apps/web/lib/server/dungeon-reservation";
import type { DungeonRecord } from "../../../../../apps/web/lib/server/dungeon-store";
import { owner, record, verifier } from "../dungeon/fixtures";

const mocks = vi.hoisted(() => ({
  stored: null as DungeonRecord | null,
  setup: vi.fn(),
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
  checkPlaySpend: async () => 25000n,
  admitSponsorCost: vi.fn(),
  sendReviewed: vi.fn(),
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
