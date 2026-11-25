"use client";
import { useEffect, useRef, useState } from "react";
import {
  type TransactionCursor,
  type TransactionHistoryPage,
  transactionHistoryPage,
} from "../lib/game/transaction-history";
import { webApi } from "../lib/game/web-api";
import { useFinalized } from "./account-data";
import DotsLoader from "./DotsLoader";

function read(signal: AbortSignal, before?: TransactionCursor) {
  return webApi(
    "/api/chain/state",
    { kind: "transactions", before },
    AbortSignal.any([signal, AbortSignal.timeout(10000)]),
  ).then((result) => transactionHistoryPage.parse(result));
}

const formatDate = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
});

export default function TransactionHistory({
  revision,
}: {
  readonly revision: number | undefined;
}) {
  const { value, failed, retry } = useFinalized(revision, read);
  const [loaded, setLoaded] = useState<{
    first: TransactionCursor;
    page: TransactionHistoryPage;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (revision === undefined) request.current?.abort();
  }, [revision]);

  const first = value?.next;
  const older =
    first &&
    loaded?.first.player === first.player &&
    loaded.first.collection === first.collection
      ? loaded.page
      : null;
  const entries = [...(value?.entries ?? []), ...(older?.entries ?? [])].sort(
    (a, b) => b.slot - a.slot,
  );
  const next = older ? older.next : value?.next;

  async function loadMore() {
    if (!first || !next || request.current !== null) return;
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setLoadFailed(false);
    try {
      const page = await read(controller.signal, next);
      controller.signal.throwIfAborted();
      const seen = new Set(entries.map(({ signature }) => signature));
      setLoaded({
        first,
        page: {
          entries: [
            ...(older?.entries ?? []),
            ...page.entries.filter(({ signature }) => !seen.has(signature)),
          ],
          next: page.next,
        },
      });
    } catch {
      if (!controller.signal.aborted) setLoadFailed(true);
    } finally {
      request.current = null;
      setLoading(false);
    }
  }

  return (
    <section
      className="lobby-section lobby-transactions"
      aria-label="Transactions"
    >
      {failed && (
        <div className="lobby-empty">
          <p role="alert">Transactions unavailable.</p>
          <button className="pixel-button" type="button" onClick={retry}>
            Retry
          </button>
        </div>
      )}
      {!failed && value === null && (
        <div className="lobby-loading">
          <DotsLoader label="Loading transactions" />
        </div>
      )}
      {value && entries.length === 0 && !next && <p>No transactions yet.</p>}
      {entries.length > 0 && (
        <table className="lobby-table">
          <thead>
            <tr>
              <th scope="col">Activity</th>
              <th scope="col">Date</th>
              <th scope="col">Solscan</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(({ signature, blockTime, activities }) => {
              const date =
                blockTime === null ? null : new Date(blockTime * 1000);
              return (
                <tr key={signature}>
                  <td>{activities.join(" · ")}</td>
                  <td>
                    {date ? (
                      <time dateTime={date.toISOString()}>
                        {formatDate.format(date)}
                      </time>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    <a
                      className="lobby-transaction-link"
                      href={`https://solscan.io/tx/${signature}?cluster=devnet`}
                      rel="noopener noreferrer"
                      target="_blank"
                      title={signature}
                    >
                      {signature.slice(0, 5)}…{signature.slice(-5)}
                      <span className="sr-only">
                        {" "}
                        on Solscan (opens in a new tab)
                      </span>
                    </a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {loadFailed && <p role="alert">Couldn’t load older transactions.</p>}
      {next && (
        <button
          className="pixel-button"
          type="button"
          disabled={loading}
          onClick={() => void loadMore()}
        >
          {loading ? "Loading…" : "Load older"}
        </button>
      )}
    </section>
  );
}
