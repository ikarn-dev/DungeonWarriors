import {
  Keypair,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { expect, it } from "vitest";
import { dungeonViewSchema } from "../../../../../apps/web/lib/dungeon/protocol";
import {
  reservationInstruction,
  validateDungeonReservation,
} from "../../../../../apps/web/lib/dungeon/transactions";
import { record } from "./fixtures";

it("only approves the quoted dungeon reservation with sponsor as payer and no extra instructions", () => {
  const r = record();
  const quote = dungeonViewSchema.strip().parse({
    ...r,
    serverNow: 100000,
    proof: null,
    preparation: {
      transaction: "fixture",
      lastValidBlockHeight: 100,
      sponsor: r.reserve.sponsor,
      maxPayerDebit: r.reserve.maxPayerDebit,
    },
  });
  const ix = reservationInstruction(
    quote,
    r.reserve.sponsor,
    r.reserve.maxPayerDebit,
  );
  const sponsor = Keypair.fromSeed(new Uint8Array(32).fill(3)).publicKey;
  const make = (instructions = [ix], payer = sponsor) =>
    new VersionedTransaction(
      new TransactionMessage({
        payerKey: payer,
        recentBlockhash: Keypair.generate().publicKey.toBase58(),
        instructions,
      }).compileToV0Message(),
    );
  expect(() =>
    validateDungeonReservation(make(), r.owner, quote),
  ).not.toThrow();
  expect(() =>
    validateDungeonReservation(
      make([
        ix,
        SystemProgram.transfer({
          fromPubkey: sponsor,
          toPubkey: Keypair.generate().publicKey,
          lamports: 1,
        }),
      ]),
      r.owner,
      quote,
    ),
  ).toThrow("UNEXPECTED_DUNGEON_TRANSACTION");
  expect(() =>
    validateDungeonReservation(
      make([ix], Keypair.generate().publicKey),
      r.owner,
      quote,
    ),
  ).toThrow();
  expect(() =>
    validateDungeonReservation(make(), r.owner, { ...quote, stake: "2000000" }),
  ).toThrow();
  expect(() =>
    validateDungeonReservation(
      make(),
      Keypair.generate().publicKey.toBase58(),
      quote,
    ),
  ).toThrow();
});
