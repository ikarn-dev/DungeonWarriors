import "server-only";
import type { DungeonRequest } from "../dungeon/protocol";
import { deliverDungeon, refreshDungeon } from "./dungeon-delivery";
import { broadcastReservation } from "./dungeon-reservation";
import { finishDungeon } from "./dungeon-run";
import { dungeonPendingKey, withDungeon } from "./dungeon-store";
import { dungeonView } from "./dungeon-view";
import { ApiError, runtime } from "./runtime";
import { observeDuration } from "./telemetry";

// Departure is a lifecycle action outside the published room engine.
export async function exitDungeon(
  owner: string,
  input: Extract<DungeonRequest, { kind: "exit" }>,
) {
  return withDungeon(owner, input.nonce, async (record) => {
    if (!record) throw new ApiError("DUNGEON_NOT_FOUND", 409);
    if (!record.settled && record.outcome === null) {
      if (record.client !== null && record.client !== input.client)
        throw new ApiError("DUNGEON_OTHER_CLIENT", 409);
      if (record.phase === "playing") finishDungeon(record, 1, "abandoned");
      else if (record.phase === "preparing" && !record.reserve.signature) {
        record.phase = "cancelled";
        record.settled = true;
        record.reason = "cancelled";
      } else if (record.cleared > 0) finishDungeon(record, 0, "banked");
      else finishDungeon(record, 2, "unstarted");
    }
    return { record, value: dungeonView(record) };
  });
}

export async function recoverDungeonWallet(owner: string): Promise<void> {
  const r = runtime();
  const due = await r.redis.zrange<string[]>(
    dungeonPendingKey(owner),
    0,
    Date.now(),
    {
      byScore: true,
      offset: 0,
      count: 3,
    },
  );
  for (const nonce of due) {
    const started = performance.now();
    try {
      const terminal = await withDungeon(
        owner,
        String(nonce),
        async (record) => {
          if (!record) {
            await r.redis.zrem(dungeonPendingKey(owner), String(nonce));
            return { record, value: false };
          }
          if (record.phase === "preparing") {
            await refreshDungeon(record);
            if (!record.settled) await broadcastReservation(record);
          }
          if (
            !record.settled &&
            record.outcome === null &&
            Date.now() >= record.dueAt
          ) {
            if (record.phase === "playing") finishDungeon(record, 1, "gas");
            else if (record.phase === "ready")
              finishDungeon(record, 2, "unstarted");
            else if (record.phase === "intermission")
              finishDungeon(record, 0, "banked");
          }
          return { record, value: record.outcome !== null && !record.settled };
        },
      );
      if (terminal) await deliverDungeon(owner, String(nonce));
      observeDuration("run.settle", started, "ok");
    } catch {
      observeDuration("run.settle", started, "pending");
    }
  }
}
