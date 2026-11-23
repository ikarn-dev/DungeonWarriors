import { readFileSync } from "node:fs";
import {
  type AccountInfo,
  type Connection,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";
import { Predictor } from "../../../../../apps/web/lib/game/predictor";
import {
  decodeEscrowAccount,
  decodeRunAccount,
  runAddresses,
} from "../../../../../apps/web/lib/game/run-accounts";
import {
  confirmGameAction,
  prepareSponsoredPlay,
  submitSponsoredPlay,
} from "../../../../../apps/web/lib/game/run-client";
import {
  RunState,
  subscribeRun,
} from "../../../../../apps/web/lib/game/run-feed";
import {
  ENTITY_VECTOR_OFFSET,
  guardRunLayout,
} from "../../../../../apps/web/lib/game/run-layout";
import {
  formatRunPrice,
  mergeRunPrices,
  runPricePath,
} from "../../../../../apps/web/lib/game/run-price";
import {
  type GameIntent,
  gameInstructions,
  gameIntentSchema,
} from "../../../../../apps/web/lib/game/run-transactions";
import { DEVNET } from "../../../../../apps/web/lib/solana/addresses.ts";

const identity = {
  owner: new PublicKey(new Uint8Array(32).fill(1)).toBase58(),
  nonce: 1n,
};
const address = runAddresses(identity);
function info(name: string): AccountInfo<Buffer> {
  const bytes = readFileSync(
    new URL(`../../../../fixtures/run-delivery/${name}.hex`, import.meta.url),
    "utf8",
  ).trim();
  return {
    owner: new PublicKey(DEVNET.program),
    data: Buffer.from(bytes, "hex"),
    lamports: 1,
    executable: false,
    rentEpoch: 0,
  };
}
const run = (name = "active") =>
  decodeRunAccount(identity, address.run[0], info(name));
const escrow = (name = "reserved") =>
  decodeEscrowAccount(identity, address.escrow[0], info(name));

it("sends a valid settlement intent when live run state includes a sponsor retry limit", async () => {
  const liveSponsor = {
    sponsor: new PublicKey(new Uint8Array(32).fill(2)).toBase58(),
    floor: "250000000",
    maxAttempts: 3,
  };
  const intent = {
    operation: "game",
    sponsored: false,
    playSponsor: liveSponsor,
    action: { kind: "requestCompletion", nonce: "1", market: "BTC" },
  } satisfies GameIntent;
  const { payer, instructions, operationId } = gameInstructions(
    identity.owner,
    intent,
  );
  const blockhash = PublicKey.default.toBase58();
  const tx = new VersionedTransaction(
    new TransactionMessage({
      payerKey: payer,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message(),
  );
  const transaction = Buffer.from(tx.serialize()).toString("base64");
  const prepared = {
    transaction,
    blockhash,
    operationId,
    network: "er",
    lastValidBlockHeight: 123,
  };
  const submitted = { signature: "2".repeat(87), network: "er" };
  const fetchTx = vi.fn((url: string, request: RequestInit) => {
    const payload = JSON.parse(String(request.body));
    const value = gameIntentSchema.parse(
      url === "/api/tx/prepare" ? payload : payload.intent,
    );
    expect(value.playSponsor).toEqual({
      sponsor: liveSponsor.sponsor,
      floor: liveSponsor.floor,
    });
    return Promise.resolve(
      Response.json(url === "/api/tx/prepare" ? prepared : submitted),
    );
  });
  vi.stubGlobal("fetch", fetchTx);
  try {
    const { signal } = new AbortController();
    const pending = await prepareSponsoredPlay(identity.owner, intent, signal);
    await expect(submitSponsoredPlay(pending, signal)).resolves.toMatchObject(
      submitted,
    );
    expect(fetchTx.mock.calls.map(([url]) => url)).toEqual([
      "/api/tx/prepare",
      "/api/tx/submit",
    ]);
  } finally {
    vi.unstubAllGlobals();
  }
});

it("keeps checking the original bet signature when base finality is slow", async () => {
  const pending = {
    signature: "2".repeat(87),
    network: "base",
    lastValidBlockHeight: 123,
  } as const;
  let reads = 0;
  const fetchStatus = vi.fn((_url: string, _request: RequestInit) =>
    Promise.resolve(
      Response.json({
        status:
          ++reads === 7 ? { confirmationStatus: "finalized", err: null } : null,
        resolution: "pending",
      }),
    ),
  );
  vi.useFakeTimers();
  vi.stubGlobal("fetch", fetchStatus);
  try {
    const result = confirmGameAction(pending, new AbortController().signal, 18);
    await vi.runAllTimersAsync();
    await expect(result).resolves.toBe("confirmed");
    expect(fetchStatus).toHaveBeenCalledTimes(7);
    for (const [url, request] of fetchStatus.mock.calls) {
      expect(url).toBe("/api/tx/status");
      expect(request.body).toBe(JSON.stringify(pending));
    }
  } finally {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
});

it("advances play-key approval at confirmed but keeps finalized as the base default", async () => {
  const request = {
    signature: "2".repeat(87),
    network: "base",
    lastValidBlockHeight: 123,
  } as const;
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        Response.json({
          status: { confirmationStatus: "confirmed", err: null },
          resolution: "pending",
        }),
      ),
    ),
  );
  try {
    const { signal } = new AbortController();
    await expect(
      confirmGameAction(request, signal, 1, "confirmed"),
    ).resolves.toBe("confirmed");
    await expect(confirmGameAction(request, signal, 1)).resolves.toBe(
      "pending",
    );
  } finally {
    vi.unstubAllGlobals();
  }
});

it("distinguishes an expired signature from a finalized transaction failure", async () => {
  const pending = {
    signature: "2".repeat(87),
    network: "base",
    lastValidBlockHeight: 123,
  } as const;
  const fetchStatus = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({ status: null, resolution: "expired" }),
    )
    .mockResolvedValueOnce(
      Response.json({
        status: {
          confirmationStatus: "finalized",
          err: { InstructionError: [0, "Custom"] },
        },
        resolution: "failed",
      }),
    );
  vi.stubGlobal("fetch", fetchStatus);
  try {
    const { signal } = new AbortController();
    await expect(confirmGameAction(pending, signal, 1)).resolves.toBe(
      "expired",
    );
    await expect(confirmGameAction(pending, signal, 1)).resolves.toBe("failed");
  } finally {
    vi.unstubAllGlobals();
  }
});

it("plots only consumed price observations, retaining precision and showing gaps", () => {
  const start = { sequence: 1n, price: 20_000_123n, exponent: -6 };
  const later = { ...start, sequence: 2n, price: 20_010_123n };
  const afterGap = { ...start, sequence: 5n, price: 20_020_123n };
  const series = mergeRunPrices([start], [start, later, afterGap]);
  expect(series).toEqual([start, later, afterGap]);
  expect(runPricePath(series)).toBe("M2 34 L41 18 M158 2");
  expect(formatRunPrice(start)).toBe("20.000123");
  const live = { sequence: 1n, price: 6_062_100_350_011n, exponent: 8 };
  expect(formatRunPrice(live)).toBe("60,621.00350011");
  expect(formatRunPrice(live, true)).toBe("60,621.00");
});

describe("Rust account delivery", () => {
  it("decodes real Rust Borsh/IDL bytes into the predictor without losing precision", async () => {
    const r = await run();
    expect(r.observation.activeTicks).toBe(0n);
    expect(r.prediction).not.toBeNull();
    const predictor = new Predictor(r.prediction, r.stats);
    expect(predictor).toBeDefined();
    expect(r.prediction?.entities.some((e) => e.kind === "ramp")).toBe(true);
    expect((await escrow()).snapshotHash).toBe(r.snapshotHash);
  });
  it("keeps preactivation and technical abort before activation renderable", async () => {
    expect((await run("ready")).prediction).toBeNull();
    const r = await run("terminal");
    expect(r.observation.terminalReason).toBe("technicalAbort");
    expect(r.prediction).toBeNull();
  });
  it("rejects owner, address, discriminator, frozen snapshot and unsupported schema mutations", async () => {
    for (const offset of [0, 8, 43, 736]) {
      const i = info("active");
      i.data[offset] = (i.data[offset] ?? 0) ^ 1;
      await expect(
        decodeRunAccount(identity, address.run[0], i),
      ).rejects.toThrow();
    }
    await expect(
      decodeRunAccount(identity, address.escrow[0], info("active")),
    ).rejects.toThrow();
    await expect(
      decodeRunAccount(identity, address.run[0], {
        ...info("active"),
        owner: PublicKey.default,
      }),
    ).rejects.toThrow();
    await expect(
      decodeEscrowAccount(
        { ...identity, nonce: 2n },
        address.escrow[0],
        info("reserved"),
      ),
    ).rejects.toThrow();
  });
  it("rejects malicious vector prefixes before the generated Borsh decoder allocates", () => {
    for (const n of [0, 63, 65, 0xffffffff]) {
      const i = info("active");
      i.data.writeUInt32LE(n, ENTITY_VECTOR_OFFSET);
      expect(() => guardRunLayout(i.data)).toThrow();
    }
    const good = info("active").data;
    for (const n of [0, 830, 1000, 2000])
      expect(() => guardRunLayout(good.subarray(0, n))).toThrow();
    expect(() => guardRunLayout(Buffer.alloc(10241))).toThrow();
  });
  it("requires finalized base escrow for settled/refunded and refuses regressions", async () => {
    const s = new RunState();
    s.requested(1n);
    expect(s.view().status).toBe("activating");
    s.applyRun(5, await run());
    expect(s.view().status).toBe("requested");
    s.applyFinalizedEscrow(6, await escrow());
    expect(s.view().status).toBe("requested");
    const terminal = await run("terminal");
    s.applyRun(7, terminal);
    expect(s.view().status).toBe("settling");
    expect(() =>
      s.applyRun(8, {
        ...terminal,
        observation: {
          ...terminal.observation,
          terminalReason: null,
          phase: "active",
        },
      }),
    ).toThrow("RUN_REGRESSION");
    s.applyFinalizedEscrow(8, await escrow("refunded"));
    expect(s.view().status).toBe("refunded");
    const reserved = await escrow();
    expect(() => s.applyFinalizedEscrow(9, reserved)).toThrow(
      "ESCROW_CONFLICT",
    );
    s.applyRun(1, await run());
    expect(s.view().status).toBe("refunded");
    const copy = s.view();
    copy.status = "active";
    expect(s.view().status).toBe("refunded");
  });
  it("pins subscriptions to separate ER and finalized base reads and cleans up", async () => {
    const commitments: string[] = [];
    const removed: number[] = [];
    const connection = (name: string) =>
      ({
        onAccountChange: (
          _key: PublicKey,
          _fn: unknown,
          commitment: string,
        ) => {
          commitments.push(commitment);
          return name === "active" ? 1 : 2;
        },
        getAccountInfoAndContext: async () => ({
          context: { slot: 1 },
          value: info(name),
        }),
        removeAccountChangeListener: async (id: number) => {
          removed.push(id);
        },
      }) as unknown as Connection;
    const views: string[] = [];
    const feed = await subscribeRun(
      identity,
      connection("active"),
      connection("reserved"),
      (v) => views.push(v.status),
    );
    expect(commitments).toEqual(["confirmed", "finalized"]);
    expect(views.at(-1)).toBe("active");
    await feed.close();
    expect(removed.sort()).toEqual([1, 2]);
  });
  it("cleans up both listeners after an initial RPC failure", async () => {
    let removed = 0;
    const connection = {
      onAccountChange: () => 1,
      getAccountInfoAndContext: async () => {
        throw new Error("RPC_DOWN");
      },
      removeAccountChangeListener: async () => {
        removed++;
      },
    } as unknown as Connection;
    await expect(
      subscribeRun(identity, connection, connection, () => {}),
    ).rejects.toThrow("SUBSCRIPTION_FAILED");
    expect(removed).toBe(2);
  });
  it("bounds stalled initial reads and releases subscriptions", async () => {
    vi.useFakeTimers();
    let removed = 0;
    try {
      const connection = {
        onAccountChange: () => 1,
        getAccountInfoAndContext: () => new Promise(() => {}),
        removeAccountChangeListener: async () => {
          removed++;
        },
      } as unknown as Connection;
      const failure = expect(
        subscribeRun(identity, connection, connection, () => {}),
      ).rejects.toThrow("SUBSCRIPTION_FAILED");
      await vi.advanceTimersByTimeAsync(5001);
      await failure;
      expect(removed).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
