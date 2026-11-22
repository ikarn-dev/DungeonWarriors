import Image from "next/image";
import type { ReactNode } from "react";
import { MEDIA_ROOT } from "../lib/game/assets";
import type { CatId, Power } from "../lib/game/catalog";
import { CAT_NAMES } from "../lib/game/lobby-state";
import { RULES_V1, runLevel } from "../lib/game/rules";
import type { RunPrice } from "../lib/game/run-price";
import type { SimulationFrame } from "../lib/game/simulation-state";
import RunMarket from "./RunMarket";

const count = new Intl.NumberFormat("en-US");
const COIN_SLOTS = ["slot-0", "slot-1", "slot-2", "slot-3", "slot-4"] as const;
export const POWER_LABELS: Record<Power, string> = {
  magnet: "Magnet",
  doubleJump: "Double jump",
  shield: "Shield",
  extraDash: "Extra dash",
};

export function RunHud({
  frame,
  cat,
  catLevel,
  power,
  market,
  prices,
  nonce,
}: {
  readonly frame: SimulationFrame;
  readonly cat: CatId;
  readonly catLevel: number;
  readonly power: Power;
  readonly market: string | undefined;
  readonly prices: readonly RunPrice[];
  readonly nonce: string;
}) {
  const progress = Number(frame.activeTicks % BigInt(RULES_V1.checkpointTicks));
  const collected = COIN_SLOTS.map((slot, bit) => ({
    slot,
    got: (frame.designatedCoinMask & (1 << bit)) !== 0,
  }));
  const found = collected.filter(({ got }) => got).length;
  const id = `checkpoint-${nonce}`;
  return (
    <div className="run-hud">
      <div className="run-hud-cat pixel-panel">
        <Image
          unoptimized
          src={`${MEDIA_ROOT}/portrait-${cat}.svg`}
          alt=""
          width={48}
          height={48}
        />
        <div>
          <p className="run-hud-name">{CAT_NAMES[cat]}</p>
          <p className="run-hud-meta">
            Lv {catLevel} · {POWER_LABELS[power]}
          </p>
        </div>
      </div>
      <div className="run-hud-checkpoint pixel-panel">
        <p className="run-hud-level">
          <span>Level</span>
          <strong>{count.format(runLevel(frame.activeTicks))}</strong>
        </p>
        <div className="run-hud-track">
          <progress
            id={id}
            aria-label="Time to the next checkpoint"
            value={progress}
            max={RULES_V1.checkpointTicks}
          />
          <ul
            className="run-hud-pips"
            aria-label={`${found} of ${RULES_V1.designatedCoins} checkpoint coins, ${RULES_V1.qualificationCoins} needed`}
          >
            {collected.map(({ slot, got }) => (
              <li key={slot} data-got={got || undefined} />
            ))}
          </ul>
        </div>
      </div>
      <dl className="run-hud-stats pixel-panel">
        <div>
          <dt>
            <span className="pixel-sprite" data-sprite="coin" />
            <span className="sr-only">Coins</span>
          </dt>
          <dd>{count.format(frame.totalCoins)}</dd>
        </div>
        <div>
          <dt>
            <span className="pixel-sprite" data-sprite="star" />
            <span className="sr-only">Score</span>
          </dt>
          <dd>{count.format(frame.score)}</dd>
        </div>
      </dl>
      {market && <RunMarket market={market} prices={prices} />}
    </div>
  );
}

export function RunPanel({
  title,
  children,
}: {
  readonly title: string;
  readonly children?: ReactNode;
}) {
  return (
    <div className="run-overlay">
      <div className="run-panel pixel-panel" aria-live="polite">
        <h4>{title}</h4>
        {children}
      </div>
    </div>
  );
}
