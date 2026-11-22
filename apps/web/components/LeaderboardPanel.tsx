"use client";

import { readLeaderboard, useFinalized } from "./account-data";

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
        {mine && <p className="lobby-section-note">Your rank #{mine.rank}</p>}
      </header>
      {failed && value === null ? (
        <div className="lobby-empty">
          <p>The leaderboard could not be read.</p>
          <button type="button" className="pixel-button" onClick={retry}>
            Retry
          </button>
        </div>
      ) : value !== null && value.length === 0 ? (
        <p className="lobby-empty">The first finalized score appears here.</p>
      ) : (
        <table className="lobby-table" aria-busy={value === null}>
          <thead>
            <tr>
              <th scope="col">Rank</th>
              <th scope="col">Player</th>
              <th scope="col" data-number>
                Score
              </th>
            </tr>
          </thead>
          <tbody>
            {value === null &&
              ["a", "b", "c"].map((row) => (
                <tr key={row}>
                  <td colSpan={3}>
                    <span className="lobby-skeleton" data-wide />
                  </td>
                </tr>
              ))}
            {value?.map((row) => (
              <tr
                key={row.wallet}
                data-mine={row.wallet === wallet || undefined}
              >
                <td>
                  <span className="lobby-rank" data-rank={row.rank}>
                    {row.rank}
                  </span>
                </td>
                <td title={row.wallet}>
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
