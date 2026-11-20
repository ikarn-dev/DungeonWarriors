import {
  flush,
  initWithoutDefaultIntegrations,
  metrics,
  setUser,
} from "@sentry/nextjs";
import { expect, it, vi } from "vitest";
import {
  observeSponsorReservation,
  observeTransactionStatus,
  providerFetch,
  telemetryOptions,
} from "../../../../../apps/web/lib/server/telemetry";

it("exports only approved metrics and drops sensitive dimensions from SDK envelopes", async () => {
  const envelopes: string[] = [];
  const client = initWithoutDefaultIntegrations({
    ...telemetryOptions,
    dsn: "https://test@o0.ingest.sentry.io/1",
    transport: () => ({
      send: async (envelope) => {
        envelopes.push(JSON.stringify(envelope));
        return { statusCode: 200 };
      },
      flush: async () => true,
    }),
  });
  setUser({ id: "private-wallet" });
  const rpc = vi
    .fn()
    .mockResolvedValueOnce(new Response(null, { status: 429 }))
    .mockRejectedValueOnce(new Error("private-provider-error"));
  vi.stubGlobal("fetch", rpc);
  try {
    const fetchRpc = providerFetch("magicblock");
    expect(
      (await fetchRpc("https://example.invalid/?secret=private-token")).status,
    ).toBe(429);
    await expect(fetchRpc("https://example.invalid")).rejects.toThrow(
      "private-provider-error",
    );
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({ redirect: "error" });
    observeTransactionStatus("er", "pending");
    observeSponsorReservation(5000n);
    metrics.count("unapproved.metric", 1);
    metrics.count("purrps.transaction.status", 1, {
      attributes: { operation: "private-operation", outcome: "pending" },
    });
    metrics.count("purrps.transaction.status", 1, {
      attributes: {
        operation: "base",
        outcome: "finalized",
        secret: "private-header",
      },
    });
    expect(await flush(1000)).toBe(true);
    const wire = envelopes.join("\n");
    expect(wire).toContain("purrps.duration");
    expect(wire).toContain("limited");
    expect(wire).toContain("unavailable");
    expect(wire).toContain("purrps.sponsor.budget_reserved");
    expect(wire).toContain("purrps.transaction.status");
    expect(wire).toContain("finalized");
    expect(wire).not.toMatch(/private-|unapproved\.metric/);
  } finally {
    vi.unstubAllGlobals();
    setUser(null);
    await client?.close(1000);
  }
});
