import { PublicKey } from "@solana/web3.js";

// Upstream PriceUpdateV3: Full verification occupies one byte. Account allocation
// includes zero padding; the signed Borsh payload is 133 bytes, not a JS float.
// https://github.com/magicblock-labs/real-time-pricing-oracle/blob/main/program/ephemeral-oracle/programs/ephemeral-oracle/src/lib.rs
const discriminator = [234, 161, 14, 36, 172, 239, 15, 232] as const;

export type OracleQuote = {
  readonly writeAuthority: string;
  readonly feedId: Uint8Array;
  readonly price: bigint;
  readonly confidence: bigint;
  readonly exponent: number;
  readonly publishedAtSeconds: bigint;
  readonly previousPublishedAtSeconds: bigint;
  readonly emaPrice: bigint;
  readonly emaConfidence: bigint;
  readonly postedSlot: bigint;
};

export class OracleError extends Error {
  constructor(
    code:
      | "MALFORMED_ORACLE"
      | "ORACLE_AUTHORITY_MISMATCH"
      | "ORACLE_STALE"
      | "ORACLE_INVALID",
  ) {
    super(code);
    this.name = "OracleError";
  }
}

export function decodeOracleQuote(
  data: Uint8Array,
  expectedWriteAuthority: string,
): OracleQuote {
  if (
    data.length < 133 ||
    data.length > 256 ||
    data[40] !== 1 ||
    discriminator.some((byte, index) => data[index] !== byte) ||
    data.subarray(133).some((byte) => byte !== 0)
  )
    throw new OracleError("MALFORMED_ORACLE");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const writeAuthority = new PublicKey(data.subarray(8, 40)).toBase58();
  if (writeAuthority !== expectedWriteAuthority)
    throw new OracleError("ORACLE_AUTHORITY_MISMATCH");
  return {
    writeAuthority,
    feedId: data.slice(41, 73),
    price: view.getBigInt64(73, true),
    confidence: view.getBigUint64(81, true),
    exponent: view.getInt32(89, true),
    publishedAtSeconds: view.getBigInt64(93, true),
    previousPublishedAtSeconds: view.getBigInt64(101, true),
    emaPrice: view.getBigInt64(109, true),
    emaConfidence: view.getBigUint64(117, true),
    postedSlot: view.getBigUint64(125, true),
  };
}

export function validateOracleQuote(
  quote: OracleQuote,
  policy: {
    readonly nowSeconds: bigint;
    readonly currentSlot: bigint;
    readonly maxAgeSeconds: bigint;
    readonly maxFutureSkewSeconds: bigint;
    readonly minExponent: number;
    readonly maxExponent: number;
  },
): void {
  if (
    policy.maxAgeSeconds <= 0n ||
    policy.maxFutureSkewSeconds < 0n ||
    policy.nowSeconds < 0n ||
    policy.currentSlot < 0n ||
    !Number.isInteger(policy.minExponent) ||
    !Number.isInteger(policy.maxExponent) ||
    policy.minExponent < -18 ||
    policy.maxExponent > 18 ||
    policy.minExponent > policy.maxExponent ||
    quote.price <= 0n ||
    quote.postedSlot === 0n ||
    quote.postedSlot > policy.currentSlot ||
    quote.publishedAtSeconds < 0n ||
    quote.previousPublishedAtSeconds > quote.publishedAtSeconds ||
    quote.exponent < policy.minExponent ||
    quote.exponent > policy.maxExponent ||
    quote.publishedAtSeconds > policy.nowSeconds + policy.maxFutureSkewSeconds
  ) {
    throw new OracleError("ORACLE_INVALID");
  }
  if (quote.publishedAtSeconds + policy.maxAgeSeconds < policy.nowSeconds)
    throw new OracleError("ORACLE_STALE");
}
