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
  }),
);

import {
  instructionFor,
  validateTransaction,
} from "../../../../../apps/web/lib/server/transactions";

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
