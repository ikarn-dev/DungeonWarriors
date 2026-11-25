import Image from "next/image";
import { useId } from "react";
import type { Weapon } from "../lib/dungeon/warriors";
import { WarriorIcon } from "./WarriorIcon";

// Rarity gems above each portrait: one for common, two rare, three epic.
const GEMS: Readonly<Record<string, number>> = { common: 1, rare: 2, epic: 3 };

// Scroll-curl ornament for the frame's top corners; CSS mirrors it.
function FrameCurl({
  side,
  metal,
}: {
  readonly side: "l" | "r";
  readonly metal: string;
}) {
  return (
    <svg
      className="hero-curl"
      data-side={side}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        d="M3 22V9a6 6 0 0 1 6-6h13v3.5H9.5A3 3 0 0 0 6.5 9.5V22z"
        fill={metal}
        stroke="#2a1a0a"
        strokeWidth="1"
      />
      <path
        d="M9 13a3 3 0 1 1 3.4 3"
        fill="none"
        stroke={metal}
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <circle cx="9" cy="9" r="1.6" fill="#1d7f73" />
    </svg>
  );
}

// Hero-roster portrait (2026-11-24): rarity gems over a bronze frame with
// scroll corners, the painted art with its level, and a name plate with the
// class emblem. Used by the Avatars cards and the capsule reveal.
export function HeroPortrait({
  name,
  image,
  rarity,
  level,
  weapon,
  title,
  chosen = false,
  sizes,
  unoptimized = false,
}: {
  readonly name: string;
  readonly image: string;
  readonly rarity: string;
  readonly level: number | null;
  readonly weapon: Weapon | null;
  readonly title: string | null;
  readonly chosen?: boolean;
  readonly sizes: string;
  readonly unoptimized?: boolean;
}) {
  const id = useId();
  const metal = `url(#${id})`;
  return (
    <div
      className="hero-portrait"
      data-rarity={rarity}
      data-chosen={chosen || undefined}
    >
      <svg className="title-defs" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#f5dfae" />
            <stop offset="0.35" stopColor="#b88a45" />
            <stop offset="0.6" stopColor="#f0d49a" />
            <stop offset="1" stopColor="#6e4a1e" />
          </linearGradient>
        </defs>
      </svg>
      <span className="hero-gems" aria-hidden="true">
        {Array.from({ length: GEMS[rarity] ?? 1 }, (_, i) => (
          <span key={`gem-${i + 1}`} />
        ))}
      </span>
      <FrameCurl side="l" metal={metal} />
      <FrameCurl side="r" metal={metal} />
      <div className="hero-frame">
        <div className="hero-art">
          <Image
            src={image}
            alt=""
            width={1254}
            height={1254}
            sizes={sizes}
            unoptimized={unoptimized}
          />
          {level !== null && <span className="hero-level">Lv. {level}</span>}
        </div>
        <p className="hero-plate">
          {weapon && (
            <span className="hero-emblem" title={title ?? undefined}>
              <WarriorIcon name={weapon} />
            </span>
          )}
          <span className="hero-name">{name}</span>
        </p>
      </div>
    </div>
  );
}
