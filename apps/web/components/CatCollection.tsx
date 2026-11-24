import Image from "next/image";
import { WARRIORS, warriorPortrait } from "../lib/dungeon/warriors";
import type { CatId } from "../lib/game/catalog";
import { CAT_NAMES, type LobbyState } from "../lib/game/lobby-state";

export default function CatCollection({
  state,
  blocked,
  selected,
  onSelect,
}: {
  state: LobbyState;
  blocked: boolean;
  selected: CatId | null;
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
            const warrior = WARRIORS[cat.id];
            const chosen = selected === cat.id;
            return (
              <li
                key={cat.id}
                className="lobby-card"
                data-chosen={chosen || undefined}
              >
                <Image
                  unoptimized
                  src={warriorPortrait(cat.id)}
                  width={96}
                  height={96}
                  alt=""
                />
                <h3>{CAT_NAMES[cat.id]}</h3>
                <p>
                  <span className="lobby-rarity" data-rarity={cat.rarity}>
                    {cat.rarity}
                  </span>{" "}
                </p>
                <p className="lobby-card-title">{warrior.title}</p>
                <p className="lobby-card-stats">
                  {warrior.hp} HP · {warrior.atk} ATK · {warrior.def} DEF
                </p>
                <ul className="lobby-traits">
                  {warrior.traits.map((t) => (
                    <li key={t.id} title={t.description}>
                      {t.name}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  className="pixel-button"
                  data-tone={chosen ? undefined : "green"}
                  disabled={blocked || chosen}
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
