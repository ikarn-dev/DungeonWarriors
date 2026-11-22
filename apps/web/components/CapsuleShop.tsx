"use client";

import Image from "next/image";
import { useCallback } from "react";
import { MEDIA_ROOT } from "../lib/game/assets";
import { CATALOG_V1, eligibleCatWeights } from "../lib/game/catalog";
import { displayUsdc, type PlayerIntent } from "../lib/game/custody-client";
import {
  CAT_NAMES,
  decodePaidDraw,
  type LobbyState,
} from "../lib/game/lobby-state";
import { webApi } from "../lib/game/web-api";
import { useFinalized } from "./account-data";

const percent = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 2,
});
const date = new Intl.DateTimeFormat("en-US", {
  timeStyle: "short",
  dateStyle: "medium",
  timeZone: "UTC",
});
type Capsule = "paidCat" | "upgrade";

function Offer({
  title,
  art,
  price,
  odds,
  reason,
  blocked,
  onBuy,
}: {
  readonly title: string;
  readonly art: readonly string[];
  readonly price: bigint;
  readonly odds: readonly (readonly [string, number])[];
  readonly reason: string | null;
  readonly blocked: boolean;
  readonly onBuy: () => void;
}) {
  return (
    <article className="lobby-offer">
      <span className="lobby-offer-art">
        {art.map((src) => (
          <Image
            key={src}
            unoptimized
            src={src}
            alt=""
            width={64}
            height={64}
          />
        ))}
      </span>
      <h3>{title}</h3>
      <p className="lobby-price">{displayUsdc(price.toString())} USDC</p>
      <dl className="lobby-odds">
        {odds.map(([name, chance]) => (
          <div key={name}>
            <dt>{name}</dt>
            <dd>{percent.format(chance)}</dd>
          </div>
        ))}
      </dl>
      <button
        type="button"
        className="pixel-button"
        data-tone="gold"
        disabled={blocked || reason !== null}
        onClick={onBuy}
      >
        Buy
      </button>
      <p className="lobby-offer-note">{reason ?? " "}</p>
    </article>
  );
}

export default function CapsuleShop({
  state,
  wallet,
  blocked,
  action,
}: {
  state: LobbyState;
  wallet: string;
  blocked: boolean;
  action: (value: PlayerIntent["action"]) => void;
}) {
  const latest =
    state.nonce !== null && state.nonce > 1n ? state.nonce - 1n : null;
  const pending = state.pendingDraw !== null;
  const loadDraw = useCallback(
    async (signal: AbortSignal) =>
      latest === null
        ? null
        : decodePaidDraw(
            await webApi(
              "/api/chain/state",
              { kind: "draw", nonce: latest.toString() },
              signal,
            ),
            wallet,
            latest,
          ),
    [latest, wallet],
  );
  // The shop still works when the last draw's status cannot be read.
  const draw = useFinalized(state.slot, loadDraw).value;
  const ownedMask = CATALOG_V1.cats.reduce(
    (mask, cat, i) =>
      state.cats.some((item) => item.id === cat.id) ? mask | (1 << i) : mask,
    0,
  );
  const pool = ownedMask === 15 ? null : eligibleCatWeights(ownedMask);
  const upgradable = state.cats.some(
    (cat) =>
      cat.level < CATALOG_V1.maxCatLevel &&
      state.definingCatalogs[cat.id] === 1,
  );
  const available = BigInt(state.available);
  const common = pending
    ? "A draw is in progress."
    : !state.allowPurchases ||
        state.inventoryVersion === null ||
        state.catalogVersion !== 1
      ? "Closed on Devnet."
      : null;
  const funds = (price: bigint) =>
    available < price
      ? `Needs ${displayUsdc(price.toString())} USDC available.`
      : null;
  const buy = (capsule: Capsule) => {
    if (
      state.nonce === null ||
      state.inventoryVersion === null ||
      state.catalogVersion !== 1
    )
      return;
    action({
      kind: "purchaseCapsule",
      capsule,
      nonce: state.nonce.toString(),
      inventoryVersion: state.inventoryVersion.toString(),
      catalogVersion: state.catalogVersion,
    });
  };
  const deadline = draw?.status === "pending" ? Number(draw.deadline) : null;
  return (
    <div className="lobby-section">
      <header className="lobby-section-head">
        <h2>Shop</h2>
      </header>
      {draw && (
        <div className="lobby-banner" aria-live="polite">
          {draw.status === "fulfilled" && <p>Last draw · {draw.reward}</p>}
          {draw.status === "refunded" && (
            <p>Refunded · {displayUsdc(draw.cost)} USDC</p>
          )}
          {draw.status === "pending" && deadline !== null && (
            <>
              <p>
                Draw in progress · {displayUsdc(draw.cost)} USDC held. Refund
                opens {date.format(new Date(deadline * 1000))} UTC.
              </p>
              {pending && latest !== null && (
                <button
                  type="button"
                  className="pixel-button"
                  disabled={blocked || Date.now() < deadline * 1000}
                  onClick={() =>
                    action({ kind: "refundCapsule", nonce: latest.toString() })
                  }
                >
                  Refund
                </button>
              )}
            </>
          )}
        </div>
      )}
      <div className="lobby-columns">
        <Offer
          title="Cat capsule"
          art={[
            `${MEDIA_ROOT}/capsule-base.svg`,
            `${MEDIA_ROOT}/capsule-lid.svg`,
          ]}
          price={CATALOG_V1.catPriceBaseUnits}
          odds={
            pool === null
              ? []
              : CATALOG_V1.cats.flatMap((cat, i) => {
                  const weight = pool.weights[i] ?? 0;
                  return weight === 0
                    ? []
                    : [[CAT_NAMES[cat.id], weight / pool.total] as const];
                })
          }
          reason={
            pool === null
              ? "You own every cat."
              : (common ?? funds(CATALOG_V1.catPriceBaseUnits))
          }
          blocked={blocked}
          onBuy={() => buy("paidCat")}
        />
        <Offer
          title="Upgrade capsule"
          art={[`${MEDIA_ROOT}/upgrade-item.svg`]}
          price={CATALOG_V1.upgradePriceBaseUnits}
          odds={CATALOG_V1.upgrades.map(
            (grade) =>
              [
                `${grade.rarity[0]?.toUpperCase()}${grade.rarity.slice(1)} · +${grade.levelGain} ${grade.levelGain === 1 ? "level" : "levels"}`,
                grade.weight / 10000,
              ] as const,
          )}
          reason={
            !upgradable
              ? "Every cat is at level 5."
              : (common ?? funds(CATALOG_V1.upgradePriceBaseUnits))
          }
          blocked={blocked}
          onBuy={() => buy("upgrade")}
        />
      </div>
      <p className="lobby-section-note">
        Each draw also uses up to 0.02 Devnet SOL for network fees.
      </p>
    </div>
  );
}
