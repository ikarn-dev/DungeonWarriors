import { WARRIORS, type Warrior } from "../lib/dungeon/warriors";
import type { CatId } from "../lib/game/catalog";
import { type StatIcon, WarriorIcon } from "./WarriorIcon";

const ALL = Object.values(WARRIORS);
// Each bar is measured against the best of the four warriors, so a full bar
// means the strongest cat in that stat.
const STATS: readonly {
  readonly id: StatIcon;
  readonly label: string;
  readonly best: number;
}[] = [
  { id: "hp", label: "HP", best: Math.max(...ALL.map((w) => w.hp)) },
  { id: "atk", label: "ATK", best: Math.max(...ALL.map((w) => w.atk)) },
  { id: "def", label: "DEF", best: Math.max(...ALL.map((w) => w.def)) },
];
const value = (warrior: Warrior, stat: StatIcon) => warrior[stat];

// HP, ATK and DEF as icon, label, segmented gold bar and exact value.
export function WarriorStats({ cat }: { readonly cat: CatId }) {
  const warrior = WARRIORS[cat];
  return (
    <dl className="warrior-stats">
      {STATS.map((stat) => (
        <div key={stat.id}>
          <dt>
            <WarriorIcon name={stat.id} />
            {stat.label}
          </dt>
          <dd>
            <span className="bet-stat-bar" aria-hidden="true">
              <span
                style={{
                  transform: `scaleX(${value(warrior, stat.id) / stat.best})`,
                }}
              />
            </span>
            <span className="bet-stat-value">{value(warrior, stat.id)}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

// The three trait chips; each description is the tooltip.
export function WarriorTraits({ cat }: { readonly cat: CatId }) {
  return (
    <ul className="warrior-traits" aria-label="Traits">
      {WARRIORS[cat].traits.map((trait) => (
        <li key={trait.id} title={trait.description}>
          <WarriorIcon name={trait.id} />
          {trait.name}
        </li>
      ))}
    </ul>
  );
}
