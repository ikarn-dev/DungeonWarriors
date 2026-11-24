import { expect, it } from "vitest";
import { mergeDungeonView } from "../../../../../apps/web/lib/dungeon/view-state";
import { dungeonView } from "../../../../../apps/web/lib/server/dungeon-view";
import { record } from "./fixtures";

it("allows an explicit new approval at a cancelled nonce without accepting stale or unsolicited resets", () => {
  const cancelled = dungeonView({
    ...record(),
    randomness: null,
    phase: "cancelled",
    settled: true,
  });
  const preparation = {
    transaction: "approved fixture",
    lastValidBlockHeight: 200,
    sponsor: record().reserve.sponsor,
    maxPayerDebit: "200000000",
  };
  const next = {
    ...cancelled,
    phase: "preparing" as const,
    settled: false,
    preparation,
    serverNow: cancelled.serverNow + 10,
  };
  expect(mergeDungeonView(cancelled, next)).toBe(cancelled);
  expect(mergeDungeonView(cancelled, next, true)).toBe(next);
  expect(mergeDungeonView(next, cancelled)).toBe(next);
  const won = { ...cancelled, phase: "won" as const };
  expect(mergeDungeonView(won, next, true)).toBe(won);
});
