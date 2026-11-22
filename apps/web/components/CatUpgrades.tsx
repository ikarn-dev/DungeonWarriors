import { useState } from "react";
import { CATALOG_V1, catStats } from "../lib/game/catalog";
import type { PlayerIntent } from "../lib/game/custody-client";
import { CAT_NAMES, type LobbyState } from "../lib/game/lobby-state";
import { LobbySegment } from "./LobbySegment";

const count = new Intl.NumberFormat("en-US");

export default function CatUpgrades({
  state,
  blocked,
  action,
}: {
  readonly state: LobbyState;
  readonly blocked: boolean;
  readonly action: (value: PlayerIntent["action"]) => void;
}) {
  const upgradable = state.cats.filter(
    (cat) =>
      cat.level < CATALOG_V1.maxCatLevel &&
      state.definingCatalogs[cat.id] === 1,
  );
  const [chosen, setChosen] = useState(state.selected);
  const target =
    upgradable.find((cat) => cat.id === chosen) ?? upgradable[0] ?? null;
  const owned = CATALOG_V1.upgrades.some(
    (grade) => BigInt(state.upgrades[grade.rarity] ?? "0") > 0n,
  );
  return (
    <section className="lobby-stack" aria-label="Upgrades">
      <h3>Upgrades</h3>
      {target === null ? (
        <p>Every cat is at level 5.</p>
      ) : !owned ? (
        <p>Upgrade capsules from the Shop raise a cat&apos;s level.</p>
      ) : (
        <>
          {upgradable.length > 1 && (
            <LobbySegment
              label="Cat to upgrade"
              options={upgradable.map(
                (cat) => [cat.id, CAT_NAMES[cat.id]] as const,
              )}
              value={target.id}
              onChange={setChosen}
            />
          )}
          <ul className="lobby-rows">
            {CATALOG_V1.upgrades.map((grade) => {
              const quantity = BigInt(state.upgrades[grade.rarity] ?? "0");
              const next = Math.min(
                CATALOG_V1.maxCatLevel,
                target.level + grade.levelGain,
              );
              const cooldown =
                catStats(target.id, next).powerCooldownTicks / 60;
              return (
                <li key={grade.rarity}>
                  <span className="lobby-rarity" data-rarity={grade.rarity}>
                    {grade.rarity}
                  </span>
                  <span className="lobby-row-main">
                    × {count.format(quantity)}
                  </span>
                  <span className="lobby-row-detail">
                    Lv {target.level} → {next} · {cooldown}s cooldown
                  </span>
                  <button
                    type="button"
                    className="pixel-button"
                    data-tone="green"
                    disabled={
                      blocked ||
                      state.pendingDraw !== null ||
                      quantity === 0n ||
                      state.inventoryVersion === null
                    }
                    onClick={() => {
                      if (state.inventoryVersion === null) return;
                      action({
                        kind: "applyUpgrade",
                        grade: grade.rarity,
                        cat: target.id,
                        level: target.level,
                        definingCatalogVersion: 1,
                        inventoryVersion: state.inventoryVersion.toString(),
                      });
                    }}
                  >
                    Apply
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
