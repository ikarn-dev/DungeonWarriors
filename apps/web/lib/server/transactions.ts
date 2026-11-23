import "server-only";
import { BN, type IdlInstructionAccountItem, utils } from "@anchor-lang/core";
import { DELEGATION_PROGRAM_ID } from "@magicblock-labs/ephemeral-rollups-sdk";
import {
  ComputeBudgetProgram,
  type MessageV0,
  PublicKey,
  SystemProgram,
  type TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { z } from "zod";
import { decodeEscrowAccount, runAddresses } from "../game/run-accounts";
import { runSponsor } from "../game/run-transactions";
import { DEVNET } from "../solana/addresses.ts";
import { verifyWalletSignature } from "./auth";
import { coder, idl, nonceBytes, pda, program, u64Input } from "./chain";
import {
  gameInstructions,
  gameIntentSchema,
  gameNetwork,
  programInstruction,
} from "./game-transactions";
import { ApiError, sponsorshipConfig } from "./runtime";
import {
  admitSponsorCost,
  checkPlaySpend,
  checkSponsorHeadroom,
  dedicatedSponsor,
  recycleRunBudget,
  runSponsorCost,
  sendReviewed,
  submitPlay,
  verifyPlayAuthorization,
} from "./sponsorship";
import { checkedConnection } from "./transaction-network";

export const intentSchema = z.discriminatedUnion("operation", [
  gameIntentSchema,
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
const MAX_SPONSORED_COMPUTE_UNITS = 200_000;
const SPONSORED_FEE_LIMIT_LAMPORTS = 100_000n;
const STARTER_SPONSORED_LIMIT_LAMPORTS = 5_000_000n;

function starterSponsorLimit(operationLimit: bigint) {
  return operationLimit < STARTER_SPONSORED_LIMIT_LAMPORTS
    ? operationLimit
    : STARTER_SPONSORED_LIMIT_LAMPORTS;
}

function reviewedInstructions(
  message: MessageV0,
  expected: readonly TransactionInstruction[],
) {
  let units: number | undefined;
  let price: bigint | undefined;
  let nextApplicationInstruction = 0;
  const instructions = message.compiledInstructions.map((ix) => {
    if (
      !message.staticAccountKeys[ix.programIdIndex]?.equals(
        ComputeBudgetProgram.programId,
      )
    ) {
      const application = expected[nextApplicationInstruction++];
      if (application === undefined)
        throw new ApiError("TRANSACTION_REJECTED", 400);
      return application;
    }
    if (ix.accountKeyIndexes.length !== 0)
      throw new ApiError("TRANSACTION_REJECTED", 400);
    const data = Buffer.from(ix.data);
    if (data[0] === 2 && data.length === 5 && units === undefined) {
      units = data.readUInt32LE(1);
      if (units > 0 && units <= MAX_SPONSORED_COMPUTE_UNITS)
        return ComputeBudgetProgram.setComputeUnitLimit({ units });
    }
    if (data[0] === 3 && data.length === 9 && price === undefined) {
      price = data.readBigUInt64LE(1);
      return ComputeBudgetProgram.setComputeUnitPrice({ microLamports: price });
    }
    throw new ApiError("TRANSACTION_REJECTED", 400);
  });
  if (
    nextApplicationInstruction !== expected.length ||
    (price ?? 0n) *
      BigInt(units ?? expected.length * MAX_SPONSORED_COMPUTE_UNITS) >
      SPONSORED_FEE_LIMIT_LAMPORTS * 1_000_000n
  )
    throw new ApiError("TRANSACTION_REJECTED", 400);
  return instructions;
}

function accountRoles(items: IdlInstructionAccountItem[]): string[] {
  return items.flatMap((item) =>
    "accounts" in item ? accountRoles(item.accounts) : [item.name],
  );
}
export function instructionFor(
  wallet: string,
  intent: Exclude<Intent, { operation: "game" }>,
) {
  if (intent.operation === "owner")
    throw new ApiError("PREPARE_NOT_SUPPORTED", 400);
  const owner = new PublicKey(wallet);
  const payer = intent.sponsored
    ? new PublicKey(sponsorshipConfig().SPONSOR_PUBLIC_KEY)
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
  let operationId = `${intent.operation}:${wallet}`;
  if (intent.operation === "claimStarter") {
    const budget =
      starterSponsorLimit(
        sponsorshipConfig().SPONSOR_OPERATION_LIMIT_LAMPORTS,
      ) - SPONSORED_FEE_LIMIT_LAMPORTS;
    if (budget <= 0n) throw new ApiError("SPONSOR_NOT_CONFIGURED", 503);
    const version = Buffer.alloc(4);
    version.writeUInt32LE(intent.catalogVersion);
    const draw = pda("draw", owner.toBytes(), nonceBytes(intent.nonce));
    operationId = draw.toBase58();
    Object.assign(values, {
      catalog: pda("catalog", version),
      draw,
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
  return {
    instruction: programInstruction(intent.operation, values, args),
    payer,
    operationId,
  };
}
function instructionsFor(wallet: string, intent: Intent) {
  if (intent.operation === "game") {
    const sponsor = intent.playSponsor?.sponsor ?? runSponsor(intent.action);
    if (sponsor !== undefined) {
      const settings = sponsorshipConfig();
      const funding =
        intent.action.kind === "reserveRun"
          ? intent.action.completionFunding
          : undefined;
      if (
        sponsor !== settings.SPONSOR_PUBLIC_KEY ||
        sponsor === wallet ||
        ("inputKey" in intent.action && intent.action.inputKey === sponsor) ||
        (intent.playSponsor &&
          (BigInt(intent.playSponsor.floor) !==
            settings.SPONSOR_MIN_BALANCE_LAMPORTS ||
            ![
              "authorizeSession",
              "reserveRun",
              "activateRun",
              "requestCompletion",
              "suspendOrResumeRun",
              "resumeRun",
              "expireDelegatedActivation",
              "abortUndelegatedReservation",
              "settleReturnedRun",
            ].includes(intent.action.kind) ||
            (runSponsor(intent.action) !== undefined &&
              runSponsor(intent.action) !== sponsor) ||
            (intent.action.kind === "requestCompletion" &&
              (intent.action.expectedAttempt ?? 0) >=
                settings.SPONSOR_MAX_ATTEMPTS))) ||
        (funding &&
          (BigInt(funding.lamports) !==
            settings.SPONSOR_COMPLETION_RESERVE_LAMPORTS ||
            BigInt(funding.floor) !== settings.SPONSOR_MIN_BALANCE_LAMPORTS ||
            funding.attempts > settings.SPONSOR_MAX_ATTEMPTS))
      )
        throw new ApiError("INVALID_RUN_SPONSOR", 400);
    }
    return gameInstructions(wallet, intent);
  }
  const { instruction, ...built } = instructionFor(wallet, intent);
  return { ...built, instructions: [instruction] };
}

const networkFor = (intent: Intent) =>
  intent.operation === "game" ? gameNetwork(intent.action) : "base";

async function connectionFor(wallet: string, intent: Intent) {
  if (intent.operation !== "game" || gameNetwork(intent.action) === "base")
    return checkedConnection("base");
  const action = intent.action;
  if (!("nonce" in action)) throw new ApiError("INVALID_REQUEST", 400);
  const identity = { owner: wallet, nonce: BigInt(action.nonce) };
  const address = runAddresses(identity).escrow[0];
  const base = await checkedConnection("base");
  const info = await base.getAccountInfo(address, "finalized");
  if (info === null) throw new ApiError("RUN_NOT_FOUND", 409);
  const escrow = await decodeEscrowAccount(identity, address, info).catch(
    () => {
      throw new ApiError("INVALID_CHAIN_ACCOUNT", 502);
    },
  );
  if (
    escrow.status !== "reserved" ||
    !escrow.delegationInitiated ||
    ("market" in action && action.market !== escrow.market) ||
    ("delegationEpoch" in action &&
      action.delegationEpoch !== escrow.delegationEpoch) ||
    ("inputKey" in action && action.inputKey !== escrow.inputKey)
  )
    throw new ApiError("RUN_SCOPE_MISMATCH", 409);
  return checkedConnection("er", escrow.validator);
}

export async function prepare(wallet: string, intent: Intent) {
  const built = instructionsFor(wallet, intent);
  const network = networkFor(intent);
  const rpc = await connectionFor(wallet, intent);
  if (intent.operation === "claimStarter") {
    const policy = sponsorshipConfig();
    checkSponsorHeadroom(
      await rpc.getBalance(built.payer, "confirmed"),
      policy.SPONSOR_MIN_BALANCE_LAMPORTS,
      starterSponsorLimit(policy.SPONSOR_OPERATION_LIMIT_LAMPORTS),
    );
  }
  const sponsoredPlay = intent.operation === "game" && intent.playSponsor;
  const reserve =
    intent.operation === "game" && intent.action.kind === "reserveRun"
      ? intent.action
      : null;
  const funding = reserve?.completionFunding;
  // Reclaim available SOL before checking headroom.
  if (reserve && funding) await recycleRunBudget(rpc, wallet, reserve);
  const [block] = await Promise.all([
    rpc.getLatestBlockhash(
      network === "er" || sponsoredPlay ? "confirmed" : "finalized",
    ),
    intent.operation === "game" &&
      sponsoredPlay &&
      verifyPlayAuthorization(wallet, intent.action, rpc),
    funding && runSponsorCost(rpc, funding),
  ]);
  const message = new TransactionMessage({
    payerKey: built.payer,
    recentBlockhash: block.blockhash,
    instructions: built.instructions,
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  if (intent.operation === "game" && sponsoredPlay) {
    try {
      await checkPlaySpend(rpc, tx, built.payer, network, false);
    } catch (error) {
      if (
        intent.action.kind === "activateRun" &&
        error instanceof ApiError &&
        error.code === "SIMULATION_REJECTED"
      ) {
        const run = runAddresses({
          owner: wallet,
          nonce: BigInt(intent.action.nonce),
        }).run[0];
        const replica = await rpc.getAccountInfo(run, "confirmed");
        if (!replica || replica.owner.equals(DELEGATION_PROGRAM_ID))
          throw new ApiError("RUN_DELEGATION_PENDING", 409);
      }
      throw error;
    }
  }
  const bytes = tx.serialize();
  if (bytes.length > 1232) throw new ApiError("INVALID_TRANSACTION", 400);
  return {
    transaction: Buffer.from(bytes).toString("base64"),
    ...block,
    network,
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
  const fundingInstructions =
    intent.operation !== "game"
      ? 0
      : intent.action.kind === "reserveRun" && intent.action.completionFunding
        ? 2
        : intent.action.kind === "delegateRun" &&
            intent.action.completionSponsor
          ? 1
          : 0;
  const walletMayAddFees =
    intent.sponsored ||
    intent.operation === "game" ||
    intent.operation === "selectCat";
  const maxInstructions =
    intent.operation === "game"
      ? intent.playSponsor
        ? 7
        : intent.action.kind === "reserveRun" &&
            intent.action.expiresAtSeconds !== undefined
          ? 5 + fundingInstructions
          : 4 + fundingInstructions
      : walletMayAddFees
        ? 3
        : 1;
  if (
    message.version !== 0 ||
    message.addressTableLookups.length > 0 ||
    message.compiledInstructions.length === 0 ||
    message.compiledInstructions.length > maxInstructions ||
    message.staticAccountKeys.length > 32
  )
    throw new ApiError("TRANSACTION_REJECTED", 400);
  const ix = message.compiledInstructions.find((instruction) =>
    message.staticAccountKeys[instruction.programIdIndex]?.equals(program),
  );
  if (ix === undefined) throw new ApiError("TRANSACTION_REJECTED", 400);
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
    const built = instructionsFor(wallet, intent);
    const expected = new TransactionMessage({
      payerKey: built.payer,
      recentBlockhash: message.recentBlockhash,
      // Wallets can add fee instructions after preparation. Every other byte
      // must still match a transaction rebuilt from the approved intent.
      instructions: walletMayAddFees
        ? reviewedInstructions(message, built.instructions)
        : built.instructions,
    }).compileToV0Message();
    if (
      !Buffer.from(expected.serialize()).equals(
        Buffer.from(message.serialize()),
      )
    )
      throw new ApiError("TRANSACTION_REJECTED", 400);
  }
  const data = message.serialize();
  const completionSponsor =
    intent.operation === "game"
      ? (intent.playSponsor?.sponsor ?? runSponsor(intent.action))
      : undefined;
  for (let i = 0; i < signerCount; i++) {
    const key = message.staticAccountKeys[i];
    if (key === undefined) throw new ApiError("INVALID_SIGNATURE", 401);
    if ((intent.sponsored && i === 0) || key.toBase58() === completionSponsor)
      continue;
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
export async function submit(wallet: string, intent: Intent, encoded: string) {
  const tx = validateTransaction(wallet, intent, encoded);
  const network = networkFor(intent);
  if (intent.operation === "game" && intent.playSponsor)
    return submitPlay(wallet, intent, tx, () => connectionFor(wallet, intent));
  const rpc = await connectionFor(wallet, intent);
  // The ER simulates v0 transactions, but its fee RPC cannot load v0 messages.
  const fee =
    network === "base"
      ? (await rpc.getFeeForMessage(tx.message, "confirmed")).value
      : null;
  if (network === "base" && fee === null)
    throw new ApiError("BLOCKHASH_EXPIRED", 409);
  if (fee !== null && (!Number.isSafeInteger(fee) || fee < 0))
    throw new ApiError("INVALID_CHAIN_AMOUNT", 502);
  const completionSponsor =
    intent.operation === "game" ? runSponsor(intent.action) : undefined;
  if (intent.sponsored) {
    if (fee === null || BigInt(fee) > SPONSORED_FEE_LIMIT_LAMPORTS)
      throw new ApiError("SPONSOR_BUDGET_UNAVAILABLE", 503);
    const policy = sponsorshipConfig();
    const key = await dedicatedSponsor(rpc);
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
      ![balance, after].every(
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
        : starterSponsorLimit(policy.SPONSOR_OPERATION_LIMIT_LAMPORTS) -
          SPONSORED_FEE_LIMIT_LAMPORTS) + BigInt(fee);
    // The simulated payer balance already reflects the network fee.
    if (BigInt(Math.max(0, balance - after)) > cost)
      throw new ApiError("SPONSOR_BUDGET_UNAVAILABLE", 503);
    checkSponsorHeadroom(balance, policy.SPONSOR_MIN_BALANCE_LAMPORTS, cost);
    await admitSponsorCost(instructionFor(wallet, intent).operationId, cost);
    tx.sign([key]);
  } else {
    if (completionSponsor !== undefined) tx.sign([await dedicatedSponsor(rpc)]);
    const funding =
      intent.operation === "game" && intent.action.kind === "reserveRun"
        ? intent.action.completionFunding
        : undefined;
    const cost = funding ? await runSponsorCost(rpc, funding) : undefined;
    const simulation = await rpc.simulateTransaction(tx, {
      sigVerify: true,
      commitment: "confirmed",
    });
    if (simulation.value.err === "BlockhashNotFound")
      throw new ApiError("BLOCKHASH_EXPIRED", 409);
    if (simulation.value.err !== null)
      throw new ApiError("SIMULATION_REJECTED", 409);
    if (cost !== undefined)
      await admitSponsorCost(
        instructionsFor(wallet, intent).operationId,
        cost,
        utils.bytes.bs58.encode(tx.signatures[0] ?? new Uint8Array()),
      );
  }
  const signature = utils.bytes.bs58.encode(
    Buffer.from(tx.signatures[0] ?? []),
  );
  return sendReviewed(rpc, tx, network, signature);
}
