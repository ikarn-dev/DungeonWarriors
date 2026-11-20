import {
  BN,
  BorshInstructionCoder,
  convertIdlToCamelCase,
  type IdlInstructionAccountItem,
} from "@anchor-lang/core";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  PublicKey,
  SYSVAR_SLOT_HASHES_PUBKEY,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  type VersionedTransaction,
} from "@solana/web3.js";
import { z } from "zod";
import { DEVNET } from "../solana/addresses.ts";
import { PURRPS_GAME_IDL } from "../solana/purrps-game.ts";
import { USDC_DECIMALS } from "./economy";
import { checkedU64, U64_MAX } from "./rules";

const u64 = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,19})$/)
  .pipe(z.string().refine((value) => BigInt(value) <= U64_MAX));
const positive = u64.refine((value) => value !== "0");
const version = z.number().int().min(1).max(0xffffffff);
export const PAID_CAPSULE_RENT_AND_VRF_LIMIT = "20000000";
export const playerActions = [
  z.strictObject({ kind: z.literal("deposit"), amount: positive }),
  z.strictObject({ kind: z.literal("withdraw"), amount: positive }),
  z.strictObject({
    kind: z.literal("purchaseCapsule"),
    capsule: z.enum(["paidCat", "upgrade"]),
    nonce: u64,
    inventoryVersion: u64,
    catalogVersion: version,
  }),
  z.strictObject({ kind: z.literal("refundCapsule"), nonce: u64 }),
  z.strictObject({
    kind: z.literal("applyUpgrade"),
    inventoryVersion: u64,
    definingCatalogVersion: version,
    level: z.number().int().min(1).max(4),
    cat: z.enum(["collector", "acrobat", "guardian", "sprinter"]),
    grade: z.enum(["common", "rare", "epic"]),
  }),
] as const;
const playerAction = z.discriminatedUnion("kind", playerActions);
type PlayerAction = z.infer<typeof playerAction>;
export type PlayerIntent = {
  operation: "game";
  sponsored: false;
  action: PlayerAction;
};

const scale = 10n ** BigInt(USDC_DECIMALS);
const number = new Intl.NumberFormat("en-US");
const idl = convertIdlToCamelCase(PURRPS_GAME_IDL);
const coder = new BorshInstructionCoder(idl);

export function parseUsdc(input: string) {
  const clean = input.trim();
  if (!/^(?:0|[1-9][0-9]{0,13})(?:\.[0-9]{1,6})?$/.test(clean))
    throw new RangeError(
      "Enter a positive USDC amount with up to six decimals.",
    );
  const [whole = "0", fraction = ""] = clean.split(".");
  const value = checkedU64(
    BigInt(whole) * scale + BigInt(fraction.padEnd(USDC_DECIMALS, "0")),
  );
  if (value === 0n) throw new RangeError("Enter a positive USDC amount.");
  return value;
}

export function displayUsdc(raw: string) {
  return displayUnits(raw, USDC_DECIMALS);
}

export function displaySol(raw: string) {
  return displayUnits(raw, 9);
}

function displayUnits(raw: string, decimals: number) {
  const value = BigInt(raw);
  const divisor = 10n ** BigInt(decimals);
  const whole = number.format(value / divisor);
  const fraction = (value % divisor)
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  return fraction === "" ? whole : `${whole}.${fraction}`;
}

export function playerInstructions(wallet: string, action: PlayerAction) {
  const owner = new PublicKey(wallet);
  const program = new PublicKey(DEVNET.program);
  const mint = new PublicKey(DEVNET.usdcMint);
  const pda = (seed: string, ...parts: Uint8Array[]) =>
    PublicKey.findProgramAddressSync(
      [new TextEncoder().encode(seed), ...parts],
      program,
    )[0];
  const house = pda("house");
  const ownerTokens = getAssociatedTokenAddressSync(mint, owner);
  const addresses: Record<string, PublicKey> = {
    config: pda("game-config"),
    owner,
    player: pda("player", owner.toBytes()),
    house,
    vault: getAssociatedTokenAddressSync(mint, house, true),
    collection: pda("collection", owner.toBytes()),
    ownerTokens,
    usdcMint: mint,
    tokenProgram: new PublicKey(DEVNET.tokenProgram),
    systemProgram: SystemProgram.programId,
  };
  let args: object = {};
  let operationId = `${action.kind}:${wallet}`;
  if (action.kind === "deposit" || action.kind === "withdraw") {
    args = { amountBaseUnits: new BN(action.amount) };
  } else if ("nonce" in action) {
    const nonce = new Uint8Array(8);
    new DataView(nonce.buffer).setBigUint64(0, BigInt(action.nonce), true);
    const draw = pda("draw", owner.toBytes(), nonce);
    Object.assign(addresses, { draw });
    operationId = draw.toBase58();
    if (action.kind === "purchaseCapsule") {
      const version = new Uint8Array(4);
      new DataView(version.buffer).setUint32(0, action.catalogVersion, true);
      Object.assign(addresses, {
        catalog: pda("catalog", version),
        oracleQueue: new PublicKey(DEVNET.vrfQueue),
        programIdentity: pda("identity"),
        vrfProgram: new PublicKey(DEVNET.vrfProgram),
        slotHashes: SYSVAR_SLOT_HASHES_PUBKEY,
      });
      args = {
        expectedDrawNonce: new BN(action.nonce),
        expectedInventoryVersion: new BN(action.inventoryVersion),
        expectedCatalogVersion: action.catalogVersion,
        kind: { [action.capsule]: {} },
        maxPayerDebitLamports: new BN(PAID_CAPSULE_RENT_AND_VRF_LIMIT),
      };
    }
  } else {
    const version = new Uint8Array(4);
    new DataView(version.buffer).setUint32(
      0,
      action.definingCatalogVersion,
      true,
    );
    Object.assign(addresses, { catalog: pda("catalog", version) });
    args = {
      expectedInventoryVersion: new BN(action.inventoryVersion),
      expectedDefiningCatalogVersion: action.definingCatalogVersion,
      expectedCatLevel: action.level,
      cat: { [action.cat]: {} },
      grade: { [action.grade]: {} },
    };
  }
  const definition = idl.instructions.find((item) => item.name === action.kind);
  if (definition === undefined) throw new Error("UNEXPECTED_TRANSACTION");
  const keysFor = (
    meta: IdlInstructionAccountItem,
  ): TransactionInstruction["keys"] => {
    if ("accounts" in meta) return meta.accounts.flatMap(keysFor);
    const pubkey = addresses[meta.name];
    if (pubkey === undefined) throw new Error("UNEXPECTED_TRANSACTION");
    return [
      {
        pubkey,
        isSigner: "signer" in meta && meta.signer === true,
        isWritable: "writable" in meta && meta.writable === true,
      },
    ];
  };
  const keys = definition.accounts.flatMap(keysFor);
  const instructions = [
    ...(action.kind === "withdraw"
      ? [
          createAssociatedTokenAccountIdempotentInstruction(
            owner,
            ownerTokens,
            owner,
            mint,
          ),
        ]
      : []),
    new TransactionInstruction({
      keys,
      programId: program,
      data: coder.encode(
        action.kind,
        action.kind === "refundCapsule" ? {} : { args },
      ),
    }),
  ];
  return { instructions, payer: owner, operationId };
}

export function validatePreparedPlayerAction(
  tx: VersionedTransaction,
  wallet: string,
  intent: PlayerIntent,
) {
  const { instructions, payer } = playerInstructions(wallet, intent.action);
  const expected = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: tx.message.recentBlockhash,
    instructions,
  })
    .compileToV0Message()
    .serialize();
  const actual = tx.message.serialize();
  if (
    actual.length !== expected.length ||
    actual.some((byte, i) => byte !== expected[i])
  )
    throw new Error("UNEXPECTED_TRANSACTION");
}
