"use client";
import { useState } from "react";
import DungeonHistory from "./DungeonHistory";
import TransactionHistory from "./TransactionHistory";

export default function HistoryTabs({
  revision,
}: {
  readonly revision: number | undefined;
}) {
  const [view, setView] = useState<"game" | "transactions">("game");
  return (
    <section className="lobby-section">
      <h2>History</h2>
      <fieldset className="lobby-history-tabs" data-view={view}>
        <legend className="sr-only">History view</legend>
        <button
          className="history-tab"
          aria-pressed={view === "game"}
          type="button"
          onClick={() => setView("game")}
        >
          Game
        </button>
        <button
          className="history-tab"
          aria-pressed={view === "transactions"}
          type="button"
          onClick={() => setView("transactions")}
        >
          Transactions
        </button>
      </fieldset>
      <div hidden={view !== "game"}>
        <DungeonHistory revision={view === "game" ? revision : undefined} />
      </div>
      <div hidden={view !== "transactions"}>
        <TransactionHistory
          revision={view === "transactions" ? revision : undefined}
        />
      </div>
    </section>
  );
}
