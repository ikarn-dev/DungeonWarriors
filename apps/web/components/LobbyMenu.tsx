import Image from "next/image";
import { type ReactNode, useEffect, useRef } from "react";
import { WARRIORS, warriorPortrait } from "../lib/dungeon/warriors";
import { CAT_NAMES, type LobbyState } from "../lib/game/lobby-state";
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
  showcase,
}: {
  readonly tab: LobbyTab | null;
  readonly onTab: (tab: LobbyTab | null) => void;
  readonly panels: Readonly<Record<LobbyTab, ReactNode>>;
  // Shown beside the options on wide screens.
  readonly showcase: ReactNode;
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
      <div className="lobby-menu-view" hidden={tab !== null}>
        <nav className="lobby-options" aria-label="Main menu">
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
        {showcase}
      </div>
      <div className="lobby-section-view" hidden={tab === null}>
        <button
          ref={back}
          type="button"
          className="pixel-button lobby-back"
          onClick={() => onTab(null)}
        >
          <UiIcon name="back" />
          Back to menu
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
      <Image
        unoptimized
        src={warriorPortrait(cat.id)}
        alt=""
        width={56}
        height={56}
      />
      <div className="bet-hero-copy">
        <h2>{CAT_NAMES[cat.id]}</h2>
        <p>
          <span className="lobby-rarity" data-rarity={cat.rarity}>
            {cat.rarity}
          </span>
        </p>
      </div>
      <p className="bet-power">
        {warrior.title} · {warrior.hp} HP · {warrior.atk} ATK · {warrior.def}{" "}
        DEF
        <span>{warrior.traits.map((t) => t.name).join(" · ")}</span>
      </p>
    </div>
  );
}
