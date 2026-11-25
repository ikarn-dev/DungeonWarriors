import Image from "next/image";
import { WARRIORS } from "../lib/dungeon/warriors";
import { CAT_NAMES, type LobbyState } from "../lib/game/lobby-state";
import { warriorAvatar } from "../lib/game/warrior-avatars";
import { WarriorIcon } from "./WarriorIcon";
import { WarriorStats, WarriorTraits } from "./WarriorStats";

// Selected warrior on the Play window: the painted avatar alone on the left;
// name, badges, stat bars and traits on the right.
export function LobbyHero({
  cat,
}: {
  readonly cat: LobbyState["cats"][number];
}) {
  const warrior = WARRIORS[cat.id];
  return (
    <div className="bet-hero">
      <span className="bet-hero-portrait">
        <Image
          src={warriorAvatar(cat.id)}
          alt=""
          width={1254}
          height={1254}
          sizes="9rem"
        />
      </span>
      <div className="bet-hero-body">
        <h3>{CAT_NAMES[cat.id]}</h3>
        <p className="bet-hero-badges">
          <span className="bet-badge" data-rarity={cat.rarity}>
            {cat.rarity}
          </span>
          <span className="bet-badge">
            <WarriorIcon name={warrior.weapon} />
            {warrior.title}
          </span>
        </p>
        <WarriorStats cat={cat.id} />
        <WarriorTraits cat={cat.id} />
      </div>
    </div>
  );
}
