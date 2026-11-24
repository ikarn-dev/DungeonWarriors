import { beforeEach, expect, it, vi } from "vitest";
import { withDungeon } from "../../../../../apps/web/lib/server/dungeon-store";
import { owner, record } from "../dungeon/fixtures";

const mocks = vi.hoisted(() => ({
  redis: { set: vi.fn(), get: vi.fn(), eval: vi.fn() },
}));
vi.mock("../../../../../apps/web/lib/server/runtime", async (original) => ({
  ...(await original<
    typeof import("../../../../../apps/web/lib/server/runtime")
  >()),
  runtime: () => ({ redis: mocks.redis, prefix: "test" }),
}));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.redis.set.mockResolvedValue("OK");
  mocks.redis.get.mockResolvedValue(null);
  mocks.redis.eval.mockResolvedValue(1);
});
it("fences saves before returning prepared work and keeps unsettled work durable", async () => {
  const next = record();
  await withDungeon(owner, "0", async () => ({
    record: next,
    value: "prepared",
  }));
  const save = mocks.redis.eval.mock.calls[0];
  expect(save?.[0]).toContain("ZADD");
  expect(save?.[2][2]).toBe("0");
  expect(save?.[2][1]).toBe(`!${JSON.stringify(next)}`);
  mocks.redis.eval.mockResolvedValueOnce(0);
  await expect(
    withDungeon(owner, "0", async () => ({
      record: next,
      value: "must never broadcast",
    })),
  ).rejects.toThrow("DUNGEON_BUSY");
});
it("rejects cross-wallet state, preserves the original record and releases only its own lease", async () => {
  const next = record();
  next.owner = record().reserve.sponsor;
  await expect(
    withDungeon(owner, "0", async () => ({ record: next, value: null })),
  ).rejects.toThrow("DUNGEON_SCOPE_MISMATCH");
  expect(mocks.redis.eval).toHaveBeenCalledTimes(1);
  expect(mocks.redis.eval.mock.calls[0]?.[0]).toContain("ARGV[1]");
});
it("rejects a concurrent lease without running its mutation", async () => {
  mocks.redis.set.mockResolvedValue(null);
  const work = vi.fn();
  await expect(withDungeon(owner, "0", work)).rejects.toThrow("DUNGEON_BUSY");
  expect(work).not.toHaveBeenCalled();
});
