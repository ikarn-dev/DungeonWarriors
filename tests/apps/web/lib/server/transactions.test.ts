import { BN, type IdlInstructionAccountItem } from "@anchor-lang/core";
import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";
import { config, wallet } from "./fixtures";

vi.mock("server-only", () => ({}));
vi.mock(
  "../../../../../apps/web/lib/server/runtime",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../../../../../apps/web/lib/server/runtime")
    >()),
    runtime: () => ({ config }),
    sponsorshipConfig: () => config,
  }),
);

import { coder, idl } from "../../../../../apps/web/lib/server/chain";
import {
  instructionFor,
  validateTransaction,
} from "../../../../../apps/web/lib/server/transactions";

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
      t.encoded() + " ",
      "garbage",
    ])
      expect(() =>
        validateTransaction(owner.address, t.intent, data),
      ).toThrow();
  });
});
