import "server-only";
import { createHash } from "node:crypto";
import { BN, type IdlInstructionAccountItem } from "@anchor-lang/core";
import {
  DELEGATION_PROGRAM_ID,
  delegateBufferPdaFromDelegatedAccountAndOwnerProgram,
  delegationMetadataPdaFromDelegatedAccount,
  delegationRecordPdaFromDelegatedAccount,
  EPHEMERAL_VAULT_ID,
  escrowPdaFromEscrowAuthority,
  MAGIC_CONTEXT_ID,
  MAGIC_PROGRAM_ID,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import { z } from "zod";
import {
  DEVNET,
  MARKETS,
  oracleAddress,
  publicKeySchema,
} from "../solana/addresses.ts";
import { coder, idl, nonceBytes, pda, program, u64Input } from "./chain";
import { ApiError } from "./runtime";

const positive = u64Input.refine((n) => n !== "0");
const version = z.number().int().min(1).max(0xffffffff);
const marketSchema = z.enum(["BTC", "ETH", "SOL"]);
const catSchema = z.enum(["collector", "acrobat", "guardian", "sprinter"]);
const nonce = { nonce: u64Input };
const identity = { ...nonce, delegationEpoch: positive };
const action = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("deposit"), amount: positive }),
  z.strictObject({ kind: z.literal("withdraw"), amount: positive }),
  z.strictObject({
    kind: z.literal("authorizeSession"),
    ...nonce,
    inputKey: publicKeySchema,
    expiresAtSeconds: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    allowance: positive,
  }),
  z.strictObject({ kind: z.literal("revokeSession"), ...nonce }),
  z.strictObject({
    kind: z.literal("reserveRun"),
    ...nonce,
    sessionNonce: u64Input,
    inputKey: publicKeySchema,
    inventoryVersion: u64Input,
    rulesVersion: version,
    catalogVersion: version,
    definingCatalogVersion: version,
    cat: catSchema,
    market: marketSchema,
    stake: positive,
  }),
  z.strictObject({ kind: z.literal("delegateRun"), ...identity }),
  z.strictObject({
    kind: z.literal("activateRun"),
    ...identity,
    inputKey: publicKeySchema,
    market: marketSchema,
  }),
  z.strictObject({ kind: z.literal("expireDelegatedActivation"), ...nonce }),
  z.strictObject({ kind: z.literal("revokeRunInputKey"), ...nonce }),
  z.strictObject({ kind: z.literal("abortUndelegatedReservation"), ...nonce }),
  z.strictObject({
    kind: z.literal("suspendOrResumeRun"),
    ...nonce,
    market: marketSchema,
  }),
  z.strictObject({
    kind: z.literal("requestCompletion"),
    ...nonce,
    market: marketSchema,
  }),
  z.strictObject({
    kind: z.literal("settleReturnedRun"),
    ...nonce,
    market: marketSchema,
  }),
]);
export const gameIntentSchema = z.strictObject({
  operation: z.literal("game"),
  sponsored: z.literal(false),
  action,
});
export type GameIntent = z.infer<typeof gameIntentSchema>;

const sessionProgram = new PublicKey(
  "KeyspM2ssCJbqUhQ4k7sveSiY4WjnYsrXkC8oDbwde5",
);
// The pinned TS SDK exports the base Hydra address. Games use ER Hydra.
const hydraProgram = new PublicKey(
  "eHyd5BU8QffvHi4GnXwxrK4WpS7pM2x9UGKHBWii7mf",
);
const mint = new PublicKey(DEVNET.usdcMint);
const tokenProgram = new PublicKey(DEVNET.tokenProgram);

function accountMetas(
  items: IdlInstructionAccountItem[],
  values: Record<string, PublicKey>,
): TransactionInstruction["keys"] {
  return items.flatMap((meta) => {
    if ("accounts" in meta) return accountMetas(meta.accounts, values);
    const pubkey = Object.hasOwn(values, meta.name)
      ? values[meta.name]
      : undefined;
    if (pubkey === undefined)
      throw new ApiError("UNSUPPORTED_ACCOUNT_LAYOUT", 503);
    return [
      {
        pubkey,
        isSigner: "signer" in meta && meta.signer === true,
        isWritable: "writable" in meta && meta.writable === true,
      },
    ];
  });
}

export function programInstruction(
  name: string,
  values: Record<string, PublicKey>,
  args: object,
) {
  const definition = idl.instructions.find((ix) => ix.name === name);
  if (definition === undefined)
    throw new ApiError("INSTRUCTION_NOT_BUILT", 503);
  return new TransactionInstruction({
    programId: program,
    keys: accountMetas(definition.accounts, values),
    data: coder.instruction.encode(name, args),
  });
}

function sessionToken(owner: PublicKey, inputKey: PublicKey) {
  if (owner.equals(inputKey) || !PublicKey.isOnCurve(inputKey.toBytes()))
    throw new ApiError("INVALID_PLAY_KEY", 400);
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("session_token"),
      program.toBuffer(),
      inputKey.toBuffer(),
      owner.toBuffer(),
    ],
    sessionProgram,
  )[0];
}

function createSession(
  owner: PublicKey,
  inputKey: PublicKey,
  token: PublicKey,
  expires: number,
) {
  // Pinned session-keys v3 create_session with no top-up and an explicit expiry.
  const data = Buffer.alloc(20);
  createHash("sha256")
    .update("global:create_session")
    .digest()
    .copy(data, 0, 0, 8);
  data[8] = 1; // Some(false)
  data[10] = 1; // Some(valid_until)
  data.writeBigInt64LE(BigInt(expires), 11);
  // The last option byte is None for lamports.
  return new TransactionInstruction({
    programId: sessionProgram,
    keys: [
      { pubkey: token, isSigner: false, isWritable: true },
      { pubkey: inputKey, isSigner: true, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: program, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

function versionPda(seed: string, value: number) {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value);
  return pda(seed, bytes);
}

export function gameNetwork(action: GameIntent["action"]): "base" | "er" {
  switch (action.kind) {
    case "activateRun":
    case "requestCompletion":
    case "expireDelegatedActivation":
    case "revokeRunInputKey":
    case "suspendOrResumeRun":
      return "er";
    default:
      return "base";
  }
}

export function gameInstructions(wallet: string, { action }: GameIntent) {
  const owner = new PublicKey(wallet);
  const ownerBytes = owner.toBytes();
  const house = pda("house");
  const values: Record<string, PublicKey> = {
    owner,
    payer: owner,
    config: pda("game-config"),
    player: pda("player", ownerBytes),
    house,
    vault: getAssociatedTokenAddressSync(mint, house, true),
    systemProgram: SystemProgram.programId,
  };
  const build = (
    args: object = {},
    prefix: TransactionInstruction[] = [],
    operationId = `${action.kind}:${wallet}`,
  ) => ({
    instructions: [...prefix, programInstruction(action.kind, values, args)],
    payer: owner,
    operationId,
  });

  if (action.kind === "deposit" || action.kind === "withdraw") {
    const ownerTokens = getAssociatedTokenAddressSync(mint, owner);
    Object.assign(values, {
      ownerTokens,
      usdcMint: mint,
      tokenProgram,
    });
    const prefix =
      action.kind === "withdraw"
        ? [
            createAssociatedTokenAccountIdempotentInstruction(
              owner,
              ownerTokens,
              owner,
              mint,
            ),
          ]
        : [];
    return build({ args: { amountBaseUnits: new BN(action.amount) } }, prefix);
  }
  if (action.kind === "authorizeSession" || action.kind === "revokeSession") {
    const authorization = pda("session", ownerBytes, nonceBytes(action.nonce));
    Object.assign(values, { authorization: authorization });
    if (action.kind === "revokeSession")
      return build({}, [], authorization.toBase58());
    const inputKey = new PublicKey(action.inputKey);
    const token = sessionToken(owner, inputKey);
    Object.assign(values, { sessionToken: token });
    return build(
      {
        args: {
          expectedSessionNonce: new BN(action.nonce),
          inputKey,
          sessionToken: token,
          expiresAtSeconds: new BN(action.expiresAtSeconds),
          allowanceBaseUnits: new BN(action.allowance),
        },
      },
      [createSession(owner, inputKey, token, action.expiresAtSeconds)],
      authorization.toBase58(),
    );
  }

  const n = nonceBytes(action.nonce);
  const run = pda("run-game", ownerBytes, n);
  const escrow = pda("run-escrow", ownerBytes, n);
  const budget = pda("sponsor", run.toBytes());
  const market =
    "market" in action
      ? MARKETS.findIndex((entry) => entry.market === action.market)
      : -1;
  Object.assign(values, {
    run,
    escrow,
    budget,
    runEscrow: escrow,
    magicContext: MAGIC_CONTEXT_ID,
    authority: owner,
  });
  if (market >= 0) {
    const marketEntry = MARKETS[market];
    if (marketEntry === undefined) throw new ApiError("INVALID_MARKET", 400);
    Object.assign(values, {
      priceUpdate: new PublicKey(oracleAddress(marketEntry.feedId)),
    });
    Object.assign(values, {
      leaderboard: pda("leaderboard", Buffer.from([market])),
    });
  }
  const operationId = run.toBase58();
  if (action.kind === "reserveRun") {
    Object.assign(values, {
      authority: owner,
      authorization: pda(
        "session",
        ownerBytes,
        nonceBytes(action.sessionNonce),
      ),
      sessionToken: sessionToken(owner, new PublicKey(action.inputKey)),
      collection: pda("collection", ownerBytes),
      rules: versionPda("rules", action.rulesVersion),
      catalog: versionPda("catalog", action.catalogVersion),
      definingCatalog: versionPda("catalog", action.definingCatalogVersion),
      policy: pda("sponsor-policy"),
    });
    return build(
      {
        args: {
          expectedRunNonce: new BN(action.nonce),
          sessionNonce: new BN(action.sessionNonce),
          expectedInventoryVersion: new BN(action.inventoryVersion),
          expectedRulesVersion: action.rulesVersion,
          expectedCatalogVersion: action.catalogVersion,
          cat: { [action.cat]: {} },
          market: { [action.market.toLowerCase()]: {} },
          stakeBaseUnits: new BN(action.stake),
        },
      },
      [],
      operationId,
    );
  }
  if (action.kind === "delegateRun") {
    Object.assign(values, {
      authority: owner,
      ownerProgram: program,
      buffer: delegateBufferPdaFromDelegatedAccountAndOwnerProgram(
        run,
        program,
      ),
      delegationRecord: delegationRecordPdaFromDelegatedAccount(run),
      delegationMetadata: delegationMetadataPdaFromDelegatedAccount(run),
      delegationProgram: DELEGATION_PROGRAM_ID,
    });
  }
  if (action.kind === "activateRun" || action.kind === "requestCompletion") {
    const seed = createHash("sha256")
      .update("purrps:crank:v1")
      .update(run.toBytes())
      .digest();
    Object.assign(values, {
      crank: PublicKey.findProgramAddressSync(
        [Buffer.from("crank"), run.toBytes(), seed],
        hydraProgram,
      )[0],
      magicProgram: MAGIC_PROGRAM_ID,
      hydraProgram,
      rentVault: EPHEMERAL_VAULT_ID,
    });
  }
  if (action.kind === "activateRun") {
    const playKey = new PublicKey(action.inputKey);
    sessionToken(owner, playKey);
    Object.assign(values, { playKey: playKey });
  }
  if ("delegationEpoch" in action) {
    return build(
      {
        args: {
          nonce: new BN(action.nonce),
          delegationEpoch: new BN(action.delegationEpoch),
        },
      },
      [],
      operationId,
    );
  }
  if (action.kind === "requestCompletion") {
    // The on-chain budget authority owns retries beyond the permissionless first attempt.
    Object.assign(values, {
      actionBalance: escrowPdaFromEscrowAuthority(run, 255),
    });
    return build({ expectedAttempt: 0 }, [], operationId);
  }
  Object.assign(values, { receipt: pda("result", ownerBytes, n) });
  return build({}, [], operationId);
}
