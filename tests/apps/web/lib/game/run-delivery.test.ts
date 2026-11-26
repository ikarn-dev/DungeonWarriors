import { readFileSync } from "node:fs";
import {
  type AccountInfo,
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
  ENTITY_VECTOR_OFFSET,
  guardRunLayout,
} from "../../../../../apps/web/lib/game/run-layout";
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
});
