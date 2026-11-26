import { BN } from "@anchor-lang/core";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  PublicKey,
  SYSVAR_SLOT_HASHES_PUBKEY,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { deviceAddress } from "../game/device-intents";
import { decodeBase64, encodeBase64, WebApiError } from "../game/web-api";
import { DEVNET } from "../solana/addresses";
import { programInstruction } from "../solana/instruction";
import { nonceBytes, pda } from "../solana/program";
import { logDungeon } from "./debug";
import type { DungeonView } from "./protocol";
import { payout } from "./rules";

export function expeditionAddress(owner: string, nonce: string) {
  return pda("expedition", new PublicKey(owner).toBytes(), nonceBytes(nonce));
}
export function dungeonAccounts(owner: string, nonce: string) {
  const wallet = new PublicKey(owner),
    house = pda("house");
  return {
    config: pda("game-config"),
    owner: wallet,
    player: pda("player", wallet.toBytes()),
    collection: pda("collection", wallet.toBytes()),
    house,
    vault: getAssociatedTokenAddressSync(
      new PublicKey(DEVNET.usdcMint),
      house,
      true,
    ),
    expedition: expeditionAddress(owner, nonce),
    systemProgram: SystemProgram.programId,
  };
}
type ReservationTerms = Pick<
  DungeonView,
  "owner" | "nonce" | "cat" | "rules" | "commitment" | "stake" | "maxRooms"
>;
export function reservationInstruction(
  quote: ReservationTerms,
  sponsor: string,
  maxPayerDebit: string,
  device?: string,
) {
  const instruction = programInstruction(
    "reserveDungeon",
    {
      ...dungeonAccounts(quote.owner, quote.nonce),
      dungeon: pda("dungeon-config"),
      payer: new PublicKey(sponsor),
      oracleQueue: new PublicKey(DEVNET.vrfQueue),
      programIdentity: pda("identity"),
      vrfProgram: new PublicKey(DEVNET.vrfProgram),
      slotHashes: SYSVAR_SLOT_HASHES_PUBKEY,
    },
    {
      args: {
        nonce: new BN(quote.nonce),
        rulesVersion: quote.rules.version,
        cat: { [quote.cat]: {} },
        stake: new BN(quote.stake),
        maxRooms: quote.maxRooms,
        commitment: Array.from(Buffer.from(quote.commitment, "hex")),
        maxPayerDebitLamports: new BN(maxPayerDebit),
      },
    },
  );
  const owner = new PublicKey(quote.owner);
  if (device) {
    instruction.keys.push(
      { pubkey: new PublicKey(device), isSigner: true, isWritable: false },
      { pubkey: deviceAddress(owner), isSigner: false, isWritable: false },
    );
  } else {
    const authority = instruction.keys.find((meta) =>
      meta.pubkey.equals(owner),
    );
    if (!authority) throw new WebApiError("UNEXPECTED_DUNGEON_TRANSACTION");
    authority.isSigner = true;
  }
  return instruction;
}
export function reservationMessage(
  quote: ReservationTerms,
  sponsor: string,
  maxPayerDebit: string,
  recentBlockhash: string,
  fixedFees = true,
  device?: string,
) {
  return new TransactionMessage({
    payerKey: new PublicKey(sponsor),
    recentBlockhash,
    instructions: [
      // Explicitly use Devnet's default price so wallets leave the fee unchanged.
      ...(fixedFees
        ? [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 0n })]
        : []),
      reservationInstruction(quote, sponsor, maxPayerDebit, device),
    ],
  }).compileToV0Message();
}
function budgetInstructions(tx: VersionedTransaction) {
  const { compiledInstructions, staticAccountKeys } = tx.message;
  return compiledInstructions.filter(({ programIdIndex }) =>
    staticAccountKeys[programIdIndex]?.equals(ComputeBudgetProgram.programId),
  );
}
export function hasDungeonReservationFee(transaction: string) {
  return (
    budgetInstructions(
      VersionedTransaction.deserialize(decodeBase64(transaction)),
    ).length > 0
  );
}

export function validateDungeonReservation(
  tx: VersionedTransaction,
  owner: string,
  quote: DungeonView,
  device?: string,
) {
  const prepared = quote.preparation;
  if (
    !prepared ||
    quote.owner !== owner ||
    tx.message.addressTableLookups.length !== 0 ||
    payout(BigInt(quote.stake), quote.maxRooms, quote.rules) !==
      BigInt(quote.maxGross)
  )
    throw new WebApiError("UNEXPECTED_DUNGEON_TRANSACTION");
  // Previously issued messages can still be submitted against their original digest.
  const expected = reservationMessage(
    quote,
    prepared.sponsor,
    prepared.maxPayerDebit,
    tx.message.recentBlockhash,
    budgetInstructions(tx).length > 0,
    device,
  );
  const bytes = expected.serialize(),
    actual = tx.message.serialize();
  if (
    bytes.length !== actual.length ||
    bytes.some((value, index) => value !== actual[index])
  )
    throw new WebApiError("UNEXPECTED_DUNGEON_TRANSACTION");
}

export type DungeonApproval = { source: string; transaction: string };
export async function approveDungeonReservation(
  owner: string,
  quote: DungeonView,
  sign: (tx: VersionedTransaction) => Promise<VersionedTransaction>,
  previous: DungeonApproval | null,
  device?: string,
): Promise<DungeonApproval> {
  if (!quote.preparation || quote.owner !== owner)
    throw new WebApiError("INVALID_DUNGEON_QUOTE");
  const source = quote.preparation.transaction;
  const tx = VersionedTransaction.deserialize(decodeBase64(source));
  validateDungeonReservation(tx, owner, quote, device);
  if (previous?.source === source) {
    validateDungeonReservation(
      VersionedTransaction.deserialize(decodeBase64(previous.transaction)),
      owner,
      quote,
      device,
    );
    return previous;
  }
  const reviewed = tx.message.serialize();
  const before = walletSummary(tx);
  logDungeon("wallet.request", {
    network: "devnet",
    fixedFee: before.budget !== "",
  });
  let signed: VersionedTransaction;
  try {
    signed = await sign(tx);
  } catch (error) {
    const rejected =
      error instanceof Error &&
      /(?:user (?:rejected|declined|denied)|rejected by (?:the )?user)/i.test(
        error.message,
      );
    throw new WebApiError(
      rejected ? "DUNGEON_WALLET_DECLINED" : "DUNGEON_WALLET_FAILED",
    );
  }
  const signedMessage = signed.message.serialize();
  if (
    reviewed.length !== signedMessage.length ||
    reviewed.some((byte, index) => byte !== signedMessage[index])
  ) {
    const after = walletSummary(signed);
    const changes = {
      blockhashChanged: before.blockhash !== after.blockhash,
      feePayerChanged: before.payer !== after.payer,
      feeInstructionsChanged: before.budget !== after.budget,
      instructionCountBefore: before.instructions,
      instructionCountAfter: after.instructions,
    };
    logDungeon("wallet.message_changed", changes);
    throw new WebApiError(
      changes.feePayerChanged
        ? "DUNGEON_WALLET_PAYER_CHANGED"
        : changes.feeInstructionsChanged
          ? "DUNGEON_WALLET_FEE_CHANGED"
          : changes.blockhashChanged
            ? "DUNGEON_WALLET_BLOCKHASH_CHANGED"
            : "WALLET_CHANGED_DUNGEON_TRANSACTION",
    );
  }
  const ownerIndex = signed.message.staticAccountKeys.findIndex(
    (key) => key.toBase58() === (device ?? owner),
  );
  if (!signed.signatures[ownerIndex]?.some((byte) => byte !== 0))
    throw new WebApiError("INVALID_SIGNATURE");
  logDungeon("wallet.approved", { messageUnchanged: true });
  return { source, transaction: encodeBase64(signed.serialize()) };
}

function walletSummary(tx: VersionedTransaction) {
  return {
    blockhash: tx.message.recentBlockhash,
    payer: tx.message.staticAccountKeys[0]?.toBase58(),
    budget: budgetInstructions(tx)
      .map((instruction) => instruction.data.join(","))
      .join(";"),
    instructions: tx.message.compiledInstructions.length,
  };
}
