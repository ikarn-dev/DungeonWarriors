import { Component, type ReactNode, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { DungeonArtwork } from "../lib/dungeon/artwork";
import type { DungeonRequest, DungeonView } from "../lib/dungeon/protocol";
import DungeonStage from "./DungeonStage";

export function DungeonDialog({
  children,
  onClose,
  onFailure,
}: {
  readonly children: ReactNode;
  readonly onClose: () => void;
  readonly onFailure: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (dialog.current?.open) return;
    try {
      dialog.current?.showModal();
    } catch {
      onFailure();
    }
  }, [onFailure]);
  return createPortal(
    <dialog
      ref={dialog}
      className="run-dialog dungeon-dialog"
      aria-label="Catacomb Quest"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="dungeon-dialog-content">{children}</div>
    </dialog>,
    document.body,
  );
}

class DungeonBoundary extends Component<
  { readonly onFailure: () => void; readonly children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch() {
    this.props.onFailure();
  }

  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

export default function DungeonScreen({
  view,
  artwork,
  notice,
  client,
  send,
  onClose,
  onFailure,
}: {
  readonly view: DungeonView;
  readonly artwork: DungeonArtwork | null;
  readonly notice: string | null;
  readonly client: string;
  readonly send: (input: DungeonRequest) => Promise<DungeonView | null>;
  readonly onClose: () => void;
  readonly onFailure: () => void;
}) {
  if (view.phase === "preparing" || view.phase === "cancelled") return null;
  return (
    <>
      {notice && <output className="dungeon-notice">{notice}</output>}
      {artwork?.cat === view.cat ? (
        <DungeonBoundary key={view.nonce} onFailure={onFailure}>
          <DungeonStage
            view={view}
            artwork={artwork}
            client={client}
            send={send}
            onDone={onClose}
            onFailure={onFailure}
          />
        </DungeonBoundary>
      ) : (
        <output className="dungeon-loading">Loading the catacombs…</output>
      )}
    </>
  );
}
