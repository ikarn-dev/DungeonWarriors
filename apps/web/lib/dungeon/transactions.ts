import { BN } from "@anchor-lang/core";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  PublicKey,
  SYSVAR_SLOT_HASHES_PUBKEY,
  SystemProgram,
  TransactionMessage,
  type VersionedTransaction,
} from "@solana/web3.js";
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
