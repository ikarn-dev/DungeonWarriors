import Image from "next/image";
import type { ReactNode } from "react";
import { MEDIA_ROOT } from "../lib/game/assets";
import { type CatId, catStats } from "../lib/game/catalog";
import { CAT_NAMES, type LobbyState } from "../lib/game/lobby-state";
import { POWER_LABELS } from "./RunHud";

export type LobbyTab =
  | "play"
  | "cats"
  | "shop"
  | "wallet"
  | "history"
  | "leaderboard";
const TABS = [
  ["play", "Play"],
  ["cats", "Cats"],
  ["shop", "Shop"],
  ["wallet", "Wallet"],
  ["history", "History"],
  ["leaderboard", "Leaderboard"],
] as const;

// Title-screen style menu. Every section stays mounted so an open run, a
// pending draw or an account read survives switching sections.
export function LobbyMenu({
  tab,
  onTab,
  cursor,
  panels,
}: {
  readonly tab: LobbyTab;
  readonly onTab: (tab: LobbyTab) => void;
  readonly cursor: CatId | null;
  readonly panels: Readonly<Record<LobbyTab, ReactNode>>;
}) {
  return (
    <div className="lobby-menu-layout">
      <nav className="lobby-menu" aria-label="Lobby sections">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            className="pixel-button lobby-menu-item"
            data-tone={tab === id ? "gold" : undefined}
            aria-pressed={tab === id}
            aria-controls={`lobby-${id}`}
            onClick={() => onTab(id)}
          >
            <span className="lobby-cursor" aria-hidden="true">
              {tab === id && cursor && (
                <Image
                  unoptimized
                  src={`${MEDIA_ROOT}/portrait-${cursor}.svg`}
                  alt=""
                  width={32}
                  height={32}
                />
              )}
            </span>
            {label}
          </button>
        ))}
      </nav>
      {TABS.map(([id, label]) => (
        <section
          key={id}
          id={`lobby-${id}`}
          className="lobby-panel pixel-panel"
          aria-label={label}
          hidden={tab !== id}
        >
          {panels[id]}
        </section>
      ))}
    </div>
  );
}

export function LobbyHero({
  cat,
}: {
  readonly cat: LobbyState["cats"][number];
}) {
  const stats = catStats(cat.id, cat.level);
  return (
    <div className="lobby-hero">
      <span className="lobby-hero-art">
        <Image
          unoptimized
          src={`${MEDIA_ROOT}/portrait-${cat.id}.svg`}
          alt=""
          width={80}
          height={80}
        />
      </span>
      <div className="lobby-hero-copy">
        <h2>{CAT_NAMES[cat.id]}</h2>
        <p className="lobby-hero-tags">
          <span className="lobby-rarity" data-rarity={cat.rarity}>
            {cat.rarity}
          </span>
          <span className="lobby-rarity">Lv {cat.level}</span>
        </p>
        <p>
          {POWER_LABELS[stats.power]} · {stats.powerCooldownTicks / 60}s
          cooldown
        </p>
      </div>
    </div>
  );
}
