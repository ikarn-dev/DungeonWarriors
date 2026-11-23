import { useMemo } from "react";
import {
  formatRunPrice,
  type RunPrice,
  runPricePath,
} from "../lib/game/run-price";

export default function RunMarket({
  market,
  prices,
}: {
  market: string;
  prices: readonly RunPrice[];
}) {
  const path = useMemo(() => runPricePath(prices), [prices]);
  const latest = prices.at(-1);
  if (!latest) return null;
  return (
    <div className="run-market pixel-panel" data-course="platform-course-v3">
      <div className="flex items-baseline justify-between gap-2">
        <span>{market}/USD</span>
        <strong
          className="font-mono tabular-nums"
          title={`$${formatRunPrice(latest)}`}
        >
          ${formatRunPrice(latest, true)}
        </strong>
      </div>
      <svg
        viewBox="0 0 160 36"
        role="img"
        aria-label={`${market}/USD prices used by this run`}
      >
        {prices.length === 1 ? (
          <circle cx="2" cy="18" r="2" fill="currentColor" />
        ) : (
          <path
            d={path}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="square"
            strokeLinejoin="miter"
          />
        )}
      </svg>
    </div>
  );
}
