"use client";

import { z } from "zod";
import { webApi } from "../lib/game/web-api";
import { publicKeySchema } from "../lib/solana/addresses";
import { u64Input } from "../lib/solana/program";
import { useFinalized } from "./account-data";
import DotsLoader from "./DotsLoader";

const boardSchema = z
  .array(
    z.object({
      rank: z.number().int().min(1).max(20),
      wallet: publicKeySchema,
      score: u64Input,
    }),
  )
  .max(20);
const readLeaderboard = async (signal: AbortSignal) =>
  boardSchema.parse(
    await webApi("/api/dungeon", { kind: "leaderboard" }, signal),
  );
const count = (value: string) =>
  new Intl.NumberFormat("en-US").format(BigInt(value));
const short = (wallet: string) => `${wallet.slice(0, 4)}…${wallet.slice(-4)}`;

export default function LeaderboardPanel({
  wallet,
  revision,
}: {
  readonly wallet: string;
  readonly revision: number | undefined;
}) {
  const { value, failed, retry } = useFinalized(revision, readLeaderboard);
  const mine = value?.find((row) => row.wallet === wallet);
  return (
    <div className="lobby-section">
      <header className="lobby-section-head">
        <h2>Leaderboard</h2>
        {mine && (
          <p className="lobby-rank-note">
            Your rank <strong>#{mine.rank}</strong>
          </p>
        )}
      </header>
      {failed && value === null ? (
        <div className="lobby-empty">
          <p>The leaderboard could not be read.</p>
          <button type="button" className="pixel-button" onClick={retry}>
            Retry
          </button>
        </div>
      ) : value === null ? (
        <div className="lobby-loading">
          <DotsLoader label="Loading leaderboard" />
        </div>
      ) : value.length === 0 ? (
        <p className="lobby-empty">
          The first finalized expedition appears here.
        </p>
      ) : (
        <table className="lobby-table">
          <thead>
            <tr>
              <th scope="col" data-center>
                Rank
              </th>
              <th scope="col">Player</th>
              <th scope="col" data-number>
                Rooms cleared
              </th>
            </tr>
          </thead>
          <tbody>
            {value.map((row) => (
              <tr
                key={row.wallet}
                data-mine={row.wallet === wallet || undefined}
              >
                <td data-center>
                  <span className="lobby-rank" data-rank={row.rank}>
                    {row.rank}
                  </span>
                </td>
                <td className="lobby-player" title={row.wallet}>
                  {row.wallet === wallet ? "You" : short(row.wallet)}
                </td>
                <td data-number>{count(row.score)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
