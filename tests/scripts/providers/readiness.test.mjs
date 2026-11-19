import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  DEVNET,
  oracleAddress,
} from "../../../apps/web/lib/solana/addresses.ts";
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

function providerResponse(method, host, overrides, params) {
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
    if (params[1].dataSlice !== undefined) {
      return {
        context: { slot: 123_456_790 },
        value: [
          account(DEVNET.sysvarOwner, clock),
          overrides.hydraMissing
            ? null
            : account(
                "LoaderV411111111111111111111111111111111111",
                Buffer.alloc(40),
                true,
              ),
        ],
      };
    }
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
  class Socket extends EventTarget {
    constructor() {
      super();
      queueMicrotask(() => this.dispatchEvent(new Event("open")));
    }
    send(data) {
      const request = JSON.parse(data);
      const emit = (payload) =>
        queueMicrotask(() =>
          this.dispatchEvent(
            new MessageEvent("message", { data: JSON.stringify(payload) }),
          ),
        );
      if (request.method === "accountSubscribe") {
        assert.equal(request.params[0], oracleAddress(1));
        emit({ jsonrpc: "2.0", id: 1, result: 7 });
        emit(
          overrides.streamMessage ?? {
            jsonrpc: "2.0",
            method: "accountNotification",
            params: {
              subscription: 7,
              result: {
                context: { slot: 123_456_790 },
                value: account(DEVNET.oracleProgram, oracle),
              },
            },
          },
        );
      } else {
        assert.equal(request.method, "accountUnsubscribe");
        assert.deepEqual(request.params, [7]);
        emit({ jsonrpc: "2.0", id: 2, result: true });
      }
    }
    close() {}
  }
  context.mock.method(globalThis, "WebSocket", function WebSocketFixture(url) {
    assert.equal(url, environment.MAGICBLOCK_ER_WS_URL);
    return new Socket();
  });
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
            body.params,
          ),
        };
    return new Response(JSON.stringify(payload));
  });
  return requests;
}

test("readiness checks the deployed scheduler without passing the integration gate", async (context) => {
  const requests = stubProviders(context);
  const report = await runReadiness(environment);
  assert.equal(report.status, "provider_reads_passed");
  assert.equal(report.integrationGate, "not_built");
  assert.equal(report.checks.length, 6);
  assert.equal(requests.length, 8);
  assert.deepEqual(
    report.checks.find(({ name }) => name === "er_hydra_and_clock"),
    {
      name: "er_hydra_and_clock",
      status: "passed",
      observed: { clockSlot: "123456790", clockUnixSeconds: "1700000002" },
    },
  );
  assert.ok(report.unmeasured.includes("ER_authenticated_subsecond_timing"));
  assert.deepEqual(report.remainingBuildTasks, [
    "er_runner_delegation_crank_liveness",
    "commit_completion",
  ]);
  assert.ok(report.liveChecksOutsideProbe.includes("starter_vrf_fulfillment"));
  assert.ok(
    report.liveChecksOutsideProbe.includes("web_sessions_nonce_atomicity"),
  );
  const json = JSON.stringify(report);
  assert.ok(!json.includes(environment.UPSTASH_REDIS_REST_TOKEN));
  assert.ok(!json.includes(environment.HELIUS_DEVNET_RPC_URL));
});

test("missing ER Hydra fails the scheduler check", async (context) => {
  stubProviders(context, undefined, { hydraMissing: true });
  const report = await runReadiness(environment);
  assert.equal(report.status, "provider_reads_failed");
  assert.deepEqual(
    report.checks.find(({ name }) => name === "er_hydra_and_clock"),
    {
      name: "er_hydra_and_clock",
      status: "failed",
      code: "ER_HYDRA_UNAVAILABLE",
    },
  );
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
      undefined,
      undefined,
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
  assert.ok(
    report.checks
      .filter((item) => item.name !== "er_websocket_delivery")
      .every((item) => item.code === "RESPONSE_TOO_LARGE"),
  );
});

test("websocket delivery rejects spoofed accounts and subscription identities", async (context) => {
  stubProviders(context, undefined, {
    streamMessage: {
      jsonrpc: "2.0",
      method: "accountNotification",
      params: {
        subscription: 7,
        result: {
          context: { slot: 123_456_790 },
          value: account(DEVNET.program, oracle),
        },
      },
    },
  });
  const report = await runReadiness(environment);
  assert.equal(
    report.checks.find((item) => item.name === "er_websocket_delivery")?.code,
    "ORACLE_ACCOUNT_MISMATCH",
  );
});

test("websocket malformed responses fail without leaking provider content", async (context) => {
  stubProviders(context, undefined, {
    streamMessage: {
      jsonrpc: "2.0",
      id: 99,
      error: { message: environment.UPSTASH_REDIS_REST_TOKEN },
    },
  });
  const report = await runReadiness(environment);
  assert.equal(
    report.checks.find((item) => item.name === "er_websocket_delivery")?.code,
    "WEBSOCKET_RESPONSE_INVALID",
  );
  assert.ok(
    !JSON.stringify(report).includes(environment.UPSTASH_REDIS_REST_TOKEN),
  );
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
