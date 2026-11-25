"use client";
import Image from "next/image";

import { useEffect, useId, useRef, useState } from "react";
import { lobbySounds } from "../lib/audio/lobby-sounds";
import { WARRIORS } from "../lib/dungeon/warriors";
import { MEDIA_ROOT } from "../lib/game/assets";
import { CATALOG_V1 } from "../lib/game/catalog";
import { displayUsdc } from "../lib/game/custody-client";
import {
  CAT_NAMES,
  type CapsuleKind,
  type CapsuleReceipt,
  type LobbyState,
} from "../lib/game/lobby-state";
import { warriorAvatar } from "../lib/game/warrior-avatars";
import DotsLoader from "./DotsLoader";
import { CLAW_MS, GachaMachine } from "./GachaMachine";
import { HeroPortrait } from "./HeroPortrait";
import { LobbySoundToggle } from "./LobbySound";

// Length of the burst before the card arrives; matches capsule-reveal.css.
const BURST_MS = 1800;
// Fixed sparkle layout (percent of the stage, size in rem, delay in ms) so
// every reveal is identical.
const SPARKLES = [
  { id: "sparkle-0", x: 18, y: 22, size: 1.4, delay: 0, tone: "gold" },
  { id: "sparkle-1", x: 76, y: 16, size: 1, delay: 120, tone: "white" },
  { id: "sparkle-2", x: 84, y: 54, size: 1.6, delay: 260, tone: "gold" },
  { id: "sparkle-3", x: 12, y: 62, size: 1.1, delay: 380, tone: "teal" },
  { id: "sparkle-4", x: 30, y: 82, size: 1.3, delay: 180, tone: "white" },
  { id: "sparkle-5", x: 68, y: 80, size: 1, delay: 460, tone: "gold" },
  { id: "sparkle-6", x: 52, y: 10, size: 0.8, delay: 320, tone: "teal" },
  { id: "sparkle-7", x: 90, y: 32, size: 0.7, delay: 540, tone: "white" },
  { id: "sparkle-8", x: 8, y: 38, size: 0.8, delay: 600, tone: "gold" },
] as const;
const rarityOf = (id: string) =>
  CATALOG_V1.cats.find((cat) => cat.id === id)?.rarity ?? "common";

// Capsule reveal (2026-11-24): the gold claw machine dips while the draw
// confirms, then the prize appears in the hero-roster frame.
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
      // The burst waits for the claw to finish its pick.
      matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : CLAW_MS,
    );
    return () => clearTimeout(timer);
  }, []);
  const revealed = reward != null;
  // Burst first (light, silhouette, sparkles, flash), then the card. Reduced
  // motion goes straight to the card.
  const [card, setCard] = useState(false);
  useEffect(() => {
    if (!revealed) return;
    lobbySounds.reveal();
    const timer = setTimeout(
      () => setCard(true),
      matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : BURST_MS,
    );
    return () => clearTimeout(timer);
  }, [revealed]);

  return (
    <dialog
      ref={dialog}
      className="reveal-dialog"
      aria-labelledby={title}
      onClose={onClose}
    >
      <div
        className="reveal-stage"
        data-revealed={revealed || undefined}
        data-burst={(revealed && !card) || undefined}
      >
        <div className="reveal-controls">
          <LobbySoundToggle />
          <button
            type="button"
            className="pixel-button"
            onClick={() => dialog.current?.close()}
          >
            Close
          </button>
        </div>
        <div className="reveal-field" aria-hidden="true">
          <div className="reveal-rays" />
        </div>
        {reward && !card ? (
          <div className="reveal-burst" aria-hidden="true">
            <span className="reveal-beams" />
            <span className="reveal-glow" />
            <span className="reveal-silhouette">
              <Image
                src={
                  reward.kind === "cat"
                    ? warriorAvatar(reward.id)
                    : `${MEDIA_ROOT}/upgrade-item.svg`
                }
                unoptimized={reward.kind !== "cat"}
                alt=""
                width={1254}
                height={1254}
                sizes="18rem"
              />
            </span>
            {SPARKLES.map((sparkle) => (
              <span
                key={sparkle.id}
                className="reveal-sparkle"
                data-tone={sparkle.tone}
                style={{
                  left: `${sparkle.x}%`,
                  top: `${sparkle.y}%`,
                  width: `${sparkle.size}rem`,
                  height: `${sparkle.size}rem`,
                  animationDelay: `${sparkle.delay}ms`,
                }}
              />
            ))}
            <span className="reveal-flash" />
          </div>
        ) : reward ? (
          <div className="reveal-content">
            <h2 id={title} className="reveal-title" aria-live="polite">
              {reward.kind === "cat" ? "New avatar" : "Upgrade"}
            </h2>
            <div className="reveal-card">
              {reward.kind === "cat" ? (
                <HeroPortrait
                  name={CAT_NAMES[reward.id]}
                  image={warriorAvatar(reward.id)}
                  rarity={rarity ?? rarityOf(reward.id)}
                  level={cat?.level ?? 1}
                  weapon={WARRIORS[reward.id].weapon}
                  title={WARRIORS[reward.id].title}
                  sizes="18rem"
                />
              ) : (
                <HeroPortrait
                  name={`${reward.rarity} upgrade`}
                  image={`${MEDIA_ROOT}/upgrade-item.svg`}
                  rarity={reward.rarity}
                  level={null}
                  weapon={null}
                  title={null}
                  sizes="18rem"
                  unoptimized
                />
              )}
            </div>
            <button
              type="button"
              className="pixel-button"
              data-tone="gold"
              onClick={() => {
                dialog.current?.close();
                onViewCats();
              }}
            >
              View avatars
            </button>
          </div>
        ) : (
          <div className="reveal-content">
            {!refunded && <GachaMachine price={null} opening={!retry} />}
            <h2 id={title} className="reveal-title">
              {refunded
                ? "Refunded"
                : kind === "upgrade"
                  ? "Opening"
                  : "Summoning"}
            </h2>
            {refunded && receipt ? (
              <p>{displayUsdc(receipt.cost)} USDC returned</p>
            ) : retry ? (
              <p>Couldn’t check your capsule yet</p>
            ) : (
              <DotsLoader label="Opening your capsule" />
            )}
            {!refunded && retry && (
              <button type="button" className="pixel-button" onClick={retry}>
                Check
              </button>
            )}
          </div>
        )}
      </div>
    </dialog>
  );
}
