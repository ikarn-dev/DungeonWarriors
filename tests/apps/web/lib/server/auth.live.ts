import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { POST as challengeRoute } from "../../../../../apps/web/app/api/auth/challenge/route";
import { POST as logoutRoute } from "../../../../../apps/web/app/api/auth/logout/route";
import { GET as sessionRoute } from "../../../../../apps/web/app/api/auth/session/route";
import { POST as verifyRoute } from "../../../../../apps/web/app/api/auth/verify/route";
import {
  authenticate,
  createChallenge,
  logout,
  verifyChallenge,
} from "../../../../../apps/web/lib/server/auth";
import {
  digest,
  rateLimit,
  runtime,
} from "../../../../../apps/web/lib/server/runtime";
import { environment, wallet } from "./fixtures";

beforeAll(() => {
  const authNames = new Set([
    "APP_ORIGIN",
    "UPSTASH_REDIS_REST_URL",
    "UPSTASH_REDIS_REST_TOKEN",
  ]);
  for (const name of [
    ...Object.keys(environment),
    "SPONSOR_SECRET_KEY",
    "SPONSOR_HOURLY_BUDGET_LAMPORTS",
  ])
    if (!authNames.has(name)) vi.stubEnv(name, undefined);
});
afterAll(() => vi.unstubAllEnvs());

describe("configured Upstash authentication integration", () => {
  it("completes the actual auth routes with only origin and Redis, and preserves exact-origin and secure-cookie checks", async () => {
    const w = wallet();
    const origin = runtime().config.APP_ORIGIN;
    const request = (
      path: string,
      value: unknown,
      sessionCookie?: string,
      requestOrigin = origin,
    ) =>
      new Request(`${origin}${path}`, {
        method: "POST",
        headers: {
          Origin: requestOrigin,
          "Content-Type": "application/json",
          ...(sessionCookie === undefined ? {} : { Cookie: sessionCookie }),
        },
        body: JSON.stringify(value),
      });
    let token: string | undefined;
    try {
      expect(
        (
          await challengeRoute(
            request(
              "/api/auth/challenge",
              { wallet: w.address },
              undefined,
              "https://other.example",
            ),
          )
        ).status,
      ).toBe(403);
      const challengeResponse = await challengeRoute(
        request("/api/auth/challenge", { wallet: w.address }),
      );
      expect(challengeResponse.status).toBe(200);
      const c = await challengeResponse.json();
      const input = {
        challengeId: c.challengeId,
        signature: w
          .sign(new TextEncoder().encode(c.message))
          .toString("base64"),
      };
      const verified = await verifyRoute(request("/api/auth/verify", input));
      expect(verified.status).toBe(200);
      const header = verified.headers.get("set-cookie") ?? "";
      const sessionCookie = header.split(";")[0] ?? "";
      token = sessionCookie.split("=")[1];
      expect(
        /^__Host-purrps-session=[A-Za-z0-9_-]{43}$/.test(sessionCookie),
      ).toBe(true);
      expect(
        [
          "Path=/",
          "HttpOnly",
          "Secure",
          "SameSite=Strict",
          "Max-Age=43200",
        ].every((flag) => header.includes(flag)),
      ).toBe(true);
      const session = await sessionRoute(
        new Request(`${origin}/api/auth/session`, {
          headers: { Cookie: sessionCookie },
        }),
      );
      expect(session.status).toBe(200);
      expect((await session.json()).wallet).toBe(w.address);
      expect(
        (await verifyRoute(request("/api/auth/verify", input))).status,
      ).toBe(401);
      expect(
        (await logoutRoute(request("/api/auth/logout", {}, sessionCookie)))
          .status,
      ).toBe(200);
      const signedOut = await sessionRoute(
        new Request(`${origin}/api/auth/session`, {
          headers: { Cookie: sessionCookie },
        }),
      );
      expect(signedOut.status).toBe(200);
      expect(await signedOut.json()).toBeNull();
    } catch {
      throw new Error("LIVE_AUTH_ROUTES_CHECK_FAILED");
    } finally {
      if (token !== undefined)
        await logout(token).catch(() => {
          throw new Error("LIVE_AUTH_ROUTES_CLEANUP_FAILED");
        });
    }
  });
  it("consumes a challenge once under concurrent verification and enforces real idle/absolute expiry", async () => {
    let stage = "challenge";
    const w = wallet();
    const tokens: string[] = [];
    let challengeId: string | undefined;
    try {
      const c = await createChallenge(w.address);
      challengeId = c.challengeId;
      const signature = w
        .sign(new TextEncoder().encode(c.message))
        .toString("base64");
      stage = "concurrent-consume";
      const results = await Promise.allSettled([
        verifyChallenge(c.challengeId, signature),
        verifyChallenge(c.challengeId, signature),
      ]);
      const successful = results.filter(
        (value) => value.status === "fulfilled",
      );
      expect(successful).toHaveLength(1);
      const result = successful[0];
      if (result?.status !== "fulfilled") throw new Error("consume");
      tokens.push(result.value.token);
      stage = "session";
      expect((await authenticate(result.value.token)).wallet).toBe(w.address);
      const r = runtime();
      const key = `${r.prefix}:session:${digest(result.value.token)}`;
      const ttl = await r.redis.ttl(key);
      expect(ttl).toBeGreaterThan(1700);
      expect(ttl).toBeLessThanOrEqual(1800);
      stage = "absolute-expiry";
      await r.redis.set(
        key,
        { ...result.value.session, absoluteExpiresAt: Date.now() - 1 },
        { ex: 30 },
      );
      await expect(authenticate(result.value.token)).rejects.toThrow(
        "AUTH_REQUIRED",
      );
      expect(await r.redis.exists(key)).toBe(0);
      const next = await createChallenge(w.address);
      challengeId = next.challengeId;
      const second = await verifyChallenge(
        next.challengeId,
        w.sign(new TextEncoder().encode(next.message)).toString("base64"),
      );
      tokens.push(second.token);
      stage = "idle-expiry";
      await r.redis.expire(`${r.prefix}:session:${digest(second.token)}`, 1);
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await expect(authenticate(second.token)).rejects.toThrow("AUTH_REQUIRED");
    } catch {
      throw new Error(`LIVE_AUTH_CHECK_FAILED_AT_${stage}`);
    } finally {
      for (const token of tokens) await logout(token);
      if (challengeId !== undefined) {
        const r = runtime();
        await r.redis.del(`${r.prefix}:challenge:${challengeId}`);
      }
    }
  });
  it("enforces the configured distributed IP rate limit", async () => {
    const operation = `cli-check-${Date.now()}`;
    try {
      for (let i = 0; i < 20; i++)
        await rateLimit(operation, "integration-test");
      await expect(rateLimit(operation, "integration-test")).rejects.toThrow(
        "RATE_LIMITED",
      );
    } catch {
      throw new Error("LIVE_RATE_LIMIT_CHECK_FAILED");
    }
  });
});
