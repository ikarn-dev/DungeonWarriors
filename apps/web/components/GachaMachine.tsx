import { type CSSProperties, useEffect, useId, useState } from "react";
import { WarriorIcon } from "./WarriorIcon";

// Marquee lights, in a straight row, cycling through six colours.
const LIGHTS = ["ruby", "amber", "emerald", "teal", "sapphire", "violet"];
const BULBS = Array.from({ length: 8 }, (_, i) => ({
  id: `bulb-${i}`,
  tone: LIGHTS[i % LIGHTS.length],
}));
// Mystery capsules on the floor of the cabinet: plain two-tone balls with no
// avatar or odds on them. x is the offset from the centre, in rem.
const CAPSULES = [
  { id: "ruby", x: -7.25 },
  { id: "sapphire", x: -4.35 },
  { id: "emerald", x: -1.45 },
  { id: "amethyst", x: 1.45 },
  { id: "amber", x: 4.35 },
  { id: "teal", x: 7.25 },
] as const;
// Length of the pick (move, slow drop, grab, lift, return); matches
// lobby-gacha.css. The reveal waits this long before its burst.
export const CLAW_MS = 4200;

// The claw on a long cable (it reaches above the cabinet so it never ends
// short while dropping), a hub with a gem and two prongs that close to grab.
function Claw({ metal }: { readonly metal: string }) {
  return (
    <svg className="gacha-claw" viewBox="0 0 60 210" aria-hidden="true">
      <rect x="27" y="0" width="6" height="164" rx="2" fill={metal} />
      <path
        d="M18 172c0-7 5-12 12-12s12 5 12 12z"
        fill={metal}
        stroke="#2a1a0a"
        strokeWidth="1.2"
      />
      <circle cx="30" cy="170" r="4" fill="#1d7f73" stroke="#2a1a0a" />
      <path
        className="gacha-prong"
        data-side="l"
        d="M20 172c-8 6-11 16-8 26l5 2c-2-8 0-15 6-20"
        fill={metal}
        stroke="#2a1a0a"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path
        className="gacha-prong"
        data-side="r"
        d="M40 172c8 6 11 16 8 26l-5 2c2-8 0-15-6-20"
        fill={metal}
        stroke="#2a1a0a"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Gold claw machine (2026-11-24): a boxy gold body with a marquee of
// coloured lights, a glass cabinet with the claw over a floor of mystery
// capsules, and a gold base with the price plate and the prize chute. When
// opening starts, the claw moves over a randomly chosen capsule, drops
// slowly, grabs it, lifts it and returns over the chute, where the prize
// then glows. The pick is presentation only; the draw is decided onchain.
export function GachaMachine({
  price,
  opening,
}: {
  readonly price: string | null;
  readonly opening: boolean;
}) {
  const id = useId();
  const metal = `url(#${id})`;
  // Chosen when opening starts (an effect, so server and client markup
  // match); cleared when the machine goes idle.
  const [pick, setPick] = useState<number | null>(null);
  useEffect(() => {
    setPick(opening ? Math.floor(Math.random() * CAPSULES.length) : null);
  }, [opening]);
  const target = pick === null ? undefined : CAPSULES[pick];
  const picking = opening && target !== undefined;
  // The claw's target offset, read by the pick animation in CSS.
  const rig: CSSProperties & { "--pick-x": string } = {
    "--pick-x": `${target?.x ?? 0}rem`,
  };
  return (
    <div className="gacha-machine" data-opening={picking || undefined}>
      <svg className="title-defs" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fbeab0" />
            <stop offset="0.35" stopColor="#c9963c" />
            <stop offset="0.6" stopColor="#fff3c4" />
            <stop offset="1" stopColor="#8a6120" />
          </linearGradient>
        </defs>
      </svg>
      <span className="gacha-crown" aria-hidden="true">
        {BULBS.map((bulb) => (
          <span key={bulb.id} data-tone={bulb.tone} />
        ))}
      </span>
      <div className="gacha-cabinet" style={rig}>
        <span className="gacha-rig" aria-hidden="true">
          <Claw metal={metal} />
          {target && <span className="gacha-capsule" data-tone={target.id} />}
        </span>
        <span className="gacha-pile" aria-hidden="true">
          {CAPSULES.map((capsule, i) => (
            <span
              key={capsule.id}
              className="gacha-capsule"
              data-tone={capsule.id}
              data-picked={i === pick || undefined}
              style={{ translate: `${capsule.x}rem 0` }}
            />
          ))}
        </span>
        <span className="gacha-rail" aria-hidden="true" />
        <span className="gacha-glare" aria-hidden="true" />
      </div>
      <div className="gacha-base">
        {price !== null && (
          <p className="gacha-price">
            <WarriorIcon name="coins" />
            <strong>{price}</strong>
            <span>USDC</span>
          </p>
        )}
        <span className="gacha-chute" aria-hidden="true">
          <span />
        </span>
      </div>
    </div>
  );
}
