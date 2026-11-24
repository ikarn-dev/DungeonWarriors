import type { DungeonArtwork } from "../lib/dungeon/artwork";
import type { DungeonRequest, DungeonView } from "../lib/dungeon/protocol";
import DungeonStage from "./DungeonStage";

export default function DungeonScreen({
  view,
  artwork,
  notice,
  client,
  send,
  onClose,
}: {
  readonly view: DungeonView;
  readonly artwork: DungeonArtwork | null;
  readonly notice: string | null;
  readonly client: string;
  readonly send: (input: DungeonRequest) => Promise<DungeonView | null>;
  readonly onClose: () => void;
}) {
  if (view.phase === "preparing" || view.phase === "cancelled") return null;
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
