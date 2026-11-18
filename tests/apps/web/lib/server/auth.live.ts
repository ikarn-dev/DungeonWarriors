import { describe, expect, it } from "vitest";
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
import { wallet } from "./fixtures";

describe("configured Upstash authentication integration", () => {
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
