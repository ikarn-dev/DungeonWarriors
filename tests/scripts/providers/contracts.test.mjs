import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { providerConfigSchema } from "../../../apps/web/lib/providers/config.ts";
import {
  decodeOracleQuote,
  validateOracleQuote,
} from "../../../apps/web/lib/providers/oracle.ts";
import {
  accountBytes,
  balanceSchema,
  decodeClock,
  rpcResult,
} from "../../../apps/web/lib/providers/rpc-schema.mts";
import {
  DEVNET,
  oracleAddress,
  vrfCallbackAuthority,
} from "../../../apps/web/lib/solana/addresses.ts";
import {
  environment,
  publicKey,
} from "../../fixtures/providers/environment.mjs";

const bytes = Buffer.from(
  readFileSync(
    new URL("../../fixtures/providers/oracle-v3-full.hex", import.meta.url),
    "utf8",
  ).trim(),
  "hex",
);
const policy = {
  nowSeconds: 1_700_000_002n,
  currentSlot: 123_456_790n,
  maxAgeSeconds: 2n,
  maxFutureSkewSeconds: 0n,
  minExponent: -18,
  maxExponent: 0,
};

test("captured hosted feeds preserve zero writer pins and positive exponents", () => {
  const [slot, now, ...accounts] = readFileSync(
    new URL(
      "../../fixtures/providers/oracle-v3-devnet-as.csv",
      import.meta.url,
    ),
    "utf8",
  )
    .trim()
    .split("\n")[1]
    .split(",");
  assert.equal(accounts.length, 3);
  for (const hex of accounts) {
    const bytes = Buffer.from(hex, "hex");
    const quote = decodeOracleQuote(bytes, "11111111111111111111111111111111");
    assert.equal(quote.writeAuthority, "11111111111111111111111111111111");
    assert.equal(quote.exponent, 8);
    validateOracleQuote(quote, {
      nowSeconds: BigInt(now),
      currentSlot: BigInt(slot),
      maxAgeSeconds: 2n,
      maxFutureSkewSeconds: 1n,
      minExponent: 8,
      maxExponent: 8,
    });
    assert.throws(
      () => decodeOracleQuote(bytes, publicKey),
      /ORACLE_AUTHORITY_MISMATCH/,
    );
  }
});

test("provider configuration parses exact budgets and rejects unsafe or mismatched destinations", () => {
  const config = providerConfigSchema.parse(environment);
  assert.equal(config.SPONSOR_MIN_BALANCE_LAMPORTS, 10_000_000n);
  assert.equal(config.ORACLE_MAX_AGE_SECONDS, 2);
  for (const change of [
    { HELIUS_DEVNET_RPC_URL: "https://mainnet.helius-rpc.com/?api-key=TEST" },
    {
      HELIUS_DEVNET_RPC_URL:
        "https://devnet.helius-rpc.com.attacker.example/?api-key=TEST",
    },
    {
      HELIUS_DEVNET_RPC_URL:
        "https://user:password@devnet.helius-rpc.com/?api-key=TEST",
    },
    { HELIUS_DEVNET_RPC_URL: "not a URL" },
    { UPSTASH_REDIS_REST_URL: "https://upstash.io.attacker.example" },
    { MAGICBLOCK_ER_HTTP_URL: "http://127.0.0.1:8899" },
    { MAGICBLOCK_ER_WS_URL: "wss://devnet-us.magicblock.app" },
    { MAGICBLOCK_ER_WS_URL: "wss://devnet-as.magicblock.app?token=TEST" },
    { SPONSOR_OPERATION_LIMIT_LAMPORTS: "18446744073709551616" },
    { SPONSOR_OPERATION_LIMIT_LAMPORTS: "0" },
    { SPONSOR_COMPLETION_RESERVE_LAMPORTS: "5000001" },
    { SPONSOR_MIN_BALANCE_LAMPORTS: "4999999" },
    { ORACLE_MAX_AGE_SECONDS: "0" },
    { ORACLE_MAX_AGE_SECONDS: "invalid" },
    { ORACLE_MIN_EXPONENT: "1", ORACLE_MAX_EXPONENT: "0" },
    { APP_ORIGIN: "https://dungeon-warriors.example/path" },
    { APP_ORIGIN: "http://dungeon-warriors.example" },
    { APP_ORIGIN: "http://192.168.1.4:3000" },
    { APP_ORIGIN: "http://localhost:3000/" },
  ])
    assert.equal(
      providerConfigSchema.safeParse({ ...environment, ...change }).success,
      false,
    );
});

test("APP_ORIGIN accepts http only for loopback hosts outside Vercel", () => {
  for (const origin of [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://[::1]:3000",
  ])
    assert.equal(
      providerConfigSchema.safeParse({ ...environment, APP_ORIGIN: origin })
        .success,
      true,
    );
  process.env.VERCEL = "1";
  try {
    assert.equal(
      providerConfigSchema.safeParse({
        ...environment,
        APP_ORIGIN: "http://localhost:3000",
      }).success,
      false,
    );
  } finally {
    delete process.env.VERCEL;
  }
});
test("oracle decoding preserves all signed fields and full-width integer precision", () => {
  const expectedHash = readFileSync(
    new URL("../../fixtures/providers/oracle-v3-full.sha256", import.meta.url),
    "utf8",
  ).trim();
  assert.equal(createHash("sha256").update(bytes).digest("hex"), expectedHash);
  const quote = decodeOracleQuote(bytes, publicKey);
  assert.equal(quote.price, 9_007_199_254_740_993n);
  assert.equal(quote.exponent, -8);
  assert.equal(quote.confidence, 128n);
  assert.equal(quote.emaPrice, 9_007_199_254_740_999n);
  assert.equal(quote.emaConfidence, 64n);
  assert.equal(quote.postedSlot, 123_456_789n);
  assert.deepEqual(
    [...quote.feedId],
    Array.from({ length: 32 }, (_, index) => index),
  );
  validateOracleQuote(quote, policy);
  assert.throws(
    () =>
      validateOracleQuote(quote, {
        ...policy,
        nowSeconds: policy.nowSeconds + 1n,
      }),
    /ORACLE_STALE/,
  );
  const padded = Buffer.concat([bytes, Buffer.alloc(19)]);
  assert.deepEqual(decodeOracleQuote(padded.subarray(0), publicKey), quote);
  const offset = Buffer.concat([Buffer.alloc(7), bytes]);
  assert.deepEqual(decodeOracleQuote(offset.subarray(7), publicKey), quote);
});

test("unknown/partial oracle schemas and unsafe observations fail closed", () => {
  assert.throws(
    () => decodeOracleQuote(bytes.subarray(0, 132), publicKey),
    /MALFORMED_ORACLE/,
  );
  for (const [offset, value] of [
    [0, 0],
    [40, 0],
    [40, 2],
  ]) {
    const corrupt = Buffer.from(bytes);
    corrupt[offset] = value;
    assert.throws(
      () => decodeOracleQuote(corrupt, publicKey),
      /MALFORMED_ORACLE/,
    );
  }
  assert.throws(
    () =>
      decodeOracleQuote(Buffer.concat([bytes, Buffer.from([1])]), publicKey),
    /MALFORMED_ORACLE/,
  );
  assert.throws(
    () => decodeOracleQuote(bytes, DEVNET.program),
    /ORACLE_AUTHORITY_MISMATCH/,
  );
  const quote = decodeOracleQuote(bytes, publicKey);
  for (const change of [
    { price: 0n },
    { price: -1n },
    { exponent: -19 },
    { postedSlot: 0n },
    { postedSlot: policy.currentSlot + 1n },
    { publishedAtSeconds: -1n },
    { publishedAtSeconds: policy.nowSeconds + 1n },
    { previousPublishedAtSeconds: quote.publishedAtSeconds + 1n },
  ])
    assert.throws(
      () => validateOracleQuote({ ...quote, ...change }, policy),
      /ORACLE_INVALID/,
    );
  for (const change of [
    { maxAgeSeconds: 0n },
    { maxFutureSkewSeconds: -1n },
    { minExponent: 1, maxExponent: 0 },
  ]) {
    assert.throws(
      () => validateOracleQuote(quote, { ...policy, ...change }),
      /ORACLE_INVALID/,
    );
  }
  const negative = Buffer.from(bytes);
  negative.writeBigInt64LE(-123n, 73);
  assert.equal(decodeOracleQuote(negative, publicKey).price, -123n);
});

test("RPC parsing rejects ambiguous envelopes, imprecise balances and malformed binary data", () => {
  assert.equal(rpcResult({ jsonrpc: "2.0", id: 1, result: null }), null);
  assert.throws(() => rpcResult({ jsonrpc: "2.0", id: 1 }));
  assert.throws(() =>
    rpcResult({
      jsonrpc: "2.0",
      id: 1,
      result: "ok",
      error: { code: -1, message: "TEST_ONLY" },
    }),
  );
  assert.equal(
    balanceSchema.safeParse({
      context: { slot: 1 },
      value: Number.MAX_SAFE_INTEGER + 1,
    }).success,
    false,
  );
  assert.throws(
    () => accountBytes({ data: ["not base64", "base64"] }),
    /MALFORMED_ACCOUNT/,
  );
  const clock = Buffer.alloc(40);
  clock.writeBigUInt64LE(7n, 0);
  clock.writeBigInt64LE(1_700_000_000n, 32);
  assert.deepEqual(
    decodeClock({
      owner: DEVNET.sysvarOwner,
      executable: false,
      data: [clock.toString("base64"), "base64"],
    }),
    { slot: 7n, nowSeconds: 1_700_000_000n },
  );
  assert.throws(
    () =>
      decodeClock({
        owner: DEVNET.program,
        executable: false,
        data: [clock.toString("base64"), "base64"],
      }),
    /CLOCK_MISMATCH/,
  );
});

test("market PDAs and callback identities stay scoped to the intended program", () => {
  const addresses = [1, 2, 6].map(oracleAddress);
  assert.equal(new Set(addresses).size, 3);
  assert.throws(() => oracleAddress(3));
  assert.notEqual(
    vrfCallbackAuthority(DEVNET.program),
    "9irBy75QS2BN81FUgXuHcjqceJJRuc9oDkAe8TKVvvAw",
  );
  assert.notEqual(
    vrfCallbackAuthority(DEVNET.program),
    vrfCallbackAuthority(publicKey),
  );
});
