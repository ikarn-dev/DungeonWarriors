import { useId } from "react";

// Painted bone skull for the dungeon result card after a loss (a beaten
// warrior, a trap or the gas). Decorative; the card's title says the outcome.
export function ResultSkull() {
  const id = useId();
  const bone = `${id}-bone`;
  return (
    <svg className="result-skull" viewBox="0 0 64 60" aria-hidden="true">
      <defs>
        <radialGradient id={bone} cx="0.42" cy="0.32" r="0.75">
          <stop offset="0" stopColor="#fbf3dc" />
          <stop offset="0.55" stopColor="#d9cba6" />
          <stop offset="1" stopColor="#9c8a64" />
        </radialGradient>
      </defs>
      <path
        d="M32 5C17 5 8.5 15.5 8.5 28c0 8 4 13 9.5 15.5V50a3.5 3.5 0 0 0 3.5 3.5h21a3.5 3.5 0 0 0 3.5-3.5v-6.5C51.5 41 55.5 36 55.5 28 55.5 15.5 47 5 32 5z"
        fill={`url(#${bone})`}
        stroke="#3a2e22"
        strokeWidth="1.5"
      />
      <ellipse cx="23" cy="13.5" rx="8" ry="3.5" fill="#fffdf4" opacity="0.4" />
      <path
        d="M37 6.5l-2 5.5 3 3-2.5 4.5"
        fill="none"
        stroke="#5a4732"
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <ellipse cx="22.5" cy="29" rx="6.8" ry="7.4" fill="#1a1210" />
      <ellipse cx="41.5" cy="29" rx="6.8" ry="7.4" fill="#1a1210" />
      <path d="M32 36.5l-3.6 6h7.2z" fill="#1a1210" />
      <path
        d="M24 46.5h16M26.5 46.5v7M30.8 46.5v7M35.2 46.5v7M39.5 46.5v7"
        stroke="#3a2e22"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}
