import { BN } from "@anchor-lang/core";
import {
  ComputeBudgetInstruction,
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { dungeonPrepareSchema } from "../../../../../apps/web/lib/dungeon/request";
import { DUNGEON_V3 } from "../../../../../apps/web/lib/dungeon/rules";
import {
  approveDungeonReservation,
  hasDungeonReservationFee,
  reservationMessage,
} from "../../../../../apps/web/lib/dungeon/transactions";
import { signGameTransaction } from "../../../../../apps/web/lib/game/device-key";
import { encodeBase64 } from "../../../../../apps/web/lib/game/web-api";
import {
  quoteDungeon,
  submitDungeon,
} from "../../../../../apps/web/lib/server/dungeon-reservation";
import type { DungeonRecord } from "../../../../../apps/web/lib/server/dungeon-store";
import { nonceBytes } from "../../../../../apps/web/lib/solana/program";
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
  activeDungeon: async () =>
    mocks.stored && !mocks.stored.settled ? mocks.stored.nonce : null,
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
    rules: DUNGEON_V3,
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
  expect((await quoteDungeon(owner, input)).preparation?.transaction).toBe(
    original,
  );
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
  const preparation = quote.preparation;
  if (!preparation) throw new Error("Expected a prepared wager");
  const tx = VersionedTransaction.deserialize(
    Buffer.from(preparation.transaction, "base64"),
  );
  const parsed = TransactionMessage.decompile(tx.message);
  expect(parsed.instructions).toHaveLength(2);
  const fee = parsed.instructions[0];
  if (!fee) throw new Error("Expected the sponsor fee instruction");
  expect(
    ComputeBudgetInstruction.decodeSetComputeUnitPrice(fee).microLamports,
  ).toBe(0n);
  expect(
    tx.signatures.every((signature) => signature.every((byte) => byte === 0)),
  ).toBe(true);
});

it("reaches the wallet without the unsupported browser Buffer bigint writer", async () => {
  const quote = await quoteDungeon(owner, {
    kind: "prepare",
    stake: "1000000",
    cat: "collector",
  });
  const sign = vi.fn(
    async (tx: import("@solana/web3.js").VersionedTransaction) => {
      tx.sign([Keypair.fromSeed(new Uint8Array(32).fill(1))]);
      return tx;
    },
  );
  const write = vi
    .spyOn(Buffer.prototype, "writeBigUInt64LE")
    .mockImplementation(() => {
      throw new TypeError("writeBigUInt64LE is unavailable in the browser");
    });
  try {
    expect(Array.from(nonceBytes("81985529216486895"))).toEqual([
      0xef, 0xcd, 0xab, 0x89, 0x67, 0x45, 0x23, 0x01,
    ]);
    expect(() => nonceBytes(2n ** 64n)).toThrow(RangeError);
    expect(() => nonceBytes(-1n)).toThrow(RangeError);
    const approval = await approveDungeonReservation(owner, quote, sign, null);
    expect(approval.source).toBe(quote.preparation?.transaction);
    expect(sign).toHaveBeenCalledTimes(1);
  } finally {
    write.mockRestore();
  }
});

it("reuses a validated wallet approval for the same preparation, but signs again for a new blockhash", async () => {
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
  ).rejects.toThrow("DUNGEON_WALLET_BLOCKHASH_CHANGED");
  await approveDungeonReservation(owner, changed, sign, first);
  expect(sign).toHaveBeenCalledTimes(3);
});

it("persists the single wallet approval and reuses its signature after a repeated submit", async () => {
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

it("replaces only an old unsigned preparation with the same terms", async () => {
  const quote = await quoteDungeon(owner, {
    kind: "prepare",
    stake: "1000000",
    cat: "collector",
  });
  const saved = mocks.stored;
  if (!saved || !quote.preparation)
    throw new Error("Expected a prepared wager");
  const oldTx = new VersionedTransaction(
    reservationMessage(
      saved,
      saved.reserve.sponsor,
      saved.reserve.maxPayerDebit,
      Keypair.generate().publicKey.toBase58(),
      false,
    ),
  );
  const oldBytes = encodeBase64(oldTx.serialize());
  saved.reserve.transaction = oldBytes;
  const signer = Keypair.fromSeed(new Uint8Array(32).fill(1));
  const wallet = vi.fn(async (tx: VersionedTransaction) => {
    const prepared = TransactionMessage.decompile(tx.message);
    const result = prepared.instructions.some(({ programId }) =>
      programId.equals(ComputeBudgetProgram.programId),
    )
      ? tx
      : new VersionedTransaction(
          new TransactionMessage({
            ...prepared,
            instructions: [
              ComputeBudgetProgram.setComputeUnitPrice({
                microLamports: 1000n,
              }),
              ...prepared.instructions,
            ],
          }).compileToV0Message(),
        );
    result.sign([signer]);
    return result;
  });
  await expect(
    approveDungeonReservation(
      owner,
      {
        ...quote,
        preparation: { ...quote.preparation, transaction: oldBytes },
      },
      wallet,
      null,
    ),
  ).rejects.toMatchObject({ code: "DUNGEON_WALLET_FEE_CHANGED" });
  const input = {
    kind: "quote",
    stake: saved.stake,
    cat: saved.cat,
    maxRooms: saved.maxRooms,
    maxGross: saved.maxGross,
    rulesHash: saved.rulesHash,
  } as const;
  await expect(
    quoteDungeon(owner, { ...input, stake: "2000000" }),
  ).rejects.toThrow("DUNGEON_ACTIVE");
  expect(mocks.stored?.reserve.transaction).toBe(oldBytes);
  const replacement = await quoteDungeon(owner, input);
  expect(replacement).toMatchObject({
    nonce: saved.nonce,
    stake: saved.stake,
    maxGross: saved.maxGross,
    rulesHash: saved.rulesHash,
  });
  expect(
    hasDungeonReservationFee(replacement.preparation?.transaction ?? ""),
  ).toBe(true);
  wallet.mockClear();
  const approved = await approveDungeonReservation(
    owner,
    replacement,
    wallet,
    null,
  );
  expect(wallet).toHaveBeenCalledTimes(1);
  await submitDungeon(owner, replacement.nonce, approved.transaction);
  await expect(quoteDungeon(owner, input)).rejects.toThrow("DUNGEON_ACTIVE");
});

it("reports wallet fee edits before sending an approval to the server", async () => {
  const quote = await quoteDungeon(owner, {
    kind: "prepare",
    stake: "1000000",
    cat: "collector",
  });
  const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
  try {
    await expect(
      approveDungeonReservation(
        owner,
        quote,
        async (tx) => {
          const { payerKey, recentBlockhash, instructions } =
            TransactionMessage.decompile(tx.message);
          const changed = new VersionedTransaction(
            new TransactionMessage({
              payerKey,
              recentBlockhash,
              instructions: [
                ComputeBudgetProgram.setComputeUnitPrice({
                  microLamports: 1000n,
                }),
                ...instructions.slice(1),
              ],
            }).compileToV0Message(),
          );
          changed.sign([Keypair.fromSeed(new Uint8Array(32).fill(1))]);
          return changed;
        },
        null,
      ),
    ).rejects.toMatchObject({ code: "DUNGEON_WALLET_FEE_CHANGED" });
    expect(log).toHaveBeenCalledWith("[dungeon] wallet.message_changed", {
      blockhashChanged: false,
      feePayerChanged: false,
      feeInstructionsChanged: true,
      instructionCountBefore: 2,
      instructionCountAfter: 2,
    });
    expect(mocks.stored?.reserve.signature).toBeNull();
  } finally {
    log.mockRestore();
  }
});

it("upgrades only the unsigned reservation and submits it with a browser key instead of the wallet", async () => {
  const pair = await crypto.subtle.generateKey("Ed25519", false, [
    "sign",
    "verify",
  ]);
  if (!("privateKey" in pair)) throw new Error("Expected an Ed25519 key pair");
  const key = new PublicKey(
    new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)),
  );
  const device = { address: key.toBase58(), privateKey: pair.privateKey };
  const setup = await mocks.setup();
  const input = {
    kind: "prepare",
    stake: "1000000",
    cat: "collector",
  } as const;
  const original = await quoteDungeon(owner, input);
  const { maxRooms, maxGross, rulesHash } = original;
  const request = {
    ...input,
    device: device.address,
    review: { maxRooms, maxGross, rulesHash },
  };
  await expect(quoteDungeon(owner, request)).rejects.toThrow(
    "INVALID_GAME_DEVICE",
  );
  mocks.setup.mockResolvedValue({
    ...setup,
    grant: { owner: new PublicKey(owner), device: key },
  });
  const quote = await quoteDungeon(owner, request);
  const approved = await approveDungeonReservation(
    owner,
    quote,
    (tx) => {
      expect(
        tx.message.staticAccountKeys
          .slice(0, tx.message.header.numRequiredSignatures)
          .map((signer) => signer.toBase58()),
      ).toEqual([quote.preparation?.sponsor, device.address]);
      return signGameTransaction(device, tx);
    },
    null,
    device.address,
  );
  await submitDungeon(owner, quote.nonce, approved.transaction);
  expect(mocks.stored?.reserve.signature).toBeTruthy();
  await expect(quoteDungeon(owner, request)).rejects.toThrow("DUNGEON_ACTIVE");
});
