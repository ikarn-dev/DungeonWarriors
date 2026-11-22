import Image from "next/image";
import { MEDIA_ROOT } from "../lib/game/assets";
import { type CatId, catStats } from "../lib/game/catalog";
import { CAT_NAMES, type LobbyState } from "../lib/game/lobby-state";
import { POWER_LABELS } from "./RunHud";

const level = new Intl.NumberFormat("en-US");
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
    <div className="lobby-section">
      <header className="lobby-section-head">
        <h2>Cats</h2>
      </header>
      {state.cats.length === 0 ? (
        <p>No finalized cats yet.</p>
      ) : (
        <ul className="lobby-cards">
          {state.cats.map((cat) => {
            const stats = catStats(cat.id, cat.level);
            const chosen = state.selected === cat.id;
            return (
              <li
                key={cat.id}
                className="lobby-card"
                data-chosen={chosen || undefined}
              >
                <Image
                  unoptimized
                  src={`${MEDIA_ROOT}/portrait-${cat.id}.svg`}
                  width={96}
                  height={96}
                  alt=""
                />
                <h3>{CAT_NAMES[cat.id]}</h3>
                <p>
                  <span className="lobby-rarity" data-rarity={cat.rarity}>
                    {cat.rarity}
                  </span>{" "}
                  Level {level.format(cat.level)}
                </p>
                <p>
                  {POWER_LABELS[stats.power]} · {stats.powerCooldownTicks / 60}s
                  cooldown
                </p>
                <button
                  type="button"
                  className="pixel-button"
                  data-tone={chosen ? undefined : "green"}
                  disabled={blocked || state.pendingDraw !== null || chosen}
                  onClick={() => onSelect(cat.id)}
                >
                  {chosen ? "Selected" : "Select cat"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
