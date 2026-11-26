"use client";
import Image from "next/image";
import { type CSSProperties, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import LobbyBackdrop from "./LobbyBackdrop";

// The steps between Play and the dungeon opening, in order. The bar fills by
// real step, never by elapsed time.
export const QUEST_STEPS = ["prepare", "confirm", "open"] as const;
export type QuestStep = (typeof QUEST_STEPS)[number];
const LABELS: Readonly<Record<QuestStep, string>> = {
  prepare: "Preparing your quest",
  confirm: "Confirming your wager",
  open: "Opening the catacombs",
};

// Full-screen loading screen over the castle backdrop: the logo, a step bar
// and the current step. Escape only hides the screen; the quest keeps going
// and still opens when it is ready.
export function QuestLoading({
  step,
  onLobby,
}: {
  readonly step: QuestStep;
  readonly onLobby: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (dialog.current?.open) return;
    try {
      dialog.current?.showModal();
    } catch {
      onLobby();
    }
  }, [onLobby]);
  const number = QUEST_STEPS.indexOf(step) + 1;
  const fill: CSSProperties & { "--progress": string } = {
    "--progress": String(number / QUEST_STEPS.length),
  };
  return createPortal(
    <dialog
      ref={dialog}
      className="quest-loading"
      aria-label="Loading your quest"
      onCancel={(event) => {
        event.preventDefault();
        onLobby();
      }}
    >
      <LobbyBackdrop />
      <div className="quest-loading-body">
        <Image
          src="/game_logo.png"
          alt="Dungeon Warriors"
          width={1774}
          height={887}
          sizes="26rem"
          className="quest-loading-logo"
        />
        <div
          className="quest-loading-bar"
          role="progressbar"
          aria-label="Quest loading"
          aria-valuemin={1}
          aria-valuemax={QUEST_STEPS.length}
          aria-valuenow={number}
          aria-valuetext={`${LABELS[step]}, step ${number} of ${QUEST_STEPS.length}`}
        >
          <span style={fill} />
        </div>
        <p className="quest-loading-step" aria-live="polite">
          {LABELS[step]}
        </p>
        <p className="quest-loading-count">
          {number} of {QUEST_STEPS.length}
        </p>
      </div>
    </dialog>,
    document.body,
  );
}
