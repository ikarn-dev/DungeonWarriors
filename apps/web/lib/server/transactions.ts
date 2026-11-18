import "server-only";
import { BN, type IdlInstructionAccountItem, utils } from "@anchor-lang/core";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { z } from "zod";
import { DEVNET } from "../solana/addresses.ts";
import { verifyWalletSignature } from "./auth";
import {
  coder,
  connection,
  idl,
  nonceBytes,
  pda,
  program,
  u64Input,
} from "./chain";
import { ApiError, runtime } from "./runtime";

export const intentSchema = z.discriminatedUnion("operation", [
  z
    .object({ operation: z.literal("createPlayer"), sponsored: z.boolean() })
    .strict(),
  z
    .object({
      operation: z.literal("claimStarter"),
      nonce: u64Input,
      inventoryVersion: u64Input,
      catalogVersion: z.number().int().min(1).max(0xffffffff),
      sponsored: z.literal(true),
    })
    .strict(),
  z
    .object({
      operation: z.literal("selectCat"),
      inventoryVersion: u64Input,
      cat: z.enum(["collector", "acrobat", "guardian", "sprinter"]),
      sponsored: z.literal(false),
    })
    .strict(),
  z
    .object({
      operation: z.literal("owner"),
      instruction: z.enum([
        "deposit",
        "withdraw",
        "authorizeSession",
        "revokeSession",
        "reserveRun",
        "selectCat",
      ]),
      sponsored: z.literal(false),
    })
    .strict(),
]);
export const submitInput = z
  .object({ intent: intentSchema, transaction: z.string().min(1).max(1800) })
  .strict();
type Intent = z.infer<typeof intentSchema>;
function accountRoles(items: IdlInstructionAccountItem[]): string[] {
  return items.flatMap((item) =>
    "accounts" in item ? accountRoles(item.accounts) : [item.name],
  );
}
export function instructionFor(wallet: string, intent: Intent) {
  if (intent.operation === "owner")
    throw new ApiError("PREPARE_NOT_SUPPORTED", 400);
  const owner = new PublicKey(wallet);
  const payer = intent.sponsored
    ? new PublicKey(runtime().config.SPONSOR_PUBLIC_KEY)
    : owner;
  const values: Record<string, PublicKey> = {
    config: pda("game-config"),
    owner,
    payer,
    player: pda("player", owner.toBytes()),
    collection: pda("collection", owner.toBytes()),
    systemProgram: SystemProgram.programId,
  };
  let args: object = {};
  if (intent.operation === "claimStarter") {
    const budget = runtime().config.SPONSOR_OPERATION_LIMIT_LAMPORTS - 100000n;
    if (budget <= 0n) throw new ApiError("SPONSOR_NOT_CONFIGURED", 503);
    const version = Buffer.alloc(4);
    version.writeUInt32LE(intent.catalogVersion);
    Object.assign(values, {
      catalog: pda("catalog", version),
      draw: pda("draw", owner.toBytes(), nonceBytes(intent.nonce)),
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
  const definition = idl.instructions.find(
    (ix) => ix.name === intent.operation,
  );
  if (definition === undefined)
    throw new ApiError("INSTRUCTION_NOT_BUILT", 503);
  const keys = definition.accounts.map((meta) => {
    if (!("name" in meta) || !(meta.name in values))
      throw new ApiError("UNSUPPORTED_ACCOUNT_LAYOUT", 503);
    const pubkey = values[meta.name];
    if (pubkey === undefined)
      throw new ApiError("UNSUPPORTED_ACCOUNT_LAYOUT", 503);
    return {
      pubkey,
      isSigner: "signer" in meta && meta.signer === true,
      isWritable: "writable" in meta && meta.writable === true,
    };
  });
  return {
    instruction: new TransactionInstruction({
      programId: program,
      keys,
      data: coder.instruction.encode(intent.operation, args),
    }),
    payer,
    operationId:
      intent.operation === "claimStarter"
        ? values["draw"]?.toBase58()
        : `${intent.operation}:${wallet}`,
  };
}
export async function prepare(wallet: string, intent: Intent) {
  const built = instructionFor(wallet, intent);
  const rpc = connection();
  if ((await rpc.getGenesisHash()) !== DEVNET.genesisHash)
    throw new ApiError("WRONG_NETWORK", 503);
  const block = await rpc.getLatestBlockhash("finalized");
  const message = new TransactionMessage({
    payerKey: built.payer,
    recentBlockhash: block.blockhash,
    instructions: [built.instruction],
  }).compileToV0Message();
  return {
    transaction: Buffer.from(
      new VersionedTransaction(message).serialize(),
    ).toString("base64"),
    ...block,
    operationId: built.operationId,
  };
}
export function validateTransaction(
  wallet: string,
  intent: Intent,
  encoded: string,
) {
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length > 1232 || bytes.toString("base64") !== encoded)
    throw new ApiError("INVALID_TRANSACTION", 400);
  let tx: VersionedTransaction;
  try {
    tx = VersionedTransaction.deserialize(bytes);
  } catch {
    throw new ApiError("INVALID_TRANSACTION", 400);
  }
  const message = tx.message;
  if (
    message.version !== 0 ||
    message.addressTableLookups.length > 0 ||
    message.compiledInstructions.length !== 1 ||
    message.staticAccountKeys.length > 32
  )
    throw new ApiError("TRANSACTION_REJECTED", 400);
  const ix = message.compiledInstructions[0];
  if (
    ix === undefined ||
    !message.staticAccountKeys[ix.programIdIndex]?.equals(program)
  )
    throw new ApiError("TRANSACTION_REJECTED", 400);
  const definition = idl.instructions.find((value) =>
    Buffer.from(value.discriminator).equals(
      Buffer.from(ix.data.subarray(0, 8)),
    ),
  );
  const owner = new PublicKey(wallet);
  const signerCount = message.header.numRequiredSignatures;
  if (intent.operation === "owner") {
    const roles = accountRoles(definition?.accounts ?? []);
    const ownerIndex = roles.indexOf("owner");
    const actualOwner = ix.accountKeyIndexes[ownerIndex];
    if (
      definition?.name !== intent.instruction ||
      roles.length !== ix.accountKeyIndexes.length ||
      ownerIndex < 0 ||
      actualOwner === undefined ||
      !message.staticAccountKeys[actualOwner]?.equals(owner) ||
      (intent.instruction !== "reserveRun" &&
        !message.staticAccountKeys[0]?.equals(owner)) ||
      signerCount > 3
    )
      throw new ApiError("TRANSACTION_REJECTED", 400);
  } else {
    const built = instructionFor(wallet, intent);
    const expected = new TransactionMessage({
      payerKey: built.payer,
      recentBlockhash: message.recentBlockhash,
      instructions: [built.instruction],
    }).compileToV0Message();
    if (
      !Buffer.from(expected.serialize()).equals(
        Buffer.from(message.serialize()),
      )
    )
      throw new ApiError("TRANSACTION_REJECTED", 400);
  }
  const data = message.serialize();
  for (let i = 0; i < signerCount; i++) {
    const key = message.staticAccountKeys[i];
    if (key === undefined) throw new ApiError("INVALID_SIGNATURE", 401);
    if (intent.sponsored && i === 0) continue;
    if (
      !verifyWalletSignature(
        key.toBase58(),
        data,
        tx.signatures[i] ?? new Uint8Array(),
      )
    )
      throw new ApiError("INVALID_SIGNATURE", 401);
  }
  return tx;
}
function sponsorKey() {
  const { SPONSOR_SECRET_KEY: value } = process.env;
  if (value === undefined) throw new ApiError("SPONSOR_NOT_CONFIGURED", 503);
  let key: Keypair;
  try {
    const bytes = Buffer.from(value, "base64");
    if (bytes.length !== 64 || bytes.toString("base64") !== value)
      throw new Error();
    key = Keypair.fromSecretKey(bytes);
  } catch {
    throw new ApiError("SPONSOR_NOT_CONFIGURED", 503);
  }
  if (key.publicKey.toBase58() !== runtime().config.SPONSOR_PUBLIC_KEY)
    throw new ApiError("SPONSOR_KEY_MISMATCH", 503);
  return key;
}
const chargeBudget = `local n=tonumber(redis.call('GET',KEYS[1]) or '0'); local spent=tonumber(redis.call('GET',KEYS[2]) or '0'); if n>=tonumber(ARGV[1]) or spent+tonumber(ARGV[2])>tonumber(ARGV[3]) then return 0 end; redis.call('INCR',KEYS[1]); redis.call('EXPIRE',KEYS[1],3600); redis.call('INCRBY',KEYS[2],ARGV[2]); redis.call('EXPIRE',KEYS[2],3600); return 1`;
export async function submit(wallet: string, intent: Intent, encoded: string) {
  const tx = validateTransaction(wallet, intent, encoded);
  const rpc = connection();
  const r = runtime();
  if ((await rpc.getGenesisHash()) !== DEVNET.genesisHash)
    throw new ApiError("WRONG_NETWORK", 503);
  const fee = await rpc.getFeeForMessage(tx.message, "confirmed");
  if (fee.value === null) throw new ApiError("BLOCKHASH_EXPIRED", 409);
  if (intent.sponsored) {
    const key = sponsorKey();
    const loader = PublicKey.findProgramAddressSync(
      [program.toBytes()],
      new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111"),
    )[0];
    const programData = await rpc.getAccountInfo(loader, "finalized");
    if (
      programData === null ||
      programData.data.length < 45 ||
      programData.data.readUInt32LE(0) !== 3 ||
      programData.data[12] !== 1 ||
      !programData.owner.equals(
        new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111"),
      )
    )
      throw new ApiError("INVALID_UPGRADE_AUTHORITY", 503);
    if (new PublicKey(programData.data.subarray(13, 45)).equals(key.publicKey))
      throw new ApiError("UPGRADE_KEY_CANNOT_SPONSOR", 503);
    const balance = await rpc.getBalance(key.publicKey, "confirmed");
    const simulation = await rpc.simulateTransaction(tx, {
      sigVerify: false,
      commitment: "confirmed",
      accounts: { encoding: "base64", addresses: [key.publicKey.toBase58()] },
    });
    const after = simulation.value.accounts?.[0]?.lamports;
    if (simulation.value.err !== null || after === undefined)
      throw new ApiError("SIMULATION_REJECTED", 409);
    if (
      ![balance, after, fee.value].every(
        (value) => Number.isSafeInteger(value) && value >= 0,
      )
    )
      throw new ApiError("INVALID_CHAIN_AMOUNT", 502);
    const rent =
      intent.operation === "createPlayer"
        ? await Promise.all([
            rpc.getMinimumBalanceForRentExemption(
              coder.accounts.size("playerAccount"),
            ),
            rpc.getMinimumBalanceForRentExemption(
              coder.accounts.size("collection"),
            ),
          ])
        : [];
    if (rent.some((value) => !Number.isSafeInteger(value) || value < 0))
      throw new ApiError("INVALID_CHAIN_AMOUNT", 502);
    const cost =
      (intent.operation === "createPlayer"
        ? rent.reduce((total, n) => total + BigInt(n), 0n)
        : r.config.SPONSOR_OPERATION_LIMIT_LAMPORTS - 100000n) +
      BigInt(fee.value);
    if (BigInt(Math.max(0, balance - after)) + BigInt(fee.value) > cost)
      throw new ApiError("SPONSOR_BUDGET_UNAVAILABLE", 503);
    if (
      cost > r.config.SPONSOR_OPERATION_LIMIT_LAMPORTS ||
      BigInt(balance) - cost < r.config.SPONSOR_MIN_BALANCE_LAMPORTS
    )
      throw new ApiError("SPONSOR_BUDGET_UNAVAILABLE", 503);
    const { SPONSOR_HOURLY_BUDGET_LAMPORTS: hourly } = process.env;
    if (
      hourly === undefined ||
      !u64Input.safeParse(hourly).success ||
      BigInt(hourly) === 0n ||
      BigInt(hourly) > BigInt(Number.MAX_SAFE_INTEGER)
    )
      throw new ApiError("SPONSOR_NOT_CONFIGURED", 503);
    const operation = instructionFor(wallet, intent).operationId;
    const admitted = await r.redis.eval(
      chargeBudget,
      [
        `${r.prefix}:sponsor:attempt:${operation}`,
        `${r.prefix}:sponsor:cost:${Math.floor(Date.now() / 3600000)}`,
      ],
      [r.config.SPONSOR_MAX_ATTEMPTS, cost.toString(), hourly],
    );
    if (admitted !== 1) throw new ApiError("SPONSOR_LIMITED", 429);
    tx.sign([key]);
  } else {
    const simulation = await rpc.simulateTransaction(tx, {
      sigVerify: true,
      commitment: "confirmed",
    });
    if (simulation.value.err !== null)
      throw new ApiError("SIMULATION_REJECTED", 409);
  }
  const signature = utils.bytes.bs58.encode(
    Buffer.from(tx.signatures[0] ?? []),
  );
  try {
    await rpc.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      preflightCommitment: "confirmed",
      maxRetries: 2,
    });
    return { status: "requested", signature, unknownResponse: false };
  } catch {
    return { status: "requested", signature, unknownResponse: true };
  }
}
