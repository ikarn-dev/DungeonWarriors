import Image from "next/image";
import { type ReactNode, useEffect, useRef } from "react";
import { WARRIORS } from "../lib/dungeon/warriors";
import { CAT_NAMES, type LobbyState } from "../lib/game/lobby-state";
import { warriorAvatar } from "../lib/game/warrior-avatars";
import FrameCorners from "./FrameCorners";
import { UiIcon } from "./UiIcon";

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

// Main menu: only the options until one is chosen, then that section's card
// with a way back (also Escape). Every section stays mounted so an open run,
// a pending draw or an account read survives returning to the menu.
export function LobbyMenu({
  tab,
  onTab,
  panels,
}: {
  readonly tab: LobbyTab | null;
  readonly onTab: (tab: LobbyTab | null) => void;
  readonly panels: Readonly<Record<LobbyTab, ReactNode>>;
}) {
  const options = useRef(new Map<LobbyTab, HTMLButtonElement>());
  const back = useRef<HTMLButtonElement>(null);
  const shown = useRef(tab);
  // Move focus with the view: into the card on open, back to the option
  // that opened it on return. Nothing moves on first render.
  useEffect(() => {
    const previous = shown.current;
    shown.current = tab;
    if (previous === tab) return;
    if (tab !== null) back.current?.focus();
    else if (previous !== null) options.current.get(previous)?.focus();
  }, [tab]);
  useEffect(() => {
    if (tab === null) return;
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // An open dialog (a dungeon run, a capsule reveal, the wallet picker)
      // handles its own Escape.
      if (document.querySelector("dialog[open]")) return;
      onTab(null);
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [tab, onTab]);
  return (
    <div className="lobby-menu-layout">
      <nav
        className="lobby-options"
        aria-label="Main menu"
        hidden={tab !== null}
      >
        <ul>
          {TABS.map(([id, label]) => (
            <li key={id}>
              <button
                ref={(node) => {
                  if (node) options.current.set(id, node);
                  return () => {
                    options.current.delete(id);
                  };
                }}
                type="button"
                className="lobby-option"
                onClick={() => onTab(id)}
              >
                <span className="lobby-option-plate" aria-hidden="true">
                  <span className="lobby-option-face" />
                </span>
                <svg
                  className="lobby-option-gem"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path d="M12 1.5 22.5 12 12 22.5 1.5 12Z" />
                  <path d="M12 6.5 17.5 12 12 17.5 6.5 12Z" />
                  <path d="M12 6.5 17.5 12H12Z" />
                </svg>
                <span className="lobby-option-label metal-text">{label}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <div className="lobby-section-view" hidden={tab === null}>
        <FrameCorners corners={["tl", "bl", "br"]} />
        <button
          ref={back}
          type="button"
          className="pixel-button lobby-close"
          data-shape="round"
          aria-label="Back to menu"
          title="Back to menu (Esc)"
          onClick={() => onTab(null)}
        >
          <UiIcon name="cross" size={18} />
        </button>
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
    </div>
  );
}

export function LobbyHero({
  cat,
}: {
  readonly cat: LobbyState["cats"][number];
}) {
  const warrior = WARRIORS[cat.id];
  return (
    <div className="bet-hero">
      <span className="bet-hero-portrait">
        <Image src={warriorAvatar(cat.id)} alt="" width={64} height={64} />
      </span>
      <div className="bet-hero-copy">
        <h3>{CAT_NAMES[cat.id]}</h3>
        <p>
          <span className="lobby-rarity" data-rarity={cat.rarity}>
            {cat.rarity}
          </span>
          {warrior.title}
        </p>
      </div>
      <dl className="bet-hero-stats">
        <div>
          <dt>HP</dt>
          <dd>{warrior.hp}</dd>
        </div>
        <div>
          <dt>ATK</dt>
          <dd>{warrior.atk}</dd>
        </div>
        <div>
          <dt>DEF</dt>
          <dd>{warrior.def}</dd>
        </div>
      </dl>
      <ul className="bet-hero-traits" aria-label="Traits">
        {warrior.traits.map((trait) => (
          <li key={trait.id} title={trait.description}>
            {trait.name}
          </li>
        ))}
      </ul>
    </div>
  );
}
