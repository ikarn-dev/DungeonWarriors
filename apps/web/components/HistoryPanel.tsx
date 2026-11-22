"use client";

import { useState } from "react";
import { displayUsdc } from "../lib/game/custody-client";
import { type HistoryEntry, readHistory, useFinalized } from "./account-data";
import { LobbySegment } from "./LobbySegment";
import RunStage from "./RunStage";

const RESULTS = [
  ["all", "All"],
  ["win", "Wins"],
  ["loss", "Losses"],
  ["technicalRefund", "Refunds"],
  ["live", "Live"],
] as const;
const MARKETS = [
  ["All", "All"],
  ["BTC", "BTC"],
  ["ETH", "ETH"],
  ["SOL", "SOL"],
] as const;
type Result = (typeof RESULTS)[number][0];
type Market = (typeof MARKETS)[number][0];
const count = (value: string) =>
  new Intl.NumberFormat("en-US").format(BigInt(value));
const latestPage = (signal: AbortSignal) => readHistory(signal);
const outcomeLabel = { win: "Win", loss: "Loss", technicalRefund: "Refund" };

function matches(entry: HistoryEntry, result: Result, market: Market) {
  if (entry.status === "pending")
    return (result === "all" || result === "live") && market === "All";
  return (
    (result === "all" || result === entry.outcome) &&
    (market === "All" || market === entry.market)
  );
}

export default function HistoryPanel({
  wallet,
  revision,
  media,
  onSettled,
}: {
  readonly wallet: string;
  readonly revision: number | undefined;
  readonly media: { version: number; contentHash: string } | null;
  readonly onSettled: () => void;
}) {
  const latest = useFinalized(revision, latestPage);
  const [older, setOlder] = useState<{
    entries: HistoryEntry[];
    next: string | null;
  } | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [result, setResult] = useState<Result>("all");
  const [market, setMarket] = useState<Market>("All");
  const [watched, setWatched] = useState<string | null>(null);
  const head = latest.value;
  const seen = new Set(head?.entries.map(({ nonce }) => nonce));
  const entries = [
    ...(head?.entries ?? []),
    ...(older?.entries.filter(({ nonce }) => !seen.has(nonce)) ?? []),
  ];
  const next = older ? older.next : (head?.nextFromNonce ?? null);
  const shown = entries.filter((entry) => matches(entry, result, market));

  async function loadOlder() {
    if (next === null) return;
    setLoadingOlder(true);
    try {
      const page = await readHistory(AbortSignal.timeout(10_000), next);
      setOlder((previous) => ({
        entries: [...(previous?.entries ?? []), ...page.entries],
        next: page.nextFromNonce,
      }));
    } catch {
      // The button stays available; the next press retries the same page.
    } finally {
      setLoadingOlder(false);
    }
  }

  return (
    <div className="lobby-section">
      <header className="lobby-section-head">
        <h2>History</h2>
      </header>
      <div className="lobby-filters">
        <LobbySegment
          label="Result"
          options={RESULTS}
          value={result}
          onChange={setResult}
        />
        <LobbySegment
          label="Market"
          options={MARKETS}
          value={market}
          onChange={setMarket}
        />
      </div>
      {watched !== null && (
        <RunStage
          key={watched}
          nonce={watched}
          wallet={wallet}
          media={media}
          close={() => setWatched(null)}
          runSettled={() => {
            setWatched(null);
            onSettled();
          }}
        />
      )}
      {latest.failed && head === null ? (
        <div className="lobby-empty">
          <p>Run history could not be read.</p>
          <button type="button" className="pixel-button" onClick={latest.retry}>
            Retry
          </button>
        </div>
      ) : (
        <table className="lobby-table" aria-busy={head === null}>
          <thead>
            <tr>
              <th scope="col">Run</th>
              <th scope="col">Market</th>
              <th scope="col">Result</th>
              <th scope="col" data-number>
                Score
              </th>
              <th scope="col" data-number>
                Stake USDC
              </th>
              <th scope="col" data-number>
                Return USDC
              </th>
            </tr>
          </thead>
          <tbody>
            {head === null &&
              ["a", "b", "c"].map((row) => (
                <tr key={row}>
                  <td colSpan={6}>
                    <span className="lobby-skeleton" data-wide />
                  </td>
                </tr>
              ))}
            {shown.map((entry) =>
              entry.status === "pending" ? (
                <tr key={entry.nonce}>
                  <td>#{count(entry.nonce)}</td>
                  <td>—</td>
                  <td>
                    <span className="lobby-badge" data-result="live">
                      Live
                    </span>
                  </td>
                  <td colSpan={3} data-number>
                    <button
                      type="button"
                      className="pixel-button"
                      onClick={() => setWatched(entry.nonce)}
                    >
                      View run
                    </button>
                  </td>
                </tr>
              ) : (
                <tr key={entry.nonce}>
                  <td>#{count(entry.nonce)}</td>
                  <td>{entry.market}</td>
                  <td>
                    <span className="lobby-badge" data-result={entry.outcome}>
                      {outcomeLabel[entry.outcome]}
                    </span>
                  </td>
                  <td data-number>{count(entry.score)}</td>
                  <td data-number>{displayUsdc(entry.stakeBaseUnits)}</td>
                  <td data-number>
                    {displayUsdc(
                      entry.outcome === "technicalRefund"
                        ? entry.refundBaseUnits
                        : entry.grossPayoutBaseUnits,
                    )}
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      )}
      {head !== null && shown.length === 0 && (
        <p className="lobby-empty">
          {entries.length === 0
            ? "No runs yet."
            : "No runs match these filters."}
        </p>
      )}
      {next !== null && head !== null && (
        <button
          type="button"
          className="pixel-button lobby-more"
          disabled={loadingOlder}
          onClick={() => void loadOlder()}
        >
          Older runs
        </button>
      )}
    </div>
  );
}
