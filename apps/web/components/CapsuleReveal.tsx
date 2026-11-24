"use client";

import Image from "next/image";
import { useEffect, useId, useRef, useState } from "react";
import { lobbySounds } from "../lib/audio/lobby-sounds";
import { WARRIORS, warriorPortrait } from "../lib/dungeon/warriors";
import { MEDIA_ROOT } from "../lib/game/assets";
import { displayUsdc } from "../lib/game/custody-client";
import {
  CAT_NAMES,
  type CapsuleKind,
  type CapsuleReceipt,
  type LobbyState,
} from "../lib/game/lobby-state";
import DotsLoader from "./DotsLoader";
import { LobbySoundToggle } from "./LobbySound";

export default function CapsuleReveal({
  kind,
  receipt,
  cats,
  retry,
  onClose,
  onViewCats,
}: {
  kind: CapsuleKind;
  receipt: CapsuleReceipt | null;
  cats: LobbyState["cats"];
  retry: (() => void) | undefined;
  onClose: () => void;
  onViewCats: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  const [showResult, setShowResult] = useState(false);
  const reward = showResult ? receipt?.reward : null;
  const refunded = showResult && receipt?.status === "refunded";
  const cat =
    reward?.kind === "cat"
      ? cats.find((item) => item.id === reward.id)
      : undefined;
  const rarity = reward?.kind === "upgrade" ? reward.rarity : cat?.rarity;

  useEffect(() => {
    const surface = dialog.current;
    if (surface && !surface.open) surface.showModal();
    const timer = setTimeout(
      () => setShowResult(true),
      matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 1500,
    );
    return () => clearTimeout(timer);
  }, []);
  const revealed = reward != null;
  useEffect(() => {
    if (revealed) lobbySounds.reveal();
  }, [revealed]);

  return (
    <dialog
      ref={dialog}
      className="gacha-dialog"
      aria-labelledby={title}
      onClose={onClose}
    >
      <div className="gacha-stage" data-revealed={revealed || undefined}>
        <div className="gacha-controls">
          <LobbySoundToggle />
          <button
            type="button"
            className="pixel-button"
            onClick={() => dialog.current?.close()}
          >
            Close
          </button>
        </div>
        <div className="gacha-field" aria-hidden="true">
          <div className="gacha-halo" />
        </div>
        {reward ? (
          <div className="gacha-content">
            <article className="gacha-card" data-rarity={rarity}>
              <div className="gacha-card-body">
                <header className="gacha-card-header">
                  <h2 id={title} aria-live="polite">
                    {reward.kind === "cat"
                      ? CAT_NAMES[reward.id]
                      : "Upgrade capsule"}
                  </h2>
                  {rarity && <span className="gacha-rarity">{rarity}</span>}
                </header>
                <div className="gacha-portrait">
                  <Image
                    unoptimized
                    src={
                      reward.kind === "cat"
                        ? warriorPortrait(reward.id)
                        : `${MEDIA_ROOT}/upgrade-item.svg`
                    }
                    alt=""
                    width={224}
                    height={224}
                  />
                </div>
                <footer className="gacha-card-footer">
                  <span>
                    {reward.kind === "cat"
                      ? "Cat unlocked"
                      : "Upgrade unlocked"}
                  </span>
                  {cat && <span>{WARRIORS[cat.id].title}</span>}
                </footer>
              </div>
            </article>
            <button
              type="button"
              className="pixel-button"
              data-tone="gold"
              onClick={() => {
                dialog.current?.close();
                onViewCats();
              }}
            >
              View cats
            </button>
          </div>
        ) : (
          <div className="gacha-content">
            {!refunded && (
              <div className="gacha-machine" aria-hidden="true">
                <Image
                  unoptimized
                  src="/gacha-machine.svg"
                  alt=""
                  width={224}
                  height={252}
                />
                <span className="gacha-capsule">
                  <Image
                    unoptimized
                    src={`${MEDIA_ROOT}/capsule-base.svg`}
                    alt=""
                    width={64}
                    height={64}
                  />
                  <Image
                    unoptimized
                    src={`${MEDIA_ROOT}/capsule-lid.svg`}
                    alt=""
                    width={64}
                    height={64}
                  />
                </span>
              </div>
            )}
            <h2 id={title}>
              {refunded
                ? "Capsule refunded"
                : kind === "upgrade"
                  ? "Opening upgrade capsule"
                  : "Summoning your cat"}
            </h2>
            {refunded && receipt ? (
              <p>
                {displayUsdc(receipt.cost)} USDC returned to your PURRPS
                balance.
              </p>
            ) : retry ? (
              <p>We couldn't check your capsule yet.</p>
            ) : (
              <DotsLoader label="Opening your capsule" />
            )}
            {!refunded && retry && (
              <button type="button" className="pixel-button" onClick={retry}>
                Check draw
              </button>
            )}
          </div>
        )}
      </div>
    </dialog>
  );
}
