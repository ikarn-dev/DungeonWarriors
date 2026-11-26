import type { DungeonView } from "../lib/dungeon/protocol";
import { displayUsdc } from "../lib/game/custody-client";
import { ResultSkull } from "./ResultSkull";
import { TreasureChest } from "./TreasureChest";

// The dungeon result card: a chest, the title, the payout with the signed
// profit or loss against the wager, and the keys. Settlement progress is a
// toast (DungeonEntry). The sign (+ or −) carries the result alongside its colour.
export function DungeonResult({
  view,
  title,
  downed,
  finished,
  error,
  busy,
  ready,
  onCashOut,
  onDescend,
  onDone,
}: {
  readonly view: DungeonView;
  readonly title: string;
  // The gas or a fall in battle ended the room.
  readonly downed: boolean;
  readonly finished: boolean;
  readonly error: string | null;
  readonly busy: boolean;
  readonly ready: boolean;
  readonly onCashOut: () => void;
  readonly onDescend: () => void;
  readonly onDone: () => void;
}) {
  const treasure =
    !downed && (view.phase === "intermission" || view.phase === "won");
  const lost = downed || view.phase === "lost";
  const ended = finished || downed;
  const result = treasure || lost || view.phase === "refunded";
  const payout = lost ? 0n : BigInt(view.payout);
  const net = payout - BigInt(view.stake);
  return (
    <div className="dungeon-result pixel-panel" aria-live="polite">
      {lost ? <ResultSkull /> : result && <TreasureChest open={treasure} />}
      <h2>{title}</h2>
      {result && (
        <div className="dungeon-result-figure">
          <p>
            <strong>{displayUsdc(payout.toString())}</strong> USDC
          </p>
          {net !== 0n && (
            <p
              className="dungeon-result-net"
              data-sign={net > 0n ? "profit" : "loss"}
            >
              {net > 0n ? "+" : "−"}
              {displayUsdc((net > 0n ? net : -net).toString())} USDC
              <span className="sr-only">{net > 0n ? " profit" : " loss"}</span>
            </p>
          )}
        </div>
      )}
      {error && <output>{error}</output>}
      {(view.phase === "intermission" || ended) && (
        <div className="dungeon-result-actions">
          {view.phase === "intermission" && !downed ? (
            <>
              <button
                className="metal-key"
                type="button"
                disabled={busy}
                onClick={onCashOut}
              >
                Cash out
              </button>
              <button
                className="metal-key"
                data-tone="teal"
                type="button"
                disabled={busy || !ready}
                onClick={onDescend}
              >
                Descend
              </button>
            </>
          ) : (
            <button className="metal-key" type="button" onClick={onDone}>
              Lobby
            </button>
          )}
        </div>
      )}
    </div>
  );
}
