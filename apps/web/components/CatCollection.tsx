import { WARRIORS } from "../lib/dungeon/warriors";
import type { CatId } from "../lib/game/catalog";
import { CAT_NAMES, type LobbyState } from "../lib/game/lobby-state";
import { warriorAvatar } from "../lib/game/warrior-avatars";
import { HeroPortrait } from "./HeroPortrait";
import { UiIcon } from "./UiIcon";
import { WarriorStats } from "./WarriorStats";

// Collection: one portrait card per owned cat, in the style of a hero
// roster: rarity gems, a bronze frame with scroll corners, the level and a
// class emblem on the art, a name plate, then stats and Select.
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
        <h2>Avatars</h2>
      </header>
      {state.cats.length === 0 ? (
        <p>No finalized cats yet.</p>
      ) : (
        <ul className="hero-cards">
          {state.cats.map((cat) => {
            const warrior = WARRIORS[cat.id];
            const chosen = selected === cat.id;
            return (
              <li
                key={cat.id}
                className="hero-card"
                data-rarity={cat.rarity}
                data-chosen={chosen || undefined}
              >
                <HeroPortrait
                  name={CAT_NAMES[cat.id]}
                  image={warriorAvatar(cat.id)}
                  rarity={cat.rarity}
                  level={cat.level}
                  weapon={warrior.weapon}
                  title={warrior.title}
                  chosen={chosen}
                  sizes="12rem"
                />
                <div className="hero-body">
                  <p className="hero-role">
                    <span className="sr-only">{cat.rarity} · </span>
                    {warrior.title}
                  </p>
                  <WarriorStats cat={cat.id} />
                  <button
                    type="button"
                    className="hero-select"
                    aria-pressed={chosen}
                    disabled={blocked || chosen}
                    onClick={() => onSelect(cat.id)}
                  >
                    <span className="hero-select-face">
                      {chosen && <UiIcon name="check" size={14} />}
                      {chosen ? "Selected" : "Select"}
                    </span>
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
