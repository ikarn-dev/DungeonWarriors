import Image from "next/image";
import { displayMultiplier } from "../lib/dungeon/format";
import type { DungeonFrame } from "../lib/dungeon/simulation";
import { WARRIORS, warriorPortrait } from "../lib/dungeon/warriors";
import type { CatId } from "../lib/game/catalog";
import { displayUsdc } from "../lib/game/custody-client";

function Icon({ name }: { readonly name: "atk" | "def" | "gas" | "foe" }) {
  const paths = {
    atk: "M14 2l8 0 0 8-9 9-3-3 9-9M4 16l4 4M2 22l3-3",
    def: "M12 2l8 3v6c0 5-4 9-8 11-4-2-8-6-8-11V5z",
    gas: "M12 3c3 4 6 6 6 10a6 6 0 0 1-12 0c0-4 3-6 6-10z",
    foe: "M12 3a8 7 0 0 1 8 7c0 3-2 5-3 6v3H7v-3c-1-1-3-3-3-6a8 7 0 0 1 8-7zM9 10h.01M15 10h.01",
  } as const;
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[name]} />
    </svg>
  );
}

export default function DungeonHud({
  cat,
  frame,
  room,
  maxRooms,
  cleared,
  remainingMs,
  graceActive,
  payout,
  stake,
  playing,
}: {
  readonly cat: CatId;
  readonly frame: DungeonFrame | null;
  readonly room: number;
  readonly maxRooms: number;
  readonly cleared: number;
  readonly remainingMs: number;
  readonly graceActive: boolean;
  readonly payout: string;
  readonly stake: string;
  readonly playing: boolean;
}) {
  const warrior = WARRIORS[cat];
  const hp = frame?.hp ?? warrior.hp;
  const wardens = frame?.enemies.filter((e) => e.kind === "warden").length ?? 0;
  const foes = (frame?.enemies.length ?? 0) - wardens;
  const urgent = remainingMs < 5000;
  return (
    <div className="dungeon-hud">
      <section className="hud-card hud-hero" aria-label="Your warrior">
        <Image
          unoptimized
          src={warriorPortrait(cat)}
          alt=""
          width={52}
          height={52}
        />
        <div className="hud-hero-body">
          <p className="hud-name">{warrior.name}</p>
          <div className="hud-health" aria-hidden="true">
            <span style={{ transform: `scaleX(${hp / warrior.hp})` }} />
            <strong>
              {hp} / {warrior.hp}
            </strong>
          </div>
          <meter className="sr-only" min={0} max={warrior.hp} value={hp}>
            Health {hp} of {warrior.hp}
          </meter>
          <p className="hud-stats">
            <span>
              <Icon name="atk" /> {warrior.atk}
            </span>
            <span>
              <Icon name="def" /> {warrior.def}
            </span>
          </p>
          <ul className="hud-traits" aria-label="Traits">
            {warrior.traits.map((t) => (
              <li key={t.id} title={t.description}>
                {t.name}
              </li>
            ))}
          </ul>
        </div>
      </section>
      <section className="hud-card hud-floor" aria-label="Expedition progress">
        <p>
          Room <strong>{Math.min(room + 1, maxRooms)}</strong> of {maxRooms}
        </p>
        <ol className="hud-dots">
          {Array.from({ length: maxRooms }, (_, i) => (
            <li
              key={`room-${i + 1}`}
              data-state={i < cleared ? "done" : i === room ? "here" : "ahead"}
            />
          ))}
        </ol>
        {playing && (
          <p className="hud-foes">
            <Icon name="foe" /> {foes} {foes === 1 ? "foe" : "foes"}
            <span data-open={wardens === 0 || undefined}>
              {wardens === 0
                ? "Gates open"
                : `${wardens} ${wardens === 1 ? "warden guards" : "wardens guard"} the gates`}
            </span>
          </p>
        )}
      </section>
      <section
        className="hud-card hud-timer"
        data-urgent={urgent || undefined}
        aria-label="Room time remaining"
        role="timer"
      >
        <span>
          <Icon name="gas" /> {graceActive ? "Gas mask" : "Gas in"}
        </span>
        <strong>{(remainingMs / 1000).toFixed(1)}s</strong>
      </section>
      <section className="hud-card hud-cash" aria-label="Treasure">
        <span>{playing ? "Unbanked treasure" : "Cash out"}</span>
        <strong>{displayUsdc(payout)} USDC</strong>
        <small>{displayMultiplier(payout, stake)} gross</small>
      </section>
    </div>
  );
}
