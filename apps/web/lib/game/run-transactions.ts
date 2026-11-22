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
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  type VersionedTransaction,
} from "@solana/web3.js";
import { z } from "zod";
import {
  DEVNET,
  LEADERBOARD_SEED,
  MARKETS,
  oracleAddress,
  publicKeySchema,
} from "../solana/addresses.ts";
import {
  coder,
  crankAddress,
  hydraProgram,
  idl,
  nonceBytes,
  pda,
  program,
  u64Input,
} from "../solana/program";
import { playerActions, playerInstructions } from "./custody-client";
import { WebApiError } from "./web-api";

const positive = u64Input.refine((n) => n !== "0");
const version = z.number().int().min(1).max(0xffffffff);
const marketSchema = z.enum(["BTC", "ETH", "SOL"]);
// New reservations in the current program start at delegation epoch 1.
const initialDelegationEpoch = "1";
const catSchema = z.enum(["collector", "acrobat", "guardian", "sprinter"]);
const nonce = { nonce: u64Input };
const identity = { ...nonce, delegationEpoch: positive };
export const completionOfferSchema = z.strictObject({
  sponsor: publicKeySchema,
  lamports: positive,
  floor: u64Input,
  attempts: z.number().int().min(1).max(65_535),
});
export type CompletionOffer = z.infer<typeof completionOfferSchema>;
export const playSponsorSchema = completionOfferSchema.pick({
  sponsor: true,
  floor: true,
});
export type PlaySponsor = z.infer<typeof playSponsorSchema>;
export const sessionTokenSpace = 8 + 3 * 32 + 8;
const action = z.discriminatedUnion("kind", [
  ...playerActions,
  z.strictObject({
    kind: z.literal("authorizeSession"),
    ...nonce,
    inputKey: publicKeySchema,
    expiresAtSeconds: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    allowance: u64Input,
    rent: z
      .strictObject({ token: u64Input, authorization: u64Input })
      .optional(),
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
    stake: u64Input,
    maxGross: u64Input.optional(),
    completionFunding: completionOfferSchema.optional(),
    expiresAtSeconds: z
      .number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER)
      .optional(),
  }),
  z.strictObject({
    kind: z.literal("delegateRun"),
    ...identity,
    completionSponsor: publicKeySchema.optional(),
    inputKey: publicKeySchema.optional(),
  }),
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
    kind: z.literal("resumeRun"),
    ...nonce,
    market: marketSchema,
    inputKey: publicKeySchema,
    suspendedAt: positive.refine(
      (value) => BigInt(value) <= 0x7fffffffffffffffn,
    ),
  }),
  z.strictObject({
    kind: z.literal("requestCompletion"),
    ...nonce,
    market: marketSchema,
    hasCrank: z.boolean().optional(),
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
  playSponsor: playSponsorSchema.optional(),
  action,
});
export type GameIntent = z.infer<typeof gameIntentSchema>;

export function runSponsor(action: GameIntent["action"]) {
  if (action.kind === "reserveRun") return action.completionFunding?.sponsor;
  if (action.kind === "delegateRun") return action.completionSponsor;
  return undefined;
}

const sessionProgram = new PublicKey(
  "KeyspM2ssCJbqUhQ4k7sveSiY4WjnYsrXkC8oDbwde5",
);
const mint = new PublicKey(DEVNET.usdcMint);

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
      throw new WebApiError("UNSUPPORTED_ACCOUNT_LAYOUT");
    return [
      {
        pubkey,
        isSigner: "signer" in meta && meta.signer === true,
        isWritable:
          "writable" in meta &&
          meta.writable === true &&
          !("optional" in meta && meta.optional && pubkey.equals(program)),
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
  if (definition === undefined) throw new WebApiError("INSTRUCTION_NOT_BUILT");
  return new TransactionInstruction({
    programId: program,
    keys: accountMetas(definition.accounts, values),
    data: coder.instruction.encode(name, args),
  });
}

export function sessionToken(owner: PublicKey, inputKey: PublicKey) {
  if (owner.equals(inputKey) || !PublicKey.isOnCurve(inputKey.toBytes()))
    throw new WebApiError("INVALID_PLAY_KEY");
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
  // sha256("global:create_session")[0..8]
  data.set([242, 193, 143, 179, 150, 25, 122, 227]);
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
    case "resumeRun":
      return "er";
    default:
      return "base";
  }
}

export function gameInstructions(
  wallet: string,
  { action, playSponsor }: GameIntent,
): {
  instructions: TransactionInstruction[];
  payer: PublicKey;
  operationId: string;
} {
  if (
    action.kind === "deposit" ||
    action.kind === "withdraw" ||
    action.kind === "purchaseCapsule" ||
    action.kind === "refundCapsule" ||
    action.kind === "applyUpgrade"
  )
    return playerInstructions(wallet, action);
  const owner = new PublicKey(wallet);
  const payer = playSponsor ? new PublicKey(playSponsor.sponsor) : owner;
  if (playSponsor && payer.equals(owner))
    throw new WebApiError("INVALID_RUN_SPONSOR");
  const ownerBytes = owner.toBytes();
  const house = pda("house");
  const values: Record<string, PublicKey> = {
    owner,
    payer,
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
    instructionName: string = action.kind,
  ) => ({
    instructions: [
      ...prefix,
      programInstruction(instructionName, values, args),
      ...(playSponsor && gameNetwork(action) === "base"
        ? [
            SystemProgram.transfer({
              fromPubkey: payer,
              toPubkey: payer,
              lamports: BigInt(playSponsor.floor),
            }),
          ]
        : []),
    ],
    payer,
    operationId,
  });

  if (action.kind === "authorizeSession" || action.kind === "revokeSession") {
    const authorization = pda("session", ownerBytes, nonceBytes(action.nonce));
    Object.assign(values, { authorization: authorization });
    if (action.kind === "revokeSession")
      return build({}, [], authorization.toBase58());
    const inputKey = new PublicKey(action.inputKey);
    const token = sessionToken(owner, inputKey);
    if (
      playSponsor &&
      (!action.rent || action.allowance === "0" || inputKey.equals(payer))
    )
      throw new WebApiError("INVALID_REQUEST");
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
      [
        ...(playSponsor && action.rent
          ? [
              [token, action.rent.token],
              [authorization, action.rent.authorization],
            ].flatMap(([address, lamports]) =>
              address instanceof PublicKey &&
              typeof lamports === "string" &&
              lamports !== "0"
                ? [
                    SystemProgram.transfer({
                      fromPubkey: payer,
                      toPubkey: address,
                      lamports: BigInt(lamports),
                    }),
                  ]
                : [],
            )
          : []),
        createSession(owner, inputKey, token, action.expiresAtSeconds),
      ],
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
    leaderboard: pda(LEADERBOARD_SEED),
  });
  if (market >= 0) {
    const marketEntry = MARKETS[market];
    if (marketEntry === undefined) throw new WebApiError("INVALID_MARKET");
    Object.assign(values, {
      priceUpdate: new PublicKey(oracleAddress(marketEntry.feedId)),
    });
  }
  const operationId = run.toBase58();
  if (action.kind === "resumeRun") {
    const inputKey = new PublicKey(action.inputKey);
    sessionToken(owner, inputKey);
    const prepared = build(
      { suspendedAt: new BN(action.suspendedAt) },
      [],
      operationId,
    );
    prepared.instructions[0]?.keys.push({
      pubkey: inputKey,
      isSigner: true,
      isWritable: false,
    });
    return prepared;
  }
  if (action.kind === "reserveRun") {
    Object.assign(values, {
      authority: playSponsor ? new PublicKey(action.inputKey) : owner,
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
    if (action.expiresAtSeconds !== undefined && action.maxGross === undefined)
      throw new WebApiError("INVALID_REQUEST");
    if (playSponsor && (action.stake === "0" || action.maxGross === undefined))
      throw new WebApiError("INVALID_REQUEST");
    const funding = action.completionFunding;
    const fundingInstructions: TransactionInstruction[] = [];
    if (funding) {
      const sponsor = new PublicKey(funding.sponsor);
      if (
        action.expiresAtSeconds === undefined ||
        sponsor.equals(owner) ||
        sponsor.equals(new PublicKey(action.inputKey))
      )
        throw new WebApiError("INVALID_REQUEST");
      fundingInstructions.push(
        programInstruction(
          "fundSponsorship",
          { ...values, funder: sponsor },
          {
            args: {
              operation: run,
              beneficiary: owner,
              purpose: { runCompletion: {} },
              limitLamports: new BN(funding.lamports),
              reservedCompletionLamports: new BN(funding.lamports),
              maxAttempts: funding.attempts,
              expiresAtSeconds: new BN(action.expiresAtSeconds),
            },
          },
        ),
      );
      if (!playSponsor)
        fundingInstructions.push(
          SystemProgram.transfer({
            fromPubkey: sponsor,
            toPubkey: sponsor,
            lamports: BigInt(funding.floor),
          }),
        );
    }
    const authorization =
      action.expiresAtSeconds === undefined || playSponsor
        ? []
        : gameInstructions(wallet, {
            operation: "game",
            sponsored: false,
            action: {
              kind: "authorizeSession",
              nonce: action.sessionNonce,
              inputKey: action.inputKey,
              expiresAtSeconds: action.expiresAtSeconds,
              allowance: action.stake,
            },
          }).instructions;
    const reserved = build(
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
        ...(action.maxGross === undefined
          ? {}
          : { maxGross: new BN(action.maxGross) }),
      },
      [...fundingInstructions, ...authorization],
      operationId,
      action.maxGross === undefined ? "reserveRun" : "reserveQuotedRun",
    );
    if (!playSponsor) return reserved;
    const delegated = gameInstructions(wallet, {
      operation: "game",
      sponsored: false,
      playSponsor,
      action: {
        kind: "delegateRun",
        nonce: action.nonce,
        delegationEpoch: initialDelegationEpoch,
        inputKey: action.inputKey,
        completionSponsor: playSponsor.sponsor,
      },
    });
    return {
      ...reserved,
      // Check the floor once, after the final debit.
      instructions: [
        ...reserved.instructions.slice(0, -1),
        ...delegated.instructions,
      ],
    };
  }
  if (action.kind === "delegateRun") {
    if (playSponsor && !action.inputKey)
      throw new WebApiError("INVALID_PLAY_KEY");
    Object.assign(values, {
      authority:
        playSponsor && action.inputKey ? new PublicKey(action.inputKey) : owner,
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
    Object.assign(values, {
      crank: crankAddress(run),
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
    const funding =
      action.kind === "delegateRun" && action.completionSponsor
        ? [
            programInstruction(
              "fundRunCompletion",
              {
                ...values,
                sponsor: new PublicKey(action.completionSponsor),
                actionBalance: escrowPdaFromEscrowAuthority(run, 255),
              },
              {},
            ),
          ]
        : [];
    return build(
      {
        args: {
          nonce: new BN(action.nonce),
          delegationEpoch: new BN(action.delegationEpoch),
        },
      },
      funding,
      operationId,
    );
  }
  if (action.kind === "requestCompletion") {
    // The on-chain budget authority owns retries beyond the permissionless first attempt.
    Object.assign(values, {
      actionBalance: escrowPdaFromEscrowAuthority(run, 255),
      ...(action.hasCrank === false
        ? { crank: program, rentVault: program, hydraProgram: program }
        : {}),
    });
    return build({ expectedAttempt: 0 }, [], operationId);
  }
  Object.assign(values, { receipt: pda("result", ownerBytes, n) });
  return build({}, [], operationId);
}

export function validatePreparedGame(
  tx: VersionedTransaction,
  wallet: string,
  intent: GameIntent,
  prepared: { network: "base" | "er"; operationId: string; blockhash: string },
) {
  const action = intent.action;
  const expected = gameInstructions(wallet, intent);
  const message = new TransactionMessage({
    payerKey: expected.payer,
    recentBlockhash: prepared.blockhash,
    instructions: expected.instructions,
  }).compileToV0Message();
  if (
    tx.version !== 0 ||
    prepared.operationId !== expected.operationId ||
    prepared.network !== gameNetwork(action) ||
    tx.signatures.some((signature) => signature.some((byte) => byte !== 0)) ||
    !Buffer.from(tx.message.serialize()).equals(
      Buffer.from(message.serialize()),
    )
  )
    throw new WebApiError("UNEXPECTED_TRANSACTION");
}
