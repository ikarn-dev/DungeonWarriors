import { MAGIC_CONTEXT_ID } from "@magicblock-labs/ephemeral-rollups-sdk";
import { Keypair, PublicKey, TransactionMessage } from "@solana/web3.js";
import { expect, it } from "vitest";
import { encodeIntent } from "../../../../../apps/web/lib/game/protocol";
import { runInputTransaction } from "../../../../../apps/web/lib/game/run-input";
import { DEVNET } from "../../../../../apps/web/lib/solana/addresses";
import { coder } from "../../../../../apps/web/lib/solana/program";

it("signs consecutive run-scoped controls and uses the separate liveness instruction", () => {
  const key = Keypair.generate();
  const run = Keypair.generate().publicKey;
  const base = { protocolVersion: 1, rulesVersion: 1, run: run.toBase58() };
  const block = PublicKey.default.toBase58();
  const actions = [
    { kind: "move", axis: "right" },
    { kind: "cashOut" },
  ] as const;
  const tx = runInputTransaction(run, key, 9007199254740993n, actions, block);
  const [instruction] = TransactionMessage.decompile(tx.message).instructions;
  expect(tx.message.header.numRequiredSignatures).toBe(1);
  expect(tx.message.staticAccountKeys[0]?.equals(key.publicKey)).toBe(true);
  expect(tx.signatures[0]?.some((byte) => byte !== 0)).toBe(true);
  expect(instruction?.programId.toBase58()).toBe(DEVNET.program);
  expect(instruction?.keys.map(({ pubkey }) => pubkey.toBase58())).toEqual(
    [run, key.publicKey, MAGIC_CONTEXT_ID].map((value) => value.toBase58()),
  );
  expect(
    coder.instruction.decode(instruction?.data ?? Buffer.alloc(0))?.name,
  ).toBe("submitIntents");
  expect(instruction?.data.subarray(12)).toEqual(
    Buffer.concat(
      actions.map((action, index) =>
        encodeIntent({
          ...base,
          clientSequence: 9007199254740994n + BigInt(index),
          action,
        }),
      ),
    ),
  );
  const inactive = { kind: "inactive" } as const;
  const heartbeat = runInputTransaction(run, key, 1n, [inactive], block);
  const [ix] = TransactionMessage.decompile(heartbeat.message).instructions;
  expect(coder.instruction.decode(ix?.data ?? Buffer.alloc(0))?.name).toBe(
    "heartbeat",
  );
  expect(ix?.data.subarray(8)).toEqual(
    Buffer.from(
      encodeIntent({ ...base, clientSequence: 2n, action: inactive }),
    ),
  );
  expect(() =>
    runInputTransaction(run, key, 0n, [inactive, { kind: "jump" }], block),
  ).toThrow();
});
