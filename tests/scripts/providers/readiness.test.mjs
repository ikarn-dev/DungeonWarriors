import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DEVNET } from "../../../apps/web/lib/solana/addresses.mts";
import { runReadiness } from "../../../scripts/providers/check-readiness.mjs";
import {
  environment,
  publicKey,
} from "../../fixtures/providers/environment.mjs";

const oracle = Buffer.from(
  readFileSync(
    new URL("../../fixtures/providers/oracle-v3-full.hex", import.meta.url),
    "utf8",
  ).trim(),
  "hex",
);
const devnetGenesis = readFileSync(
  new URL("../../fixtures/providers/devnet-genesis.txt", import.meta.url),
  "utf8",
).trim();

function account(owner, data, executable = false) {
  return {
    owner,
    data: [data.toString("base64"), "base64"],
    executable,
    lamports: 1,
  };
}

function providerResponse(method, host, overrides = {}) {
  if (method === "getGenesisHash") return devnetGenesis;
  if (method === "getIdentity") return { identity: publicKey };
  if (method === "getBalance")
    return { context: { slot: 123_456_790 }, value: 10_000_000 };
  if (
    method === "getMultipleAccounts" &&
    (host.includes("helius") || host.includes("router"))
  ) {
    const mint = Buffer.alloc(82);
    mint[44] = 6;
    mint[45] = 1;
    return {
      context: { slot: 123_456_790 },
      value: host.includes("router")
        ? [account(DEVNET.tokenProgram, mint)]
        : [
            account(DEVNET.tokenProgram, mint),
            account(DEVNET.program, Buffer.alloc(0), true),
            account(DEVNET.vrfProgram, Buffer.alloc(0)),
          ],
    };
  }
  if (method === "getMultipleAccounts") {
    const clock = Buffer.alloc(40);
    clock.writeBigUInt64LE(123_456_790n, 0);
    clock.writeBigInt64LE(1_700_000_002n, 32);
    const values = [
      account(DEVNET.sysvarOwner, clock),
      ...Array.from({ length: 3 }, () => account(DEVNET.oracleProgram, oracle)),
    ];
    return {
      context: { slot: 123_456_790 },
      value: overrides.erAccounts ?? values,
    };
  }
  throw new Error("Unexpected test request");
}

function stubProviders(context, change = () => undefined, overrides = {}) {
  const requests = [];
  context.mock.method(globalThis, "fetch", async (url, options) => {
    requests.push({ url, options });
    assert.equal(options.redirect, "error");
    assert.equal(options.method, "POST");
    const body = JSON.parse(options.body);
    const changed = change(body, url);
    if (changed !== undefined) return changed;
    const payload = Array.isArray(body)
      ? { result: "PONG" }
      : {
          jsonrpc: "2.0",
          id: 1,
          result: providerResponse(
            body.method,
            new URL(url).hostname,
            overrides,
          ),
        };
    return new Response(JSON.stringify(payload));
  });
  return requests;
}

test("readiness performs seven read-only requests and never passes the integration gate", async (context) => {
  const requests = stubProviders(context);
  const report = await runReadiness(environment);
  assert.equal(report.status, "provider_reads_passed");
  assert.equal(report.integrationGate, "unverified");
  assert.equal(report.checks.length, 4);
  assert.equal(requests.length, 7);
  assert.ok(report.remainingEvidence.includes("crank_auth_clock_duplicates"));
  assert.ok(
    report.remainingEvidence.includes("redis_write_and_nonce_atomicity"),
  );
  const json = JSON.stringify(report);
  assert.ok(!json.includes(environment.UPSTASH_REDIS_REST_TOKEN));
  assert.ok(!json.includes(environment.HELIUS_DEVNET_RPC_URL));
});

test("bad configuration stops before contacting a provider", async (context) => {
  let called = false;
  context.mock.method(globalThis, "fetch", async () => {
    called = true;
    throw new Error("Unexpected request");
  });
  const report = await runReadiness({
    ...environment,
    HELIUS_DEVNET_RPC_URL: "invalid-TEST_ONLY_RPC_CREDENTIAL",
  });
  assert.equal(report.status, "configuration_required");
  assert.deepEqual(report.fields, ["HELIUS_DEVNET_RPC_URL"]);
  assert.equal(called, false);
  assert.ok(!JSON.stringify(report).includes("TEST_ONLY_RPC_CREDENTIAL"));
});

test("wrong chains, spoofed identities and underfunding fail without leaking errors", async (context) => {
  stubProviders(context, (body, url) => {
    if (body.method === "getMultipleAccounts" && url.includes("router"))
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: {
            context: { slot: 1 },
            value: [account(DEVNET.program, Buffer.alloc(82))],
          },
        }),
      );
    if (body.method === "getIdentity")
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: { identity: DEVNET.program },
        }),
      );
    if (body.method === "getBalance")
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: { context: { slot: 1 }, value: 1 },
        }),
      );
    if (Array.isArray(body))
      throw new Error(`Private URL ${environment.HELIUS_DEVNET_RPC_URL}`);
    return undefined;
  });
  const report = await runReadiness(environment);
  assert.equal(report.status, "provider_reads_failed");
  assert.deepEqual(
    report.checks.map((item) => item.code),
    [
      "SPONSOR_UNDERFUNDED",
      "MINT_MISMATCH",
      "VALIDATOR_MISMATCH",
      "PROVIDER_UNAVAILABLE_OR_INVALID",
    ],
  );
  assert.ok(!JSON.stringify(report).includes("TEST_ONLY_RPC_CREDENTIAL"));
});

test("base RPC must return the full Devnet genesis hash, not its CAIP prefix", async (context) => {
  stubProviders(context, (body) => {
    if (body.method === "getGenesisHash")
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: devnetGenesis.slice(0, 32),
        }),
      );
    return undefined;
  });
  const report = await runReadiness(environment);
  assert.equal(report.checks[0].code, "WRONG_NETWORK");
});

test("oversized responses are rejected before JSON parsing", async (context) => {
  stubProviders(context, () => new Response(" ".repeat(256 * 1024 + 1)));
  const report = await runReadiness(environment);
  assert.equal(report.status, "provider_reads_failed");
  assert.ok(report.checks.every((item) => item.code === "RESPONSE_TOO_LARGE"));
});

test("wrong oracle owners fail even when the payload is otherwise valid", async (context) => {
  const clock = Buffer.alloc(40);
  clock.writeBigUInt64LE(123_456_790n, 0);
  clock.writeBigInt64LE(1_700_000_002n, 32);
  stubProviders(context, undefined, {
    erAccounts: [
      account(DEVNET.sysvarOwner, clock),
      account(DEVNET.program, oracle),
      account(DEVNET.oracleProgram, oracle),
      account(DEVNET.oracleProgram, oracle),
    ],
  });
  const report = await runReadiness(environment);
  assert.equal(
    report.checks.find((item) => item.name === "er_identity_and_oracles")?.code,
    "ORACLE_ACCOUNT_MISMATCH",
  );
});
