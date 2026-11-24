import "server-only";
import { type DungeonView, dungeonViewSchema } from "../dungeon/protocol";
import { dungeonSecret } from "./dungeon-randomness";
import type { DungeonRecord } from "./dungeon-store";
export function dungeonView(record: DungeonRecord): DungeonView {
  return dungeonViewSchema.parse({
    nonce: record.nonce,
    owner: record.owner,
    cat: record.cat,
    rules: record.rules,
    rulesHash: record.rulesHash,
    commitment: record.commitment,
    stake: record.stake,
    maxGross: record.maxGross,
    maxRooms: record.maxRooms,
    cleared: record.cleared,
    gates: record.gates,
    phase: record.phase,
    settled: record.settled,
    payout: record.payout,
    serverNow: Date.now(),
    room: record.room,
    preparation:
      record.phase === "preparing" && record.reserve.signature === null
        ? {
            transaction: record.reserve.transaction,
            lastValidBlockHeight: record.reserve.lastValidBlockHeight,
            sponsor: record.reserve.sponsor,
            maxPayerDebit: record.reserve.maxPayerDebit,
          }
        : null,
    proof:
      record.settled && record.randomness
        ? {
            randomness: record.randomness,
            secret: dungeonSecret(record.owner, record.nonce).toString("hex"),
          }
        : null,
  });
}
