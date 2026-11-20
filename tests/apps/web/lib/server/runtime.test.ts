import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { route } from "../../../../../apps/web/lib/server/http";
import {
  assertAdmission,
  baseRpcConfig,
  serverConfig,
  sponsorshipConfig,
} from "../../../../../apps/web/lib/server/runtime";
import { checkedConnection } from "../../../../../apps/web/lib/server/transaction-network";
import { environment } from "./fixtures";

it("fails closed when the SDK timeout response is marked successful", () => {
  expect(() => assertAdmission([{ success: true, reason: "timeout" }])).toThrow(
    "LIMITER_UNAVAILABLE",
  );
});
it("rejects any exceeded distributed quota", () => {
  expect(() =>
    assertAdmission([{ success: true }, { success: false }]),
  ).toThrow("RATE_LIMITED");
});
it("admits only successful quota responses", () => {
  expect(() =>
    assertAdmission([{ success: true }, { success: true }]),
  ).not.toThrow();
});

describe("configuration by API capability", () => {
  beforeEach(() => {
    for (const name of Object.keys(environment)) vi.stubEnv(name, undefined);
    vi.stubEnv("APP_ORIGIN", environment.APP_ORIGIN);
    vi.stubEnv("UPSTASH_REDIS_REST_URL", environment.UPSTASH_REDIS_REST_URL);
    vi.stubEnv(
      "UPSTASH_REDIS_REST_TOKEN",
      environment.UPSTASH_REDIS_REST_TOKEN,
    );
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  it("allows auth with only origin and Redis configured while unused providers are absent", () => {
    expect(serverConfig()).toEqual({
      APP_ORIGIN: environment.APP_ORIGIN,
      UPSTASH_REDIS_REST_URL: environment.UPSTASH_REDIS_REST_URL,
      UPSTASH_REDIS_REST_TOKEN: environment.UPSTASH_REDIS_REST_TOKEN,
    });
    expect(() => baseRpcConfig()).toThrow("SERVICE_NOT_CONFIGURED");
    expect(() => sponsorshipConfig()).toThrow("SERVICE_NOT_CONFIGURED");
  });
  it("validates base RPC without requiring ER, oracle or sponsor settings", () => {
    vi.stubEnv("HELIUS_DEVNET_RPC_URL", environment.HELIUS_DEVNET_RPC_URL);
    expect(baseRpcConfig().HELIUS_DEVNET_RPC_URL).toBe(
      environment.HELIUS_DEVNET_RPC_URL,
    );
    vi.stubEnv(
      "HELIUS_DEVNET_RPC_URL",
      "https://mainnet.helius-rpc.com/?api-key=secret",
    );
    expect(() => baseRpcConfig()).toThrow("SERVICE_NOT_CONFIGURED");
  });
  it("requires the configured ER host and both validator identities", async () => {
    const identity = environment.MAGICBLOCK_VALIDATOR_IDENTITY;
    const url = environment.MAGICBLOCK_ER_HTTP_URL;
    vi.stubEnv("MAGICBLOCK_VALIDATOR_IDENTITY", identity);
    vi.stubEnv("MAGICBLOCK_ER_HTTP_URL", "https://unapproved.example");
    const fetchStub = vi
      .fn()
      .mockResolvedValue(
        Response.json({ result: { identity: "different-validator" } }),
      );
    vi.stubGlobal("fetch", fetchStub);
    await expect(checkedConnection("er", identity)).rejects.toThrow(
      "SERVICE_NOT_CONFIGURED",
    );
    vi.stubEnv("MAGICBLOCK_ER_HTTP_URL", url);
    await expect(
      checkedConnection("er", "other-run-validator"),
    ).rejects.toThrow("ER_VALIDATOR_MISMATCH");
    expect(fetchStub).not.toHaveBeenCalled();
    await expect(checkedConnection("er", identity)).rejects.toThrow(
      "ER_VALIDATOR_MISMATCH",
    );
    fetchStub.mockResolvedValue(Response.json({ result: { identity } }));
    expect((await checkedConnection("er", identity)).rpcEndpoint).toBe(url);
  });
  it("preserves sponsor reserve and balance checks in the independent policy", () => {
    for (const [name, value] of Object.entries(environment))
      if (name.startsWith("SPONSOR_")) vi.stubEnv(name, value);
    expect(sponsorshipConfig().SPONSOR_COMPLETION_RESERVE_LAMPORTS).toBe(
      50000000n,
    );
    vi.stubEnv("SPONSOR_COMPLETION_RESERVE_LAMPORTS", "100000001");
    expect(() => sponsorshipConfig()).toThrow("SERVICE_NOT_CONFIGURED");
    vi.stubEnv("SPONSOR_COMPLETION_RESERVE_LAMPORTS", "50000000");
    vi.stubEnv("SPONSOR_MIN_BALANCE_LAMPORTS", "1");
    expect(() => sponsorshipConfig()).toThrow("SERVICE_NOT_CONFIGURED");
  });
  it("exposes only invalid auth field names, never their values or parser diagnostics", async () => {
    vi.stubEnv("APP_ORIGIN", "https://secret.example/private?token=secret");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://secret.example/private");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", undefined);
    const response = await route("auth.session", async () => {
      serverConfig();
      return Response.json({});
    });
    expect(response.status).toBe(503);
    const value = await response.json();
    expect(value).toEqual({
      error: "SERVICE_NOT_CONFIGURED",
      fields: [
        "APP_ORIGIN",
        "UPSTASH_REDIS_REST_URL",
        "UPSTASH_REDIS_REST_TOKEN",
      ],
    });
    expect(JSON.stringify(value)).not.toContain("secret");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
});
