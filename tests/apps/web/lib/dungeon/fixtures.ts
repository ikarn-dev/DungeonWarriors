import { Keypair } from "@solana/web3.js";
import { DUNGEON_V1, payout } from "../../../../../apps/web/lib/dungeon/rules";
import type { DungeonRecord } from "../../../../../apps/web/lib/server/dungeon-store";
export const owner = Keypair.fromSeed(
  new Uint8Array(32).fill(1),
).publicKey.toBase58();
export const client = "00000000-0000-4000-8000-000000000001";
export const verifier = Keypair.fromSeed(new Uint8Array(32).fill(2));
export function record(): DungeonRecord {
  return {
    nonce: "0",
    owner,
    cat: "collector",
    rules: { ...DUNGEON_V1 },
    rulesHash: "00".repeat(32),
    commitment: "11".repeat(32),
    stake: "1000000",
    maxGross: payout(1000000n, 5, DUNGEON_V1).toString(),
    maxRooms: 5,
    cleared: 0,
    gates: [],
    phase: "ready",
    settled: false,
    payout: "0",
    room: null,
    client: null,
    randomness: "07".repeat(32),
    createdAt: 100000,
    dueAt: 160000,
    reserve: {
      transaction: "fixture",
      lastValidBlockHeight: 100,
      sponsor: Keypair.fromSeed(
        new Uint8Array(32).fill(3),
      ).publicKey.toBase58(),
      maxPayerDebit: "200000000",
      messageHash: "22".repeat(32),
      signature: "fixture",
      cost: "10000",
    },
    delivery: null,
    outcome: null,
    reason: null,
  };
}
