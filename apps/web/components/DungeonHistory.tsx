"use client";
import { useState } from "react";
import { z } from "zod";
import { catSchema } from "../lib/dungeon/protocol";
import { displayUsdc } from "../lib/game/custody-client";
import { CAT_NAMES } from "../lib/game/lobby-state";
import { webApi } from "../lib/game/web-api";
import { u64Input } from "../lib/solana/program";
import { useFinalized } from "./account-data";

const pageSchema = z.object({
  entries: z
    .array(
      z.object({
        nonce: u64Input,
        cat: catSchema,
        state: z.enum([
          "awaitingRandomness",
          "ready",
          "won",
          "lost",
          "refunded",
        ]),
        cleared: z.number().int().min(0).max(5),
        stake: u64Input,
        payout: u64Input,
      }),
    )
    .max(8),
  next: u64Input.nullable(),
});
type Page = z.infer<typeof pageSchema>;
const read = async (signal: AbortSignal, fromNonce?: string) =>
  pageSchema.parse(
    await webApi("/api/dungeon", { kind: "history", fromNonce }, signal),
  );
const labels = {
  awaitingRandomness: "Preparing",
  ready: "In progress",
  won: "Treasure banked",
  lost: "Lost",
  refunded: "Refunded",
};
export default function DungeonHistory({
  revision,
}: {
  readonly revision: number | undefined;
}) {
  const latest = useFinalized(revision, read);
  const [older, setOlder] = useState<Page | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(false);
  const seen = new Set(latest.value?.entries.map((e) => e.nonce));
  const entries = [
    ...(latest.value?.entries ?? []),
    ...(older?.entries.filter((e) => !seen.has(e.nonce)) ?? []),
  ];
  const next = older ? older.next : latest.value?.next;
  async function more() {
    if (!next) return;
    setBusy(true);
    setError(false);
    try {
      const p = await read(AbortSignal.timeout(10000), next);
      setOlder((old) => ({
        entries: [...(old?.entries ?? []), ...p.entries],
        next: p.next,
      }));
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="lobby-section">
      <h2>Expeditions</h2>
      {latest.failed && (
        <>
          <p>Could not read finalized expeditions.</p>
          <button className="pixel-button" type="button" onClick={latest.retry}>
            Retry
          </button>
        </>
      )}
      {latest.value === null ? (
        <p>Loading expeditions…</p>
      ) : entries.length === 0 ? (
        <p>No dungeon expeditions on this page.</p>
      ) : (
        <table className="lobby-table">
          <thead>
            <tr>
              <th>Expedition</th>
              <th>Cat</th>
              <th>Result</th>
              <th>Rooms</th>
              <th>Bet USDC</th>
              <th>Return USDC</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.nonce}>
                <td>#{e.nonce}</td>
                <td>{CAT_NAMES[e.cat]}</td>
                <td>{labels[e.state]}</td>
                <td>{e.cleared}</td>
                <td>{displayUsdc(e.stake)}</td>
                <td>{displayUsdc(e.payout)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {error && <output>Could not load older expeditions. Try again.</output>}
      {next && (
        <button
          className="pixel-button"
          type="button"
          disabled={busy}
          onClick={() => void more()}
        >
          Older expeditions
        </button>
      )}
    </section>
  );
}
