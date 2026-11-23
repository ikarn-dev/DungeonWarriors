import { BN, type IdlInstructionAccountItem } from "@anchor-lang/core";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";
import { config, wallet } from "./fixtures";

const sponsorTest = vi.hoisted(() => ({
  connection: vi.fn(),
  sponsor: vi.fn(),
  admit: vi.fn(),
}));
vi.mock("../../../../../apps/web/lib/server/chain", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../../../apps/web/lib/server/chain")
  >()),
  connection: sponsorTest.connection,
}));
vi.mock("server-only", () => ({}));
vi.mock(
  "../../../../../apps/web/lib/server/runtime",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../../../../../apps/web/lib/server/runtime")
    >()),
    runtime: () => ({
      config,
      prefix: "test",
      redis: { eval: sponsorTest.admit },
    }),
    sponsorshipConfig: () => sponsorTest.sponsor() ?? config,
  }),
);

import { coder, idl } from "../../../../../apps/web/lib/server/chain";
import {
  instructionFor,
  prepare,
  submit,
  validateTransaction,
} from "../../../../../apps/web/lib/server/transactions";
import { DEVNET } from "../../../../../apps/web/lib/solana/addresses";

function scalarTransaction(
  instruction: "reserveRun" | "revokeSession",
  owner: ReturnType<typeof wallet>,
  payer: ReturnType<typeof wallet>,
) {
  const definition = idl.instructions.find((item) => item.name === instruction);
  if (definition === undefined) throw new Error("missing instruction");
  function flatten(
    items: IdlInstructionAccountItem[],
  ): { name: string; signer?: boolean; writable?: boolean }[] {
    return items.flatMap((item) =>
      "accounts" in item ? flatten(item.accounts) : [item],
    );
  }
  const keys = flatten(definition.accounts).map((item) => ({
    pubkey:
      item.name === "owner"
        ? owner.publicKey
        : item.name === "payer" || item.name === "authority"
          ? payer.publicKey
          : wallet().publicKey,
    isSigner: item.signer ?? false,
    isWritable: item.writable ?? false,
  }));
  const args =
    instruction === "reserveRun"
      ? {
          args: {
            expectedRunNonce: new BN(0),
            sessionNonce: new BN(0),
            expectedInventoryVersion: new BN(0),
            expectedRulesVersion: 1,
            expectedCatalogVersion: 1,
            cat: { collector: {} },
            market: { sol: {} },
            stakeBaseUnits: new BN(1000000),
          },
        }
      : {};
  const message = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: PublicKey.default.toBase58(),
    instructions: [
      new TransactionInstruction({
        programId: new PublicKey(idl.address),
        keys,
        data: coder.instruction.encode(instruction, args),
      }),
    ],
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  for (let i = 0; i < message.header.numRequiredSignatures; i++) {
    const key = message.staticAccountKeys[i];
    const signer = key?.equals(owner.publicKey) ? owner : payer;
    tx.signatures[i] = signer.sign(message.serialize());
  }
  return Buffer.from(tx.serialize()).toString("base64");
}

function transaction(
  owner: ReturnType<typeof wallet>,
  sponsored = false,
  instructions?: TransactionInstruction[],
) {
  const intent = { operation: "createPlayer" as const, sponsored };
  const built = instructionFor(owner.address, intent);
  const message = new TransactionMessage({
    payerKey: built.payer,
    recentBlockhash: PublicKey.default.toBase58(),
    instructions: instructions ?? [built.instruction],
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  const index = message.staticAccountKeys.findIndex((key) =>
    key.equals(owner.publicKey),
  );
  tx.signatures[index] = owner.sign(message.serialize());
  return {
    intent,
    tx,
    encoded: () => Buffer.from(tx.serialize()).toString("base64"),
  };
}
describe("complete transaction validation", () => {
  it("accepts wallet fee instructions for cat selection within the existing budget limits", () => {
    const owner = wallet();
    const intent = {
      operation: "selectCat",
      sponsored: false,
      inventoryVersion: "2",
      cat: "collector",
    } as const;
    const built = instructionFor(owner.address, intent);
    const encode = (microLamports: number) => {
      const message = new TransactionMessage({
        payerKey: built.payer,
        recentBlockhash: PublicKey.default.toBase58(),
        instructions: [
          ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports }),
          built.instruction,
        ],
      }).compileToV0Message();
      const tx = new VersionedTransaction(message);
      tx.signatures[0] = owner.sign(message.serialize());
      return Buffer.from(tx.serialize()).toString("base64");
    };
    expect(() =>
      validateTransaction(owner.address, intent, encode(400_000)),
    ).not.toThrow();
    expect(() =>
      validateTransaction(owner.address, intent, encode(500_001)),
    ).toThrow("TRANSACTION_REJECTED");
    expect(() =>
      validateTransaction(
        owner.address,
        { ...intent, cat: "acrobat" },
        encode(400_000),
      ),
    ).toThrow("TRANSACTION_REJECTED");
  });

  it("prepares and submits the starter below the general sponsor cap without spending the reserve floor", async () => {
    const owner = wallet();
    const sponsor = Keypair.generate();
    const programData = Buffer.alloc(45);
    programData.writeUInt32LE(3);
    programData[12] = 1;
    owner.publicKey.toBuffer().copy(programData, 13);
    let balance = 1_093_290_840;
    const send = vi.fn().mockResolvedValue("sent");
    const sponsorDebit = 2_537_080;
    const fee = 10_000;
    sponsorTest.connection.mockReturnValue({
      getGenesisHash: async () => DEVNET.genesisHash,
      getLatestBlockhash: async () => ({
        blockhash: PublicKey.default.toBase58(),
        lastValidBlockHeight: 100,
      }),
      getFeeForMessage: async () => ({ value: fee }),
      getAccountInfo: async () => ({
        owner: new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111"),
        data: programData,
      }),
      getBalance: async () => balance,
      simulateTransaction: async () => ({
        value: {
          err: null,
          accounts: [{ lamports: balance - sponsorDebit - fee }],
        },
      }),
      sendRawTransaction: send,
    });
    sponsorTest.sponsor.mockReturnValue({
      ...config,
      SPONSOR_PUBLIC_KEY: sponsor.publicKey.toBase58(),
    });
    sponsorTest.admit.mockResolvedValue(1);
    vi.stubEnv(
      "SPONSOR_SECRET_KEY",
      Buffer.from(sponsor.secretKey).toString("base64"),
    );
    vi.stubEnv("SPONSOR_HOURLY_BUDGET_LAMPORTS", "1000000000");
    const intent = {
      operation: "claimStarter",
      nonce: "0",
      inventoryVersion: "0",
      catalogVersion: 1,
      sponsored: true,
    } as const;
    try {
      const prepared = await prepare(owner.address, intent);
      const tx = VersionedTransaction.deserialize(
        Buffer.from(prepared.transaction, "base64"),
      );
      const [claim] = TransactionMessage.decompile(tx.message).instructions;
      expect(Buffer.from(claim?.data ?? [])).toEqual(
        coder.instruction.encode("claimStarter", {
          args: {
            expectedDrawNonce: new BN(0),
            expectedInventoryVersion: new BN(0),
            expectedCatalogVersion: 1,
            kind: { starterCat: {} },
            maxPayerDebitLamports: new BN(4_900_000),
          },
        }),
      );
      tx.signatures[1] = owner.sign(tx.message.serialize());
      const encoded = Buffer.from(tx.serialize()).toString("base64");
      await expect(
        submit(owner.address, intent, encoded),
      ).resolves.toMatchObject({ status: "requested", network: "base" });
      expect(sponsorTest.admit).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        [config.SPONSOR_MAX_ATTEMPTS, "4910000", "1000000000"],
      );
      balance = 1_004_000_000;
      await expect(prepare(owner.address, intent)).rejects.toThrow(
        "SPONSOR_BUDGET_UNAVAILABLE",
      );
      await expect(submit(owner.address, intent, encoded)).rejects.toThrow(
        "SPONSOR_BUDGET_UNAVAILABLE",
      );
      expect(send).toHaveBeenCalledTimes(1);
      expect(sponsorTest.admit).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllEnvs();
      sponsorTest.connection.mockReset();
      sponsorTest.sponsor.mockReset();
      sponsorTest.admit.mockReset();
    }
  });

  it("charges rent and the wallet's actual network fee once and rejects both fee and debit overages", async () => {
    const owner = wallet();
    const sponsor = Keypair.generate();
    const loader = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
    const programData = Buffer.alloc(45);
    programData.writeUInt32LE(3);
    programData[12] = 1;
    wallet().publicKey.toBuffer().copy(programData, 13);
    const balance = 1_100_000_000;
    let fee = 90_000;
    const playerRent = 2_000_000;
    const collectionRent = 1_307_080;
    const cost = fee + playerRent + collectionRent;
    const submitRaw = vi.fn(async (_bytes: Uint8Array) => "sent");
    const simulation = vi.fn();
    simulation.mockResolvedValue({
      value: { err: null, accounts: [{ lamports: balance - cost }] },
    });
    sponsorTest.connection.mockReturnValue({
      getGenesisHash: async () => DEVNET.genesisHash,
      getFeeForMessage: async () => ({ value: fee }),
      getAccountInfo: async () => ({ owner: loader, data: programData }),
      getBalance: async () => balance,
      simulateTransaction: simulation,
      getMinimumBalanceForRentExemption: async (size: number) =>
        size === coder.accounts.size("playerAccount")
          ? playerRent
          : collectionRent,
      sendRawTransaction: submitRaw,
    });
    sponsorTest.sponsor.mockReturnValue({
      ...config,
      SPONSOR_PUBLIC_KEY: sponsor.publicKey.toBase58(),
    });
    sponsorTest.admit.mockResolvedValue(1);
    vi.stubEnv(
      "SPONSOR_SECRET_KEY",
      Buffer.from(sponsor.secretKey).toString("base64"),
    );
    vi.stubEnv("SPONSOR_HOURLY_BUDGET_LAMPORTS", "1000000000");
    try {
      const built = instructionFor(owner.address, {
        operation: "createPlayer",
        sponsored: true,
      });
      const t = transaction(owner, true, [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 400_000 }),
        built.instruction,
      ]);
      await expect(
        submit(owner.address, t.intent, t.encoded()),
      ).resolves.toMatchObject({
        status: "requested",
        unknownResponse: false,
      });
      expect(sponsorTest.admit).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        [config.SPONSOR_MAX_ATTEMPTS, String(cost), "1000000000"],
      );
      expect(submitRaw).toHaveBeenCalledTimes(1);
      simulation.mockResolvedValue({
        value: { err: null, accounts: [{ lamports: balance - cost - 1 }] },
      });
      await expect(
        submit(owner.address, t.intent, t.encoded()),
      ).rejects.toThrow("SPONSOR_BUDGET_UNAVAILABLE");
      expect(sponsorTest.admit).toHaveBeenCalledTimes(1);
      expect(submitRaw).toHaveBeenCalledTimes(1);
      fee = 100_001;
      await expect(
        submit(owner.address, t.intent, t.encoded()),
      ).rejects.toThrow("SPONSOR_BUDGET_UNAVAILABLE");
      expect(simulation).toHaveBeenCalledTimes(2);
      expect(sponsorTest.admit).toHaveBeenCalledTimes(1);
      expect(submitRaw).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllEnvs();
      sponsorTest.connection.mockReset();
      sponsorTest.sponsor.mockReset();
      sponsorTest.admit.mockReset();
    }
  });

  it("accepts a play-key reservation only for its authenticated owner and keeps owner-only payer scope", () => {
    const owner = wallet();
    const play = wallet();
    const intent = {
      operation: "owner",
      instruction: "reserveRun",
      sponsored: false,
    } as const;
    const encoded = scalarTransaction("reserveRun", owner, play);
    expect(() =>
      validateTransaction(owner.address, intent, encoded),
    ).not.toThrow();
    expect(() =>
      validateTransaction(wallet().address, intent, encoded),
    ).toThrow("TRANSACTION_REJECTED");
    const revoke = {
      operation: "owner",
      instruction: "revokeSession",
      sponsored: false,
    } as const;
    expect(() =>
      validateTransaction(
        owner.address,
        revoke,
        scalarTransaction("revokeSession", owner, play),
      ),
    ).toThrow("TRANSACTION_REJECTED");
    expect(() =>
      validateTransaction(
        owner.address,
        revoke,
        scalarTransaction("revokeSession", owner, owner),
      ),
    ).not.toThrow();
  });
  it("accepts valid owner and sponsored player creation with the wallet signature already present", () => {
    const owner = wallet();
    for (const sponsored of [false, true]) {
      const t = transaction(owner, sponsored);
      expect(
        validateTransaction(owner.address, t.intent, t.encoded()),
      ).toBeDefined();
    }
  });
  it("rejects duplicate, excessive and unrelated wallet additions to sponsored messages", () => {
    const owner = wallet();
    const built = instructionFor(owner.address, {
      operation: "createPlayer",
      sponsored: true,
    });
    const price = ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: 400_000,
    });
    for (const instructions of [
      [price, price, built.instruction],
      [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 200_001 }),
        built.instruction,
      ],
      [
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 500_001 }),
        built.instruction,
      ],
      [
        ComputeBudgetProgram.requestHeapFrame({ bytes: 64 * 1024 }),
        built.instruction,
      ],
      [
        new TransactionInstruction({
          programId: price.programId,
          keys: built.instruction.keys.slice(0, 1),
          data: price.data,
        }),
        built.instruction,
      ],
      [price, built.instruction, built.instruction],
    ]) {
      const t = transaction(owner, true, instructions);
      expect(() =>
        validateTransaction(owner.address, t.intent, t.encoded()),
      ).toThrow("TRANSACTION_REJECTED");
    }
  });
  it("rejects changed recipients/accounts, extra instructions, foreign programs and unsigned owners", () => {
    const owner = wallet();
    const built = instructionFor(owner.address, {
      operation: "createPlayer",
      sponsored: true,
    });
    const wrong = new TransactionInstruction({
      ...built.instruction,
      keys: built.instruction.keys.map((value, index) =>
        index === 3 ? { ...value, pubkey: wallet().publicKey } : value,
      ),
    });
    for (const list of [
      [wrong],
      [
        built.instruction,
        SystemProgram.transfer({
          fromPubkey: owner.publicKey,
          toPubkey: wallet().publicKey,
          lamports: 1,
        }),
      ],
      [
        SystemProgram.transfer({
          fromPubkey: owner.publicKey,
          toPubkey: wallet().publicKey,
          lamports: 1,
        }),
      ],
    ]) {
      const t = transaction(owner, true, list);
      expect(() =>
        validateTransaction(owner.address, t.intent, t.encoded()),
      ).toThrow();
    }
    const t = transaction(owner, true);
    const index = t.tx.message.staticAccountKeys.findIndex((key) =>
      key.equals(owner.publicKey),
    );
    t.tx.signatures[index] = new Uint8Array(64);
    expect(() =>
      validateTransaction(owner.address, t.intent, t.encoded()),
    ).toThrow("INVALID_SIGNATURE");
  });
  it("rejects cross-wallet submission, oversized/noncanonical bytes and caller-chosen sponsorship operations", () => {
    const owner = wallet();
    const t = transaction(owner, true);
    expect(() =>
      validateTransaction(wallet().address, t.intent, t.encoded()),
    ).toThrow();
    for (const data of [
      Buffer.alloc(1400).toString("base64"),
      `${t.encoded()} `,
      "garbage",
    ])
      expect(() =>
        validateTransaction(owner.address, t.intent, data),
      ).toThrow();
  });
});
