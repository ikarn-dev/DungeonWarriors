import "server-only";
import { createHash } from "node:crypto";
import type { Connection } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
import { decodeOracleQuote, validateOracleQuote } from "../providers/oracle.mts";
import { scheduleBrowserPrice } from "../game/browser-replay";
import { DEVNET } from "../solana/addresses";
import type { BrowserSession } from "./browser-store";
import { ApiError } from "./runtime";

export async function witnessBrowserPrice(session: BrowserSession, rpc: Connection, now: number) {
  const { source } = session;
  const { context, value: [info, clock] } = await rpc.getMultipleAccountsInfoAndContext(
    [new PublicKey(source.account), new PublicKey(DEVNET.clock)], "confirmed");
  if (!info || info.executable || info.owner.toBase58() !== DEVNET.oracleProgram ||
      !clock || clock.executable || clock.owner.toBase58() !== DEVNET.sysvarOwner || clock.data.length !== 40)
    throw new ApiError("ORACLE_INVALID", 503);
  const quote = decodeOracleQuote(info.data, source.writeAuthority);
  validateOracleQuote(quote, {
    nowSeconds: clock.data.readBigInt64LE(32), currentSlot: BigInt(context.slot),
    maxAgeSeconds: BigInt(source.maxAgeSeconds), maxFutureSkewSeconds: BigInt(source.maxFutureSkewSeconds),
    minExponent: source.minExponent, maxExponent: source.maxExponent,
  });
  const contentHash = createHash("sha256").update(info.data.subarray(0, 133)).digest("hex");
  const previous = session.witnesses.at(-1);
  if (!previous) throw new ApiError("ORACLE_INVALID", 503);
  if (contentHash === previous.contentHash) return;
  if (quote.postedSlot < BigInt(previous.postedSlot) ||
      quote.publishedAtSeconds < BigInt(previous.publishedAtSeconds) || quote.exponent !== previous.exponent ||
      (quote.postedSlot === BigInt(previous.postedSlot) && quote.publishedAtSeconds === BigInt(previous.publishedAtSeconds)))
    throw new ApiError("ORACLE_INVALID", 503);
  session.witnesses = [...session.witnesses, {
    sequence: (BigInt(previous.sequence) + 1n).toString(), price: quote.price.toString(),
    exponent: quote.exponent, postedSlot: quote.postedSlot.toString(),
    publishedAtSeconds: quote.publishedAtSeconds.toString(), contentHash,
  }].slice(-16);
  const oldest = session.witnesses[0];
  if (!oldest) throw new ApiError("ORACLE_INVALID", 503);
  scheduleBrowserPrice(session.replay, {
    previousPrice: BigInt(oldest.price), previousExponent: oldest.exponent,
    price: quote.price, exponent: quote.exponent,
  }, now, BigInt(previous.sequence) + 1n);
}
