import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config, wallet } from "./fixtures";

const store = vi.hoisted(() => {
  const records = new Map<string, unknown>();
  return {
    records,
    set: vi.fn(async (key: string, value: unknown) => {
      records.set(key, value);
      return "OK";
    }),
    get: vi.fn(async (key: string) => records.get(key) ?? null),
    getdel: vi.fn(async (key: string) => {
      const value = records.get(key) ?? null;
      records.delete(key);
      return value;
    }),
    del: vi.fn(async (key: string) => records.delete(key)),
    eval: vi.fn(
      async (_script: string, keys: string[]) =>
        records.get(keys[0] ?? "") ?? null,
    ),
  };
});
const appOrigin = vi.hoisted(() => ({ value: "" }));
vi.mock("server-only", () => ({}));
vi.mock(
  "../../../../../apps/web/lib/server/runtime",
  async (importOriginal) => {
    const original =
      await importOriginal<
        typeof import("../../../../../apps/web/lib/server/runtime")
      >();
    return {
      ...original,
      runtime: () => ({
        redis: store,
        config: {
          APP_ORIGIN: config.APP_ORIGIN,
          UPSTASH_REDIS_REST_URL: config.UPSTASH_REDIS_REST_URL,
          UPSTASH_REDIS_REST_TOKEN: config.UPSTASH_REDIS_REST_TOKEN,
        },
        prefix: "test",
      }),
      serverConfig: () => ({
        APP_ORIGIN: appOrigin.value || config.APP_ORIGIN,
        UPSTASH_REDIS_REST_URL: config.UPSTASH_REDIS_REST_URL,
        UPSTASH_REDIS_REST_TOKEN: config.UPSTASH_REDIS_REST_TOKEN,
      }),
      rateLimit: vi.fn(async () => {}),
    };
  },
);

import { POST as challengeRoute } from "../../../../../apps/web/app/api/auth/challenge/route";
import { POST as verifyRoute } from "../../../../../apps/web/app/api/auth/verify/route";
import {
  authenticate,
  challengeInput,
  createChallenge,
  logout,
  verifyChallenge,
  verifyWalletSignature,
} from "../../../../../apps/web/lib/server/auth";
import {
  assertOrigin,
  body,
  cookie,
  json,
  route,
  sessionToken,
} from "../../../../../apps/web/lib/server/http";

const request = (path: string, value: unknown, origin = config.APP_ORIGIN) =>
  new Request(`${config.APP_ORIGIN}${path}`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
beforeEach(() => {
  store.records.clear();
  vi.clearAllMocks();
});
afterEach(() => vi.restoreAllMocks());
describe("wallet authentication", () => {
  it("accepts only the configured exact origin, independent of spoofed host or referrer headers", () => {
    expect(() =>
      assertOrigin(request("/api/auth/challenge", {})),
    ).not.toThrow();
    for (const headers of [
      { Origin: config.APP_ORIGIN, "Sec-Fetch-Site": "cross-site" },
      {
        Referer: config.APP_ORIGIN,
        "X-Forwarded-Host": new URL(config.APP_ORIGIN).host,
      },
      {
        Origin: "https://attacker.example",
        Host: new URL(config.APP_ORIGIN).host,
        "X-Forwarded-Host": new URL(config.APP_ORIGIN).host,
      },
      { Origin: `${config.APP_ORIGIN}.attacker.example` },
    ])
      expect(() =>
        assertOrigin(
          new Request(config.APP_ORIGIN, { method: "POST", headers }),
        ),
      ).toThrow("ORIGIN_REJECTED");
  });
  it("uses real Ed25519 verification and binds the challenge to wallet, domain, chain and expiry", async () => {
    const w = wallet();
    const c = await createChallenge(w.address);
    expect(c.message).toContain(`URI: ${config.APP_ORIGIN}`);
    expect(c.message).toContain("Chain ID: solana:devnet");
    expect(store.set).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ wallet: w.address }),
      { ex: 300, nx: true },
    );
    const signature = w.sign(new TextEncoder().encode(c.message));
    expect(
      verifyWalletSignature(
        w.address,
        new TextEncoder().encode(c.message),
        signature,
      ),
    ).toBe(true);
    const result = await verifyChallenge(
      c.challengeId,
      signature.toString("base64"),
    );
    expect(result.session.wallet).toBe(w.address);
    expect(result.token).toHaveLength(43);
    expect(
      [...store.records.keys()].some((key) => key.includes(result.token)),
    ).toBe(false);
    expect((await authenticate(result.token)).wallet).toBe(w.address);
    await logout(result.token);
    await expect(authenticate(result.token)).rejects.toThrow("AUTH_REQUIRED");
  });
  it("does not consume a valid challenge when an invalid signature is submitted", async () => {
    const w = wallet();
    const c = await createChallenge(w.address);
    await expect(
      verifyChallenge(c.challengeId, Buffer.alloc(64).toString("base64")),
    ).rejects.toThrow("INVALID_SIGNATURE");
    const signature = w.sign(new TextEncoder().encode(c.message));
    await expect(
      verifyChallenge(c.challengeId, signature.toString("base64")),
    ).resolves.toBeDefined();
  });
  it("allows exactly one concurrent verification and rejects cross-wallet signatures", async () => {
    const w = wallet();
    const c = await createChallenge(w.address);
    const data = new TextEncoder().encode(c.message);
    await expect(
      verifyChallenge(c.challengeId, wallet().sign(data).toString("base64")),
    ).rejects.toThrow("INVALID_SIGNATURE");
    const result = await Promise.allSettled([
      verifyChallenge(c.challengeId, w.sign(data).toString("base64")),
      verifyChallenge(c.challengeId, w.sign(data).toString("base64")),
    ]);
    expect(result.filter((value) => value.status === "fulfilled")).toHaveLength(
      1,
    );
  });
  it("enforces challenge and absolute session expiry even if storage returns stale data", async () => {
    const w = wallet();
    const c = await createChallenge(w.address);
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 300001);
    await expect(
      verifyChallenge(
        c.challengeId,
        w.sign(new TextEncoder().encode(c.message)).toString("base64"),
      ),
    ).rejects.toThrow("CHALLENGE_EXPIRED");
    store.eval.mockResolvedValueOnce({
      wallet: w.address,
      createdAt: now - 43200001,
      absoluteExpiresAt: now,
    });
    await expect(authenticate("a".repeat(43))).rejects.toThrow("AUTH_REQUIRED");
  });
  it("sets an opaque host-only secure HttpOnly cookie and exposes no token in JSON", async () => {
    const w = wallet();
    const first = await challengeRoute(
      request("/api/auth/challenge", { wallet: w.address }),
    );
    const c = await first.json();
    const response = await verifyRoute(
      request("/api/auth/verify", {
        challengeId: c.challengeId,
        signature: w
          .sign(new TextEncoder().encode(c.message))
          .toString("base64"),
      }),
    );
    expect(response.status).toBe(200);
    const set = response.headers.get("Set-Cookie") ?? "";
    expect(set).toContain("__Host-purrps-session=");
    expect(set).toContain("HttpOnly; Secure; SameSite=Strict");
    expect(set).not.toContain("Domain=");
    expect(await response.json()).not.toHaveProperty("token");
    expect(response.headers.get("Cache-Control")).toContain("no-store");
  });
  it("uses a non-Secure unprefixed cookie only for a loopback http origin", () => {
    appOrigin.value = "http://localhost:3000";
    try {
      const set = cookie("a".repeat(43));
      expect(set).toMatch(
        /^purrps-session=a{43}; Path=\/; HttpOnly; SameSite=Strict/,
      );
      expect(set).not.toContain("Secure");
      expect(
        sessionToken(
          new Request("http://localhost:3000", {
            headers: { Cookie: `purrps-session=${"a".repeat(43)}` },
          }),
        ),
      ).toBe("a".repeat(43));
    } finally {
      appOrigin.value = "";
    }
    expect(cookie("a".repeat(43))).toMatch(/^__Host-purrps-session=.*Secure/);
  });
  it("rejects foreign origins, forged progress, oversized bodies and duplicate cookies", async () => {
    const w = wallet();
    expect(
      (
        await challengeRoute(
          request(
            "/api/auth/challenge",
            { wallet: w.address },
            "https://attacker.example",
          ),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await challengeRoute(
          request("/api/auth/challenge", { wallet: w.address, score: 100 }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await challengeRoute(
          request("/api/auth/challenge", { wallet: "x".repeat(5000) }),
        )
      ).status,
    ).toBe(413);
    expect(() => assertOrigin(request("/", {}, "null"))).toThrow(
      "ORIGIN_REJECTED",
    );
    expect(() =>
      sessionToken(
        new Request(config.APP_ORIGIN, {
          headers: {
            Cookie: `${cookie("a".repeat(43)).split(";")[0]}; __Host-purrps-session=${"b".repeat(43)}`,
          },
        }),
      ),
    ).toThrow();
    await expect(
      body(
        new Request(config.APP_ORIGIN, { method: "POST", body: "{}" }),
        challengeInput,
      ),
    ).rejects.toThrow("JSON_REQUIRED");
    const failure = await route("auth.verify", async () => {
      throw new Error("secret provider URL");
    });
    expect(await failure.json()).toEqual({ error: "SERVICE_UNAVAILABLE" });
    expect(json({ ok: true }).headers.get("Cache-Control")).toContain(
      "no-store",
    );
  });
});
