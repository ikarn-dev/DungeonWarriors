import { createHash } from "node:crypto";
import { Keypair } from "@solana/web3.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DUNGEON_V3 } from "../../../../../apps/web/lib/dungeon/rules";
import { expeditionAddress } from "../../../../../apps/web/lib/dungeon/transactions";
import {
  dungeonSecret,
  dungeonTrap,
  secretCommitment,
} from "../../../../../apps/web/lib/server/dungeon-randomness";
import { exitDungeon } from "../../../../../apps/web/lib/server/dungeon-recovery";
import { updateDungeon } from "../../../../../apps/web/lib/server/dungeon-run";
import {
  type DungeonRecord,
  dungeonRecordSchema,
} from "../../../../../apps/web/lib/server/dungeon-store";
import { dungeonView } from "../../../../../apps/web/lib/server/dungeon-view";
import { client, owner, record, verifier } from "../dungeon/fixtures";

const mocks = vi.hoisted(() => ({
  stored: null as DungeonRecord | null,
  refresh: vi.fn(),
}));
vi.mock(
  "../../../../../apps/web/lib/server/dungeon-store",
  async (original) => ({
    ...(await original<
      typeof import("../../../../../apps/web/lib/server/dungeon-store")
    >()),
    activeDungeon: async () => mocks.stored?.nonce ?? null,
    withDungeon: async (
      _o: string,
      _n: string,
      work: (
        r: DungeonRecord | null,
      ) => Promise<{ record: DungeonRecord | null; value: unknown }>,
    ) => {
      const result = await work(
        mocks.stored ? structuredClone(mocks.stored) : null,
      );
      mocks.stored = result.record;
      return result.value;
    },
  }),
);
vi.mock("../../../../../apps/web/lib/server/dungeon-delivery", () => ({
  refreshDungeon: mocks.refresh,
}));
vi.mock("../../../../../apps/web/lib/server/dungeon-reservation", () => ({
  offerDungeon: vi.fn(),
  quoteDungeon: vi.fn(),
  submitDungeon: vi.fn(),
  broadcastReservation: vi.fn(),
}));
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(100000);
  vi.stubEnv(
    "BROWSER_VERIFIER_SECRET_KEY",
    Buffer.from(verifier.secretKey).toString("base64"),
  );
  mocks.stored = record();
  mocks.refresh.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
it("persists a room start, never resets its clock on retry and never reads chain while playing", async () => {
  await updateDungeon(owner, { kind: "start", nonce: "0", client, room: 0 });
  expect(mocks.stored?.room?.startedAt).toBe(100000);
  vi.setSystemTime(110000);
  await updateDungeon(owner, { kind: "start", nonce: "0", client, room: 0 });
  expect(mocks.stored?.room?.startedAt).toBe(100000);
  await updateDungeon(owner, { kind: "status", nonce: "0", client });
  expect(mocks.refresh).not.toHaveBeenCalled();
  await expect(
    updateDungeon(owner, { kind: "start", nonce: "0", client, room: 1 }),
  ).rejects.toThrow("DUNGEON_STATE_CHANGED");
});
it("leaves status reads harmless and rejects an exit from another client", async () => {
  await updateDungeon(owner, { kind: "start", nonce: "0", client, room: 0 });
  await updateDungeon(owner, { kind: "status", nonce: "0" });
  const other = "00000000-0000-4000-8000-000000000002";
  await expect(
    exitDungeon(owner, { kind: "exit", nonce: "0", client: other }),
  ).rejects.toThrow("DUNGEON_OTHER_CLIENT");
  expect(mocks.stored).toMatchObject({ phase: "playing", outcome: null });
  await exitDungeon(owner, { kind: "exit", nonce: "0", client });
  await exitDungeon(owner, { kind: "exit", nonce: "0", client });
  expect(mocks.stored).toMatchObject({
    phase: "lost",
    outcome: 1,
    payout: "0",
    reason: "abandoned",
  });
});
it("schedules a refund for an interrupted funded startup and banks cleared rooms", async () => {
  await exitDungeon(owner, { kind: "exit", nonce: "0", client });
  expect(mocks.stored).toMatchObject({
    phase: "refunded",
    outcome: 2,
    payout: "1000000",
    dueAt: 100000,
  });
  mocks.stored = {
    ...record(),
    client,
    phase: "intermission",
    cleared: 1,
    gates: [0],
  };
  await exitDungeon(owner, { kind: "exit", nonce: "0", client });
  expect(mocks.stored).toMatchObject({
    phase: "won",
    outcome: 0,
    payout: "1425000",
    dueAt: 100000,
  });
});
it("rejects teleporting to gates and future simulation before committing a choice", async () => {
  await updateDungeon(owner, { kind: "start", nonce: "0", client, room: 0 });
  await expect(
    updateDungeon(owner, {
      kind: "enter",
      nonce: "0",
      client,
      room: 0,
      gate: 0,
      through: 0,
      inputs: [],
    }),
  ).rejects.toThrow("DUNGEON_GATE_OUT_OF_RANGE");
  await expect(
    updateDungeon(owner, {
      kind: "enter",
      nonce: "0",
      client,
      room: 0,
      gate: 0,
      through: 200,
      inputs: [],
    }),
  ).rejects.toThrow("INVALID_DUNGEON_TIME");
  expect(mocks.stored?.gates).toEqual([]);
});
it("banks only accepted between-room treasure, and terminal requests are idempotent", async () => {
  mocks.stored = {
    ...record(),
    phase: "intermission",
    cleared: 1,
    gates: [0],
    payout: "1425000",
  };
  await updateDungeon(owner, { kind: "cashout", nonce: "0", client });
  expect(mocks.stored).toMatchObject({
    outcome: 0,
    payout: "1425000",
    phase: "won",
  });
  await updateDungeon(owner, { kind: "exit", nonce: "0", client });
  expect(mocks.stored?.payout).toBe("1425000");
  mocks.stored = record();
  await updateDungeon(owner, { kind: "exit", nonce: "0", client });
  expect(mocks.stored).toMatchObject({ outcome: 2, payout: "1000000" });
});
it("locks a gate across duplicate requests and rejects changing an accepted gate", async () => {
  mocks.stored = {
    ...record(),
    phase: "intermission",
    cleared: 1,
    gates: [0],
    payout: "1425000",
  };
  await updateDungeon(owner, {
    kind: "enter",
    nonce: "0",
    client,
    room: 0,
    gate: 0,
    through: 100,
    inputs: [],
  });
  await expect(
    updateDungeon(owner, {
      kind: "enter",
      nonce: "0",
      client,
      room: 0,
      gate: 1,
      through: 100,
      inputs: [],
    }),
  ).rejects.toThrow("DUNGEON_STATE_CHANGED");
  expect(mocks.stored?.gates).toEqual([0]);
});
it("keeps VRF and secret private until terminal settlement and derives gates from the committed bytes", () => {
  const r = record();
  r.commitment = secretCommitment(dungeonSecret(owner, "0"));
  const publicView = dungeonView(r);
  expect(publicView.proof).toBeNull();
  expect(publicView).not.toHaveProperty("randomness");
  expect(publicView).not.toHaveProperty("reserve");
  expect(publicView).not.toHaveProperty("delivery");
  for (let room = 0; room < 5; room++) {
    const hash = createHash("sha256")
      .update("purrps:dungeon-gate:v1")
      .update(expeditionAddress(owner, "0").toBytes())
      .update(Buffer.from(r.randomness ?? "", "hex"))
      .update(dungeonSecret(owner, "0"))
      .update(Uint8Array.of(room, 0))
      .digest();
    expect(dungeonTrap(owner, "0", r.randomness ?? "", room)).toBe(
      (hash.find((v) => v < 255) ?? 0) % 3,
    );
  }
  r.settled = true;
  r.phase = "won";
  r.outcome = 0;
  const proof = dungeonView(r).proof;
  expect(secretCommitment(Buffer.from(proof?.secret ?? "", "hex"))).toBe(
    r.commitment,
  );
  expect(dungeonRecordSchema.parse(r).rules).toEqual(DUNGEON_V3);
});
it("starts a generated room from a public seed that never depends on the gate secret", async () => {
  const { generateRoom } = await import(
    "../../../../../apps/web/lib/dungeon/generate"
  );
  const { roomBudgetMs } = await import(
    "../../../../../apps/web/lib/dungeon/simulation"
  );
  const { dungeonRoomSeed } = await import(
    "../../../../../apps/web/lib/server/dungeon-randomness"
  );
  await updateDungeon(owner, { kind: "start", nonce: "0", client, room: 0 });
  const started = mocks.stored?.room;
  if (!started) throw new Error("room not started");
  const randomness = record().randomness ?? "";
  expect(started.seed).toBe(dungeonRoomSeed(owner, "0", randomness, 0));
  const room = generateRoom(started.seed, 0);
  expect(mocks.stored?.dueAt).toBe(
    100000 +
      roomBudgetMs(room, "collector", DUNGEON_V3) +
      DUNGEON_V3.hourglassMs,
  );
  vi.stubEnv(
    "BROWSER_VERIFIER_SECRET_KEY",
    Buffer.from(Keypair.generate().secretKey).toString("base64"),
  );
  expect(dungeonRoomSeed(owner, "0", randomness, 0)).toBe(started.seed);
  expect(dungeonRoomSeed(owner, "0", randomness, 1)).not.toBe(started.seed);
});
