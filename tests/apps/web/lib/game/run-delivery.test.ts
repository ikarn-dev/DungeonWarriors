import { readFileSync } from "node:fs";
import { type AccountInfo, type Connection, PublicKey } from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";
import { Predictor } from "../../../../../apps/web/lib/game/predictor";
import {
  decodeEscrowAccount,
  decodeRunAccount,
  runAddresses,
} from "../../../../../apps/web/lib/game/run-accounts";
import {
  RunState,
  subscribeRun,
} from "../../../../../apps/web/lib/game/run-feed";
import {
  ENTITY_VECTOR_OFFSET,
  guardRunLayout,
} from "../../../../../apps/web/lib/game/run-layout";
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
