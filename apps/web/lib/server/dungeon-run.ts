import "server-only";
import { generateRoom } from "../dungeon/generate";
import type { DungeonRequest } from "../dungeon/protocol";
import { replayRoom } from "../dungeon/replay";
import { PHYSICS, payout } from "../dungeon/rules";
import { budgetMs, nearbyGate, roomBudgetMs } from "../dungeon/simulation";
import { refreshDungeon } from "./dungeon-delivery";
import { dungeonRoomSeed, dungeonTrap } from "./dungeon-randomness";
import { dungeonHistory, dungeonLeaderboard } from "./dungeon-records";
import {
  broadcastReservation,
  offerDungeon,
  quoteDungeon,
  submitDungeon,
} from "./dungeon-reservation";
import {
  activeDungeon,
  type DungeonRecord,
  withDungeon,
} from "./dungeon-store";
import { dungeonView } from "./dungeon-view";
import { ApiError } from "./runtime";

export function finishDungeon(
  record: DungeonRecord,
  outcome: 0 | 1 | 2,
  reason: NonNullable<DungeonRecord["reason"]>,
) {
  if (record.outcome !== null || record.settled) return;
  record.outcome = outcome;
  record.reason = reason;
  record.dueAt = Date.now();
  if (record.phase !== "preparing")
    record.phase = outcome === 0 ? "won" : outcome === 1 ? "lost" : "refunded";
  record.payout =
    outcome === 0
      ? payout(BigInt(record.stake), record.cleared, record.rules).toString()
      : outcome === 2
        ? record.stake
        : "0";
}
export async function updateDungeon(owner: string, input: DungeonRequest) {
  if (input.kind === "history") return dungeonHistory(owner, input.fromNonce);
  if (input.kind === "leaderboard") return dungeonLeaderboard();
  if (input.kind === "offer") return offerDungeon(owner, input);
  if (input.kind === "quote") return quoteDungeon(owner, input);
  if (input.kind === "submit")
    return submitDungeon(owner, input.nonce, input.transaction);
  const nonce =
    input.kind === "status"
      ? (input.nonce ?? (await activeDungeon(owner)))
      : input.nonce;
  if (nonce === null) return null;
  const result = await withDungeon(owner, nonce, async (record) => {
    if (!record) {
      if (input.kind === "status") return { record, value: null };
      throw new ApiError("DUNGEON_NOT_FOUND", 409);
    }
    if (record.settled) return { record, value: dungeonView(record) };
    const now = Date.now();
    if (input.kind === "status") {
      if (record.phase === "preparing" || record.outcome !== null)
        await refreshDungeon(record);
      if (
        record.phase === "playing" &&
        input.client &&
        input.client !== record.client
      )
        finishDungeon(record, 1, "abandoned");
      return { record, value: dungeonView(record) };
    }
    if (record.outcome !== null) return { record, value: dungeonView(record) };
    if (input.kind === "start") {
      if (
        record.phase === "playing" &&
        record.client === input.client &&
        record.room?.index === input.room
      )
        return { record, value: dungeonView(record) };
      if (
        !["ready", "intermission"].includes(record.phase) ||
        !record.randomness ||
        input.room !== record.cleared ||
        input.room >= record.maxRooms
      )
        throw new ApiError("DUNGEON_STATE_CHANGED", 409);
      const seed = dungeonRoomSeed(owner, nonce, record.randomness, input.room);
      record.client = input.client;
      record.phase = "playing";
      record.room = { index: input.room, seed, startedAt: now };
      record.dueAt =
        now +
        roomBudgetMs(generateRoom(seed, input.room), record.cat, record.rules) +
        record.rules.hourglassMs +
        (record.cat === "guardian" ? record.rules.guardianGraceMs : 0);
    } else if (input.kind === "enter") {
      if (record.gates[input.room] === input.gate)
        return { record, value: dungeonView(record) };
      if (
        record.phase !== "playing" ||
        record.client !== input.client ||
        record.room?.index !== input.room ||
        !record.randomness
      )
        throw new ApiError("DUNGEON_STATE_CHANGED", 409);
      const elapsed = now - record.room.startedAt;
      if (
        elapsed < 0 ||
        input.through >
          Math.floor((elapsed * PHYSICS.ticksPerSecond) / 1000) + 1
      )
        throw new ApiError("INVALID_DUNGEON_TIME", 409);
      let frame: ReturnType<typeof replayRoom>;
      const room = generateRoom(record.room.seed, input.room);
      try {
        frame = replayRoom(
          room,
          record.cat,
          record.rules,
          input.through,
          input.inputs,
        );
      } catch {
        throw new ApiError("INVALID_DUNGEON_REPLAY", 409);
      }
      if (
        frame.timedOut ||
        elapsed >= budgetMs(frame, room, record.cat, record.rules)
      ) {
        finishDungeon(record, 1, "gas");
      } else {
        if (nearbyGate(frame, room) !== input.gate)
          throw new ApiError("DUNGEON_GATE_OUT_OF_RANGE", 409);
        record.gates.push(input.gate);
        if (
          input.gate ===
          dungeonTrap(owner, nonce, record.randomness, input.room)
        ) {
          finishDungeon(record, 1, "trap");
        } else {
          record.cleared++;
          record.room = null;
          record.phase = "intermission";
          record.dueAt = now + 60000;
          record.payout = payout(
            BigInt(record.stake),
            record.cleared,
            record.rules,
          ).toString();
          if (record.cleared === record.maxRooms)
            finishDungeon(record, 0, "banked");
        }
      }
    } else if (input.kind === "cashout") {
      if (record.phase !== "intermission")
        throw new ApiError("DUNGEON_ROOM_ACTIVE", 409);
      finishDungeon(record, 0, "banked");
    } else if (input.kind === "exit") {
      if (record.phase === "playing") finishDungeon(record, 1, "abandoned");
      else if (
        record.phase === "preparing" &&
        record.reserve.signature === null
      ) {
        record.phase = "cancelled";
        record.settled = true;
        record.reason = "cancelled";
      } else
        finishDungeon(
          record,
          record.cleared > 0 ? 0 : 2,
          record.cleared > 0 ? "banked" : "unstarted",
        );
    }
    return { record, value: dungeonView(record) };
  });
  if (result?.phase === "preparing") {
    await withDungeon(owner, nonce, async (record) => {
      if (record?.reserve.signature) await broadcastReservation(record);
      return { record, value: null };
    });
  }
  return result;
}
