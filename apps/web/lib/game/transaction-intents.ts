import {
  BN,
  BorshInstructionCoder,
  convertIdlToCamelCase,
} from "@anchor-lang/core";
import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  type VersionedTransaction,
} from "@solana/web3.js";
import { z } from "zod";
import { DEVNET } from "../solana/addresses.ts";
import { PURRPS_GAME_IDL } from "../solana/purrps-game.ts";
import type { CatId } from "./catalog";
export type LobbyIntent =
  | { operation: "createPlayer"; sponsored: boolean }
  | {
      operation: "claimStarter";
      nonce: string;
      inventoryVersion: string;
      catalogVersion: number;
      sponsored: true;
    }
  | {
      operation: "selectCat";
      inventoryVersion: string;
      cat: CatId;
      sponsored: false;
    };
export const lobbyPreparedSchema = z
  .object({
    transaction: z.string().max(1800),
    blockhash: z.string(),
    lastValidBlockHeight: z.number().int(),
    operationId: z.string(),
    network: z.literal("base").default("base"),
  })
  .strict();
export const lobbySubmittedSchema = z
  .object({
    status: z.literal("requested"),
    signature: z.string().min(64).max(88),
    unknownResponse: z.boolean(),
    network: z.literal("base").default("base"),
  })
  .strict();
const idl = convertIdlToCamelCase(PURRPS_GAME_IDL);
const coder = new BorshInstructionCoder(idl);
export function validatePreparedTransaction(
  tx: VersionedTransaction,
  wallet: string,
  intent: LobbyIntent,
) {
  const message = tx.message;
  const program = new PublicKey(DEVNET.program);
  const owner = new PublicKey(wallet);
  const payer = message.staticAccountKeys[0];
  if (
    message.version !== 0 ||
    message.addressTableLookups.length !== 0 ||
    message.compiledInstructions.length !== 1 ||
    payer === undefined ||
    intent.sponsored === payer.equals(owner)
  )
    throw new Error("UNEXPECTED_TRANSACTION");
  const pda = (seed: string, ...parts: Uint8Array[]) =>
    PublicKey.findProgramAddressSync(
      [new TextEncoder().encode(seed), ...parts],
      program,
    )[0];
  const values: Record<string, PublicKey> = {
    config: pda("game-config"),
    owner,
    payer,
    player: pda("player", owner.toBytes()),
    collection: pda("collection", owner.toBytes()),
    systemProgram: SystemProgram.programId,
  };
  const definition = idl.instructions.find(
    (value) => value.name === intent.operation,
  );
  const actual = message.compiledInstructions[0];
  if (
    definition === undefined ||
    actual === undefined ||
    !message.staticAccountKeys[actual.programIdIndex]?.equals(program)
  )
    throw new Error("UNEXPECTED_TRANSACTION");
  let args: object = {};
  if (intent.operation === "claimStarter") {
    if (actual.data.length !== 37) throw new Error("UNEXPECTED_TRANSACTION");
    const view = new DataView(
      actual.data.buffer,
      actual.data.byteOffset,
      actual.data.byteLength,
    );
    const budget = view.getBigUint64(29, true);
    const version = new Uint8Array(4);
    new DataView(version.buffer).setUint32(0, intent.catalogVersion, true);
    const nonce = new Uint8Array(8);
    new DataView(nonce.buffer).setBigUint64(0, BigInt(intent.nonce), true);
    Object.assign(values, {
      catalog: pda("catalog", version),
      draw: pda("draw", owner.toBytes(), nonce),
      oracleQueue: new PublicKey(DEVNET.vrfQueue),
      programIdentity: pda("identity"),
      vrfProgram: new PublicKey(DEVNET.vrfProgram),
      slotHashes: new PublicKey("SysvarS1otHashes111111111111111111111111111"),
    });
    args = {
      args: {
        expectedDrawNonce: new BN(intent.nonce),
        expectedInventoryVersion: new BN(intent.inventoryVersion),
        expectedCatalogVersion: intent.catalogVersion,
        kind: { starterCat: {} },
        maxPayerDebitLamports: new BN(budget.toString()),
      },
    };
  } else if (intent.operation === "selectCat")
    args = {
      args: {
        expectedInventoryVersion: new BN(intent.inventoryVersion),
        cat: { [intent.cat]: {} },
      },
    };
  const keys = definition.accounts.map((meta) => {
    const key = values[meta.name];
    if (key === undefined) throw new Error("UNEXPECTED_TRANSACTION");
    return {
      pubkey: key,
      isSigner: "signer" in meta && meta.signer === true,
      isWritable: "writable" in meta && meta.writable === true,
    };
  });
  const expected = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: message.recentBlockhash,
    instructions: [
      new TransactionInstruction({
        programId: program,
        keys,
        data: coder.encode(intent.operation, args),
      }),
    ],
  }).compileToV0Message();
  const bytes = expected.serialize();
  const serialized = message.serialize();
  if (
    !bytes.every((value, index) => value === serialized[index]) ||
    bytes.length !== serialized.length
  )
    throw new Error("UNEXPECTED_TRANSACTION");
}
