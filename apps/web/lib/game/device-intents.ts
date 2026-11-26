import { BN } from "@anchor-lang/core";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  PublicKey,
  SystemProgram,
  TransactionMessage,
  type VersionedTransaction,
} from "@solana/web3.js";
import { z } from "zod";
import { DEVNET, publicKeySchema } from "../solana/addresses";
import { programInstruction } from "../solana/instruction";
import { pda, u64Input } from "../solana/program";
import { WebApiError } from "./web-api";

const amount = u64Input.refine((value) => BigInt(value) > 0n);
export const deviceIntents = [
  z.strictObject({
    operation: z.literal("depositWithDevice"),
    sponsored: z.literal(false),
    device: publicKeySchema,
    amount,
  }),
  z.strictObject({
    operation: z.literal("setGameDevice"),
    sponsored: z.literal(false),
    device: publicKeySchema.nullable(),
  }),
  z.strictObject({
    operation: z.literal("withdrawWithDevice"),
    sponsored: z.literal(true),
    device: publicKeySchema,
    amount,
    nonce: u64Input,
  }),
] as const;
export type DeviceIntent = z.infer<(typeof deviceIntents)[number]>;
export const deviceAddress = (owner: PublicKey) =>
  pda("game-device", owner.toBytes());

export function deviceInstructions(
  wallet: string,
  intent: DeviceIntent,
  sponsor?: PublicKey,
) {
  const owner = new PublicKey(wallet);
  const player = pda("player", owner.toBytes());
  const access = deviceAddress(owner);
  const device =
    intent.device === null ? PublicKey.default : new PublicKey(intent.device);
  const systemProgram = SystemProgram.programId;
  const update = () =>
    programInstruction(
      "setGameDevice",
      { owner, player, access, systemProgram },
      { device },
    );
  if (intent.operation === "setGameDevice")
    return {
      payer: owner,
      instructions: [update()],
      operationId: `device:${wallet}`,
    };
  const mint = new PublicKey(DEVNET.usdcMint);
  const house = pda("house");
  const ownerTokens = getAssociatedTokenAddressSync(mint, owner);
  const accounts = {
    config: pda("game-config"),
    owner,
    player,
    house,
    ownerTokens,
    usdcMint: mint,
    tokenProgram: new PublicKey(DEVNET.tokenProgram),
    vault: getAssociatedTokenAddressSync(mint, house, true),
  };
  const args = { amountBaseUnits: new BN(intent.amount) };
  if (intent.operation === "depositWithDevice")
    return {
      payer: owner,
      // update requires the owner signature and derives the cap from post-deposit credit.
      instructions: [
        programInstruction("deposit", accounts, { args }),
        update(),
      ],
      operationId: `deposit:${wallet}`,
    };
  if (
    !sponsor ||
    sponsor.equals(owner) ||
    sponsor.equals(device) ||
    device.equals(owner)
  )
    throw new WebApiError("INVALID_GAME_DEVICE");
  return {
    payer: sponsor,
    instructions: [
      createAssociatedTokenAccountIdempotentInstruction(
        sponsor,
        ownerTokens,
        owner,
        mint,
      ),
      programInstruction(
        "withdrawWithDevice",
        { ...accounts, device, access },
        { args, nonce: new BN(intent.nonce) },
      ),
    ],
    operationId: `withdraw:${wallet}:${intent.nonce}`,
  };
}

export function validateDeviceTransaction(
  tx: VersionedTransaction,
  wallet: string,
  intent: DeviceIntent,
) {
  const { payer, instructions } = deviceInstructions(
    wallet,
    intent,
    tx.message.staticAccountKeys[0],
  );
  const bytes = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: tx.message.recentBlockhash,
    instructions,
  })
    .compileToV0Message()
    .serialize();
  const actual = tx.message.serialize();
  if (
    bytes.length !== actual.length ||
    bytes.some((byte, index) => byte !== actual[index])
  )
    throw new WebApiError("UNEXPECTED_TRANSACTION");
}
