import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { expect, it } from "vitest";
import {
  type DeviceIntent,
  deviceInstructions,
  validateDeviceTransaction,
} from "../../../../../apps/web/lib/game/device-intents";
import { DEVNET } from "../../../../../apps/web/lib/solana/addresses";
import { coder } from "../../../../../apps/web/lib/solana/program";

it("enrolls with the deposit signature and reviews a browser-signed withdrawal to the wallet ATA", () => {
  const owner = Keypair.generate().publicKey;
  const device = Keypair.generate().publicKey;
  const sponsor = Keypair.generate().publicKey;
  const address = owner.toBase58();
  const blockhash = Keypair.generate().publicKey.toBase58();
  const build = (intent: DeviceIntent) => {
    const { payer, instructions } = deviceInstructions(
      address,
      intent,
      sponsor,
    );
    return new VersionedTransaction(
      new TransactionMessage({
        payerKey: payer,
        recentBlockhash: blockhash,
        instructions,
      }).compileToV0Message(),
    );
  };
  const signers = (tx: VersionedTransaction) =>
    tx.message.staticAccountKeys
      .slice(0, tx.message.header.numRequiredSignatures)
      .map((key) => key.toBase58());
  const deposit = build({
    operation: "depositWithDevice",
    sponsored: false,
    device: device.toBase58(),
    amount: "1000000",
  });
  expect(signers(deposit)).toEqual([address]);
  expect(
    TransactionMessage.decompile(deposit.message).instructions.map(
      (ix) => coder.instruction.decode(ix.data)?.name,
    ),
  ).toEqual(["deposit", "setGameDevice"]);

  const request = {
    operation: "withdrawWithDevice",
    sponsored: true,
    amount: "1000000",
    device: device.toBase58(),
    nonce: "0",
  } as const;
  const withdrawal = build(request);
  expect(signers(withdrawal)).toEqual([sponsor.toBase58(), device.toBase58()]);
  expect(withdrawal.message.staticAccountKeys).toContainEqual(
    getAssociatedTokenAddressSync(new PublicKey(DEVNET.usdcMint), owner),
  );
  expect(() =>
    validateDeviceTransaction(withdrawal, address, request),
  ).not.toThrow();
  expect(() =>
    validateDeviceTransaction(withdrawal, address, {
      ...request,
      amount: "1000001",
    }),
  ).toThrow("UNEXPECTED_TRANSACTION");
});
