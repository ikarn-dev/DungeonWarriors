import { BN } from "@anchor-lang/core";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  PublicKey,
  SYSVAR_SLOT_HASHES_PUBKEY,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { decodeBase64, encodeBase64 } from "../game/web-api";
import { DEVNET } from "../solana/addresses";
import { programInstruction } from "../solana/instruction";
import { nonceBytes, pda } from "../solana/program";
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
export function reservationInstruction(
  quote: Pick<
    DungeonView,
    "owner" | "nonce" | "cat" | "rules" | "commitment" | "stake" | "maxRooms"
  >,
  sponsor: string,
  maxPayerDebit: string,
) {
  return programInstruction(
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
}
export function validateDungeonReservation(
  tx: VersionedTransaction,
  owner: string,
  quote: DungeonView,
) {
  const prepared = quote.preparation;
  if (
    !prepared ||
    quote.owner !== owner ||
    tx.message.addressTableLookups.length !== 0 ||
    payout(BigInt(quote.stake), quote.maxRooms, quote.rules) !==
      BigInt(quote.maxGross)
  )
    throw new Error("UNEXPECTED_DUNGEON_TRANSACTION");
  const expected = new TransactionMessage({
    payerKey: new PublicKey(prepared.sponsor),
    recentBlockhash: tx.message.recentBlockhash,
    instructions: [
      reservationInstruction(quote, prepared.sponsor, prepared.maxPayerDebit),
    ],
  }).compileToV0Message();
  const bytes = expected.serialize(),
    actual = tx.message.serialize();
  if (
    bytes.length !== actual.length ||
    bytes.some((value, index) => value !== actual[index])
  )
    throw new Error("UNEXPECTED_DUNGEON_TRANSACTION");
}

export type DungeonApproval = { source: string; transaction: string };
export async function approveDungeonReservation(
  owner: string,
  quote: DungeonView,
  sign: (tx: VersionedTransaction) => Promise<VersionedTransaction>,
  previous: DungeonApproval | null,
): Promise<DungeonApproval> {
  if (!quote.preparation || quote.owner !== owner)
    throw new Error("INVALID_DUNGEON_QUOTE");
  const source = quote.preparation.transaction;
  const tx = VersionedTransaction.deserialize(decodeBase64(source));
  validateDungeonReservation(tx, owner, quote);
  if (previous?.source === source) {
    validateDungeonReservation(
      VersionedTransaction.deserialize(decodeBase64(previous.transaction)),
      owner,
      quote,
    );
    return previous;
  }
  const preparedMessage = tx.message.serialize();
  const signed = await sign(tx);
  const signedMessage = signed.message.serialize();
  if (
    preparedMessage.length !== signedMessage.length ||
    preparedMessage.some((byte, index) => byte !== signedMessage[index])
  )
    throw new Error("WALLET_CHANGED_DUNGEON_TRANSACTION");
  return { source, transaction: encodeBase64(signed.serialize()) };
}
