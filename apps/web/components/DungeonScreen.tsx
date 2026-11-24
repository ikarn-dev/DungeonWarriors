import type { DungeonArtwork } from "../lib/dungeon/artwork";
import type { DungeonRequest, DungeonView } from "../lib/dungeon/protocol";
import DungeonStage from "./DungeonStage";

export default function DungeonScreen({
  view,
  artwork,
  busy,
  notice,
  client,
  send,
  onPlay,
  onClose,
}: {
  readonly view: DungeonView;
  readonly artwork: DungeonArtwork | null;
  readonly busy: boolean;
  readonly notice: string | null;
  readonly client: string;
  readonly send: (input: DungeonRequest) => Promise<DungeonView | null>;
  readonly onPlay: () => void;
  readonly onClose: () => void;
}) {
  // Neither graphics callbacks nor their lifecycle can end an unsigned wager.
  if (view.phase === "preparing" || view.phase === "cancelled") {
    const cancelled = view.phase === "cancelled";
    return (
      <div className="dungeon-overlay">
        <div className="dungeon-result pixel-panel" aria-busy={busy}>
          <h2>{cancelled ? "Wager not placed" : "Preparing expedition"}</h2>
          {notice && <output>{notice}</output>}
          <p>
            {cancelled
              ? "No wager was taken."
              : view.preparation
                ? "Approve the wager in your wallet."
                : "Confirming your wager and preparing the catacombs…"}
          </p>
          {(cancelled || view.preparation) && (
            <button
              className="pixel-button"
              data-tone="gold"
              type="button"
              disabled={busy}
              onClick={cancelled ? onClose : onPlay}
            >
              Play
            </button>
          )}
        </div>
      </div>
    );
  }
  return (
    <>
      {notice && <output className="dungeon-notice">{notice}</output>}
      {artwork?.cat === view.cat ? (
        <DungeonStage
          view={view}
          artwork={artwork}
          client={client}
          send={send}
          onDone={onClose}
        />
      ) : (
        <output className="dungeon-loading">Loading the catacombs…</output>
      )}
    </>
  );
}
