import { useId } from "react";

// Painted treasure chest for the dungeon result card: open with a warm glow
// and coins when treasure is won, shut and dimmed for a refund (a loss shows
// ResultSkull). Decorative; the
// card's title says the outcome.
export function TreasureChest({ open }: { readonly open: boolean }) {
  const id = useId();
  const wood = `${id}-wood`,
    band = `${id}-band`,
    glow = `${id}-glow`;
  return (
    <svg
      className="treasure-chest"
      data-open={open || undefined}
      viewBox="0 0 64 60"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={wood} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#a65d26" />
          <stop offset="0.55" stopColor="#6e3714" />
          <stop offset="1" stopColor="#4a220b" />
        </linearGradient>
        <linearGradient id={band} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff1b8" />
          <stop offset="0.45" stopColor="#e9b445" />
          <stop offset="1" stopColor="#8f5c16" />
        </linearGradient>
        <radialGradient id={glow} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#ffe9a0" stopOpacity="0.9" />
          <stop offset="1" stopColor="#ffd26a" stopOpacity="0" />
        </radialGradient>
      </defs>
      {open ? (
        <>
          <ellipse cx="32" cy="27" rx="30" ry="18" fill={`url(#${glow})`} />
          <path
            d="M11 28 L15 9 Q32 3 49 9 L53 28 Z"
            fill={`url(#${wood})`}
            stroke="#2a1205"
            strokeWidth="1.5"
          />
          <path
            d="M13.5 15 Q32 9.5 50.5 15"
            stroke={`url(#${band})`}
            strokeWidth="3"
            fill="none"
          />
          <rect x="10" y="26" width="44" height="7" fill="#241004" />
          <g stroke="#7a4a10" strokeWidth="0.8" fill={`url(#${band})`}>
            <ellipse cx="22" cy="27" rx="4.5" ry="2.2" />
            <ellipse cx="31" cy="25.5" rx="4.5" ry="2.2" />
            <ellipse cx="40" cy="27" rx="4.5" ry="2.2" />
            <ellipse cx="27" cy="23" rx="4.5" ry="2.2" />
            <ellipse cx="36" cy="22.5" rx="4.5" ry="2.2" />
          </g>
        </>
      ) : (
        <>
          <path
            d="M8 31 V22 Q32 9 56 22 V31 Z"
            fill={`url(#${wood})`}
            stroke="#2a1205"
            strokeWidth="1.5"
          />
          <path
            d="M10 21.5 Q32 10 54 21.5"
            stroke={`url(#${band})`}
            strokeWidth="3"
            fill="none"
          />
          <rect x="15" y="14" width="5" height="17" fill={`url(#${band})`} />
          <rect x="44" y="14" width="5" height="17" fill={`url(#${band})`} />
        </>
      )}
      <rect
        x="8"
        y="30"
        width="48"
        height="26"
        rx="2.5"
        fill={`url(#${wood})`}
        stroke="#2a1205"
        strokeWidth="1.5"
      />
      <rect x="8" y="30" width="48" height="4" fill={`url(#${band})`} />
      <rect x="8" y="51" width="48" height="4" rx="1" fill={`url(#${band})`} />
      <rect x="15" y="30" width="5" height="25" fill={`url(#${band})`} />
      <rect x="44" y="30" width="5" height="25" fill={`url(#${band})`} />
      <rect
        x="27.5"
        y={open ? 35 : 29}
        width="9"
        height="11"
        rx="1.5"
        fill={`url(#${band})`}
        stroke="#7a4a10"
        strokeWidth="0.8"
      />
      <path
        d={open ? "M32 38.5v3.5" : "M32 32.5v3.5"}
        stroke="#3b2204"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
