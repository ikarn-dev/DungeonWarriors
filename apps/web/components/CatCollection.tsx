import type { CatId } from "../lib/game/catalog";
import { CAT_NAMES, type LobbyState } from "../lib/game/lobby-state";
export default function CatCollection({
  state,
  blocked,
  onSelect,
}: {
  state: LobbyState;
  blocked: boolean;
  onSelect: (cat: CatId) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Your cats</h2>
      {state.cats.length === 0 ? (
        <p>No finalized cats yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {state.cats.map((cat) => (
            <li
              key={cat.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-current/30 p-4"
            >
              <div className="flex items-center gap-3">
                <Image
                  unoptimized
                  src={`/game-assets/v1/portrait-${cat.id}.svg`}
                  width={56}
                  height={56}
                  alt=""
                />
                <div>
                  <p className="font-medium">{CAT_NAMES[cat.id]}</p>
                  <p className="text-sm capitalize">
                    {cat.rarity} · Level{" "}
                    <span className="font-mono tabular-nums">
                      {new Intl.NumberFormat("en-US").format(cat.level)}
                    </span>
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="min-h-11 rounded-md border border-current px-4 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={
                  blocked ||
                  state.pendingDraw !== null ||
                  state.selected === cat.id
                }
                onClick={() => onSelect(cat.id)}
              >
                {state.selected === cat.id ? "Selected" : "Select cat"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

import Image from "next/image";
