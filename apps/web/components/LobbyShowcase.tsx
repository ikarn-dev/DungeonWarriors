import Image from "next/image";
import { WARRIORS, warriorPortrait } from "../lib/dungeon/warriors";
import { CAT_NAMES, type LobbyState } from "../lib/game/lobby-state";

// Desktop main menu: the selected warrior on a pedestal beside the options.
export function LobbyShowcase({
  cat,
  onViewCats,
}: {
  readonly cat: LobbyState["cats"][number];
  readonly onViewCats: () => void;
}) {
  const warrior = WARRIORS[cat.id];
  return (
    <aside className="lobby-showcase" aria-label="Selected warrior">
      <div className="lobby-showcase-stage">
        <span className="lobby-showcase-pedestal" aria-hidden="true" />
        <Image
          unoptimized
          src={warriorPortrait(cat.id)}
          alt=""
          width={128}
          height={128}
          className="lobby-showcase-cat"
        />
      </div>
      <div className="lobby-showcase-card pixel-panel">
        <h2 className="lobby-showcase-name metal-text">{CAT_NAMES[cat.id]}</h2>
        <p className="lobby-showcase-role">
          <span className="lobby-rarity" data-rarity={cat.rarity}>
            {cat.rarity}
          </span>
          {warrior.title}
        </p>
        <dl className="lobby-showcase-stats">
          <div>
            <dt>HP</dt>
            <dd>{warrior.hp}</dd>
          </div>
          <div>
            <dt>ATK</dt>
            <dd>{warrior.atk}</dd>
          </div>
          <div>
            <dt>DEF</dt>
            <dd>{warrior.def}</dd>
          </div>
        </dl>
        <ul className="lobby-traits">
          {warrior.traits.map((trait) => (
            <li key={trait.id} title={trait.description}>
              {trait.name}
            </li>
          ))}
        </ul>
        <button type="button" className="pixel-button" onClick={onViewCats}>
          View cats
        </button>
      </div>
    </aside>
  );
}
