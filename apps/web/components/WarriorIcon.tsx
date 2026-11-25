import type { TraitId, Weapon } from "../lib/dungeon/warriors";

export type StatIcon = "hp" | "atk" | "def";
export type HudIcon = "gas" | "foe" | "left" | "right" | "jump" | "gate";
export type WalletIcon =
  | "chest"
  | "purse"
  | "coins"
  | "gem"
  | "lock"
  | "bag"
  | "deposit"
  | "withdraw";

// One line-icon set for the warrior tile, wallet and dungeon HUD: 24 × 24 grid, 2px round strokes,
// current text colour, decorative (the adjacent text names each one).
const PATHS = {
  hp: "M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z",
  atk: "M19 5l-8 8M19 5h-4M19 5v4M7 11l6 6M9 15l-4 4",
  def: "M12 3l7 3v5c0 5-3.5 8-7 10-3.5-2-7-5-7-10V6z",
  gas: "M12 3c3 4 6 6 6 10a6 6 0 0 1-12 0c0-4 3-6 6-10z",
  foe: "M12 3a8 7 0 0 1 8 7c0 3-2 5-3 6v3H7v-3c-1-1-3-3-3-6a8 7 0 0 1 8-7zM9 10h.01M15 10h.01",
  left: "M15 5l-7 7 7 7",
  right: "M9 5l7 7-7 7",
  jump: "M12 19V6M6 11l6-6 6 6M5 21h14",
  gate: "M5 21V10a7 7 0 0 1 14 0v11M5 21h14M12 21v-6",
  chest: "M4 10a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v9H4zM4 12h16M10.5 10.5h3v3.5h-3z",
  purse: "M4 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4zM4 7l11-3v3M15.5 13.5h4.5",
  coins:
    "M5 7c0-1.7 3.1-3 7-3s7 1.3 7 3-3.1 3-7 3-7-1.3-7-3zM5 7v5c0 1.7 3.1 3 7 3s7-1.3 7-3V7M5 12v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5",
  gem: "M7 4h10l4 5-9 11L3 9zM3 9h18M9 4l3 5 3-5M12 9v11",
  lock: "M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3M12 14.5v2",
  bag: "M6 8h12l-1 12H7zM9 8a3 3 0 0 1 6 0",
  deposit: "M12 3v11M7 9l5 5 5-5M4 17v3h16v-3",
  withdraw: "M12 14V3M7 8l5-5 5 5M4 17v3h16v-3",
  spear: "M4 20L14 10M14 10l1-5 5-1-1 5zM8 14l2 2",
  longsword: "M20 4L9 15M20 4h-3.5M20 4v3.5M6.5 12.5l5 5M8 16l-4 4",
  sword: "M19 5l-8 8M19 5h-4M19 5v4M7 11l6 6M9 15l-4 4",
  axe: "M5 19l9-9M12.5 5.5a6 6 0 0 1 6 6L15 13l-4-4z",
  timePouch:
    "M7 3h10M7 21h10M8 3c0 5 8 5 8 9s-8 4-8 9M16 3c0 5-8 5-8 9s8 4 8 9",
  longReach: "M3 12h14M13 8l4 4-4 4M21 6v12",
  steadyShield: "M12 3l7 3v5c0 5-3.5 8-7 10-3.5-2-7-5-7-10V6zM9 12l2 2 4-4",
  doubleJump: "M6 12l6-6 6 6M6 19l6-6 6 6",
  swiftBlade: "M20 4L10 14M7 11l6 6M8.5 15.5L5 19M3 7h4M2 11h3",
  pounce: "M12 3v11M7 9l5 5 5-5M5 19h14",
  gasMask:
    "M5 9c0-3 3-5 7-5s7 2 7 5v3c0 3.5-3 6-7 6s-7-2.5-7-6zM8 10.5h3M13 10.5h3M10 15h4",
  ironShell: "M6 4h12l2 5-3 2v9H7v-9L4 9zM12 4v16",
  shieldBash:
    "M10 4l6 2.5V11c0 4-3 6.5-6 8-3-1.5-6-4-6-8V6.5zM19 8l2.5-1M19 12h3M19 16l2.5 1",
  quickPaws: "M3 8h7M2 12h9M3 16h7M14 6l6 6-6 6",
  cleave: "M4 17a10 10 0 0 1 16 0M16.5 13.5L20 17l-4.5 1",
  berserk:
    "M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-3 2-4 2-6 1 1 2 2 2 4 1-2 1-5 1-8z",
} as const satisfies Record<
  StatIcon | HudIcon | WalletIcon | Weapon | TraitId,
  string
>;

export function WarriorIcon({ name }: { readonly name: keyof typeof PATHS }) {
  return (
    <svg
      className="warrior-icon"
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
