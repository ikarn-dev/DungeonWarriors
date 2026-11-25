import Image from "next/image";
import { displayMultiplier } from "../lib/dungeon/format";
import { type DungeonRules, payout as roomPayout } from "../lib/dungeon/rules";
import type { DungeonFrame } from "../lib/dungeon/simulation";
import { WARRIORS } from "../lib/dungeon/warriors";
import type { CatId } from "../lib/game/catalog";
import { displayUsdc } from "../lib/game/custody-client";
import { warriorAvatar } from "../lib/game/warrior-avatars";
import { WarriorIcon } from "./WarriorIcon";

// Dungeon HUD (2026-11-24): metal plates in the lobby's style. The hero plate
// on the left, the room in the middle with what clearing it pays, time and
// treasure on the right. The plates share one height.
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
  rules,
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
  readonly rules: DungeonRules;
  readonly playing: boolean;
}) {
  const warrior = WARRIORS[cat];
  const hp = frame?.hp ?? warrior.hp;
  const share = Math.max(0, Math.min(1, hp / warrior.hp));
  const wardens = frame?.enemies.filter((e) => e.kind === "warden").length ?? 0;
  const foes = (frame?.enemies.length ?? 0) - wardens;
  const urgent = remainingMs < 5000;
  // What the wager returns (stake included) if this room is cleared.
  const prize =
    room < maxRooms && room < rules.rooms && BigInt(stake) > 0n
      ? roomPayout(BigInt(stake), room + 1, rules).toString()
      : null;
  return (
    <div className="dungeon-hud">
      <section className="hud-plate hud-hero" aria-label="Your warrior">
        <span className="hud-portrait">
          <Image
            src={warriorAvatar(cat)}
            alt=""
            width={1254}
            height={1254}
            sizes="3.5rem"
          />
        </span>
        <div className="hud-hero-body">
          <p className="hud-name">{warrior.name}</p>
          <div
            className="hud-health"
            data-low={share <= 0.3 || undefined}
            aria-hidden="true"
          >
            <span
              className="hud-health-trail"
              style={{ transform: `scaleX(${share})` }}
            />
            <span
              className="hud-health-fill"
              style={{ transform: `scaleX(${share})` }}
            />
            <strong>
              {hp} / {warrior.hp}
            </strong>
          </div>
          <meter className="sr-only" min={0} max={warrior.hp} value={hp}>
            Health {hp} of {warrior.hp}
          </meter>
          <p className="hud-stats">
            <span title="Attack">
              <WarriorIcon name="atk" /> {warrior.atk}
            </span>
            <span title="Defence">
              <WarriorIcon name="def" /> {warrior.def}
            </span>
            <span className="hud-traits">
              {warrior.traits.map((t) => (
                <span key={t.id} title={`${t.name}: ${t.description}`}>
                  <WarriorIcon name={t.id} />
                  <span className="sr-only">{t.name}</span>
                </span>
              ))}
            </span>
          </p>
        </div>
      </section>
      <section className="hud-plate hud-floor" aria-label="Expedition progress">
        <div className="hud-floor-head">
          <p className="hud-label">
            Room <strong>{Math.min(room + 1, maxRooms)}</strong> of {maxRooms}
          </p>
          <ol className="hud-pips">
            {Array.from({ length: maxRooms }, (_, i) => (
              <li
                key={`room-${i + 1}`}
                data-state={
                  i < cleared ? "done" : i === room ? "here" : "ahead"
                }
              />
            ))}
          </ol>
        </div>
        {prize && (
          <p className="hud-prize">
            <span>Clear</span>
            <strong>{displayMultiplier(prize, stake)}</strong>
            <span className="hud-prize-value">{displayUsdc(prize)} USDC</span>
          </p>
        )}
        {playing && (
          <p className="hud-foes" data-open={wardens === 0 || undefined}>
            <WarriorIcon name={wardens === 0 ? "gate" : "foe"} />
            {wardens === 0
              ? "Gates open"
              : `${wardens} ${wardens === 1 ? "warden" : "wardens"} · ${foes} ${foes === 1 ? "foe" : "foes"}`}
          </p>
        )}
      </section>
      <div className="hud-right">
        <section
          className="hud-plate hud-timer"
          data-urgent={urgent || undefined}
          aria-label="Room time remaining"
          role="timer"
        >
          <p className="hud-label">
            <WarriorIcon name="gas" /> {graceActive ? "Gas mask" : "Gas in"}
          </p>
          <strong>{(remainingMs / 1000).toFixed(1)} s</strong>
        </section>
        <section className="hud-plate hud-cash" aria-label="Treasure">
          <p className="hud-label">{playing ? "Treasure" : "Cash out"}</p>
          <strong>{displayUsdc(payout)}</strong>
          <small>USDC · {displayMultiplier(payout, stake)}</small>
        </section>
      </div>
    </div>
  );
}
