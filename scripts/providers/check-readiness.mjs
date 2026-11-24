import process from "node:process";
import { providerConfigSchema } from "../../apps/web/lib/providers/config.ts";
import {
  decodeOracleQuote,
  validateOracleQuote,
} from "../../apps/web/lib/providers/oracle.ts";
import {
  accountBytes,
  accountsSchema,
  balanceSchema,
  decodeClock,
  genesisSchema,
  identitySchema,
  pongSchema,
  rpcResult,
  validateUsdcMint,
} from "../../apps/web/lib/providers/rpc-schema.mts";
import {
  DEVNET,
  MARKETS,
  oracleAddress,
  vrfCallbackAuthority,
} from "../../apps/web/lib/solana/addresses.ts";
import { checkErStream } from "./check-er-stream.mjs";

const maxResponseBytes = 256 * 1024;
// Pinned by hydra-api 0.2.1's ephemeral namespace.
const erHydra = "eHyd5BU8QffvHi4GnXwxrK4WpS7pM2x9UGKHBWii7mf";
const erHydraLoader = "LoaderV411111111111111111111111111111111111";

// Bounded read-only requests. Never follow a redirect with private RPC/Redis
// credentials, and never return raw provider errors or endpoints in a report.
async function jsonRequest(url, body, headers = {}) {
  const response = await fetch(url, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(8_000),
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  if (!response.ok || response.body === null) {
    await response.body?.cancel();
    throw new Error(
      response.status === 429
        ? "PROVIDER_RATE_LIMITED"
        : "PROVIDER_UNAVAILABLE",
    );
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maxResponseBytes) {
        await reader.cancel();
        throw new Error("RESPONSE_TOO_LARGE");
      }
      chunks.push(decoder.decode(next.value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return JSON.parse(chunks.join(""));
  } finally {
    reader.releaseLock();
  }
}

async function rpc(url, method, params = []) {
  return rpcResult(
    await jsonRequest(url, { jsonrpc: "2.0", id: 1, method, params }),
  );
}

async function checkBase(config) {
  if (
    genesisSchema.parse(
      await rpc(config.HELIUS_DEVNET_RPC_URL, "getGenesisHash"),
    ) !== DEVNET.genesisHash
  )
    throw new Error("WRONG_NETWORK");
  const accounts = accountsSchema.parse(
    await rpc(config.HELIUS_DEVNET_RPC_URL, "getMultipleAccounts", [
      [DEVNET.usdcMint, DEVNET.vrfProgram, DEVNET.vrfQueue],
      { encoding: "base64", commitment: "finalized" },
    ]),
  );
  const [mint, vrf, queue] = accounts.value;
  if (
    accounts.value.length !== 3 ||
    mint == null ||
    vrf == null ||
    queue == null
  )
    throw new Error("MISSING_BASE_ACCOUNT");
  validateUsdcMint(mint);
  if (!vrf.executable || queue.executable || queue.owner !== DEVNET.vrfProgram)
    throw new Error("VRF_IDENTITY_MISMATCH");
  const balance = balanceSchema.parse(
    await rpc(config.HELIUS_DEVNET_RPC_URL, "getBalance", [
      config.SPONSOR_PUBLIC_KEY,
      { commitment: "finalized" },
    ]),
  );
  if (BigInt(balance.value) < config.SPONSOR_MIN_BALANCE_LAMPORTS)
    throw new Error("SPONSOR_UNDERFUNDED");
  return {
    sponsorLamports: String(balance.value),
    sponsorFloorLamports: config.SPONSOR_MIN_BALANCE_LAMPORTS.toString(),
  };
}

async function checkEr(config) {
  const identity = identitySchema.parse(
    await rpc(config.MAGICBLOCK_ER_HTTP_URL, "getIdentity"),
  );
  if (identity.identity !== config.MAGICBLOCK_VALIDATOR_IDENTITY)
    throw new Error("VALIDATOR_MISMATCH");
  const result = accountsSchema.parse(
    await rpc(config.MAGICBLOCK_ER_HTTP_URL, "getMultipleAccounts", [
      [DEVNET.clock, ...MARKETS.map(({ feedId }) => oracleAddress(feedId))],
      { encoding: "base64", commitment: "processed" },
    ]),
  );
  const clockAccount = result.value[0];
  if (result.value.length !== 4 || clockAccount == null)
    throw new Error("MISSING_ER_ACCOUNT");
  const clock = decodeClock(clockAccount);
  const oracles = [];
  for (const [index, market] of MARKETS.entries()) {
    const account = result.value[index + 1];
    if (
      account == null ||
      account.owner !== DEVNET.oracleProgram ||
      account.executable
    )
      throw new Error("ORACLE_ACCOUNT_MISMATCH");
    const quote = decodeOracleQuote(
      accountBytes(account),
      config[market.authorityEnv],
    );
    validateOracleQuote(quote, {
      nowSeconds: clock.nowSeconds,
      currentSlot: clock.slot,
      maxAgeSeconds: BigInt(config.ORACLE_MAX_AGE_SECONDS),
      maxFutureSkewSeconds: BigInt(config.ORACLE_MAX_FUTURE_SKEW_SECONDS),
      minExponent: config.ORACLE_MIN_EXPONENT,
      maxExponent: config.ORACLE_MAX_EXPONENT,
    });
    oracles.push({
      market: market.market,
      ageSeconds: Number(clock.nowSeconds - quote.publishedAtSeconds),
      postedSlot: quote.postedSlot.toString(),
    });
  }
  return { oracles };
}

async function checkErScheduler(config) {
  const result = accountsSchema.parse(
    await rpc(config.MAGICBLOCK_ER_HTTP_URL, "getMultipleAccounts", [
      [DEVNET.clock, erHydra],
      {
        encoding: "base64",
        commitment: "processed",
        dataSlice: { offset: 0, length: 40 },
      },
    ]),
  );
  const [clockAccount, hydra] = result.value;
  if (
    result.value.length !== 2 ||
    !hydra?.executable ||
    hydra.owner !== erHydraLoader
  )
    throw new Error("ER_HYDRA_UNAVAILABLE");
  if (clockAccount == null) throw new Error("CLOCK_MISMATCH");
  const { slot, nowSeconds } = decodeClock(clockAccount);
  if (slot === 0n || nowSeconds <= 0n) throw new Error("CLOCK_MISMATCH");
  return {
    clockSlot: slot.toString(),
    clockUnixSeconds: nowSeconds.toString(),
  };
}

const safeCodes = new Set([
  "WRONG_NETWORK",
  "MISSING_BASE_ACCOUNT",
  "VRF_IDENTITY_MISMATCH",
  "SPONSOR_UNDERFUNDED",
  "VALIDATOR_MISMATCH",
  "ER_HYDRA_UNAVAILABLE",
  "MISSING_ER_ACCOUNT",
  "ORACLE_ACCOUNT_MISMATCH",
  "MALFORMED_ORACLE",
  "ORACLE_AUTHORITY_MISMATCH",
  "ORACLE_STALE",
  "ORACLE_INVALID",
  "MINT_MISMATCH",
  "CLOCK_MISMATCH",
  "MALFORMED_ACCOUNT",
  "RPC_REJECTED",
  "PROVIDER_RATE_LIMITED",
  "RESPONSE_TOO_LARGE",
  "WEBSOCKET_TIMEOUT",
  "WEBSOCKET_UNAVAILABLE",
  "WEBSOCKET_RESPONSE_INVALID",
]);

export async function runReadiness(environment) {
  const parsed = providerConfigSchema.safeParse(environment);
  if (!parsed.success)
    return {
      status: "configuration_required",
      fields: [
        ...new Set(parsed.error.issues.map((issue) => String(issue.path[0]))),
      ].sort(),
      integrationGate: "requires_live_run",
    };
  const config = parsed.data;
  const checks = [
    ["base_devnet_usdc_vrf_sponsor", () => checkBase(config)],
    [
      "router_devnet",
      async () => {
        // The Router does not implement getGenesisHash; check its Devnet mint.
        const accounts = accountsSchema.parse(
          await rpc(config.MAGICBLOCK_ROUTER_HTTP_URL, "getMultipleAccounts", [
            [DEVNET.usdcMint],
            { encoding: "base64", commitment: "finalized" },
          ]),
        );
        const mint = accounts.value[0];
        if (accounts.value.length !== 1 || mint == null)
          throw new Error("MISSING_BASE_ACCOUNT");
        validateUsdcMint(mint);
      },
    ],
    ["er_identity_and_oracles", () => checkEr(config)],
    ["er_hydra_and_clock", () => checkErScheduler(config)],
    ["er_websocket_delivery", () => checkErStream(config)],
    [
      "upstash_ping",
      async () => {
        pongSchema.parse(
          await jsonRequest(config.UPSTASH_REDIS_REST_URL, ["PING"], {
            Authorization: `Bearer ${config.UPSTASH_REDIS_REST_TOKEN}`,
          }),
        );
      },
    ],
  ];
  const results = await Promise.all(
    checks.map(async ([name, check]) => {
      const started = performance.now();
      try {
        const observed = await check();
        return {
          name,
          status: "passed",
          durationMs: Math.round(performance.now() - started),
          ...(observed && { observed }),
        };
      } catch (error) {
        const code =
          error instanceof Error && safeCodes.has(error.message)
            ? error.message
            : "PROVIDER_UNAVAILABLE_OR_INVALID";
        return {
          name,
          status: "failed",
          durationMs: Math.round(performance.now() - started),
          code,
        };
      }
    }),
  );
  return {
    status: results.every((result) => result.status === "passed")
      ? "provider_reads_passed"
      : "provider_reads_failed",
    checks: results,
    vrfCallbackAuthority: vrfCallbackAuthority(DEVNET.program),
    integrationGate: "requires_live_run",
    liveChecksOutsideProbe: [
      "starter_vrf_fulfillment",
      "hosted_sponsored_transaction",
      "web_sessions_nonce_atomicity",
    ],
    unmeasured: [
      "purrps_live_crank_and_settlement_latency",
      "purrps_live_compute_fees_capacity",
    ],
  };
}

if (import.meta.main) {
  try {
    const report = await runReadiness(process.env);
    const code = report.status === "provider_reads_passed" ? 0 : 1;
    // A failed peer may never finish its close handshake; all checks are settled.
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`, () =>
      process.exit(code),
    );
  } catch {
    process.stderr.write("Provider readiness could not complete.\n");
    process.exitCode = 1;
  }
}
