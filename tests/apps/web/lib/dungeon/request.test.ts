import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { requestDungeon } from "../../../../../apps/web/lib/dungeon/request";
import { WebApiError } from "../../../../../apps/web/lib/game/web-api";

const input = {
  kind: "submit",
  nonce: "13",
  transaction: "same-wallet-approved-bytes",
} as const;
const response = (status: number, value: unknown) =>
  new Response(JSON.stringify(value), { status });
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("retries a contended lock with identical signed bytes and no exit or new quote", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(response(409, { error: "DUNGEON_BUSY" }))
    .mockResolvedValueOnce(response(409, { error: "DUNGEON_BUSY" }))
    .mockResolvedValue(response(200, { phase: "preparing" }));
  vi.stubGlobal("fetch", fetch);
  const pending = requestDungeon(input);
  await vi.runAllTimersAsync();
  await expect(pending).resolves.toEqual({ phase: "preparing" });
  expect(fetch).toHaveBeenCalledTimes(3);
  for (const [, init] of fetch.mock.calls)
    expect(JSON.parse(init.body)).toEqual(input);
});
it("does not turn a state conflict into an automatic cancellation", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(response(409, { error: "DUNGEON_STATE_CHANGED" }));
  vi.stubGlobal("fetch", fetch);
  await expect(requestDungeon(input)).rejects.toMatchObject({
    code: "DUNGEON_STATE_CHANGED",
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fetch.mock.calls[0]?.[1].body)).toEqual(input);
});
it("stops bounded lock retries without changing or discarding the approved payload", async () => {
  const fetch = vi
    .fn()
    .mockImplementation(() =>
      Promise.resolve(response(409, { error: "DUNGEON_BUSY" })),
    );
  vi.stubGlobal("fetch", fetch);
  const pending = expect(requestDungeon(input)).rejects.toBeInstanceOf(
    WebApiError,
  );
  await vi.runAllTimersAsync();
  await pending;
  expect(fetch).toHaveBeenCalledTimes(4);
});
it("makes no request after the caller aborts", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const controller = new AbortController();
  controller.abort();
  await expect(requestDungeon(input, controller.signal)).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
});
