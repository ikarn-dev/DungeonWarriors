"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { MEDIA_ROOT } from "../lib/game/assets";
import { displayUsdc, type PlayerIntent } from "../lib/game/custody-client";
import {
  CAT_NAMES,
  type CapsuleKind,
  type CapsuleReceipt,
  type LobbyState,
} from "../lib/game/lobby-state";

const percent = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 2,
});
type Capsule = "paidCat" | "upgrade";

function Offer({
  title,
  art,
  price,
  odds,
  reason,
  blocked,
  opening,
  onBuy,
}: {
  readonly title: string;
  readonly art: readonly string[];
  readonly price: bigint;
  readonly odds: readonly (readonly [string, number])[];
  readonly reason: string | null;
  readonly blocked: boolean;
  readonly opening: boolean;
  readonly onBuy: () => void;
}) {
  return (
    <article className="lobby-offer">
      <span className="lobby-offer-art" data-opening={opening || undefined}>
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
        {opening ? "Opening…" : "Buy & open"}
      </button>
      {reason && <p className="lobby-offer-note">{reason}</p>}
    </article>
  );
}

export default function CapsuleShop({
  state,
  blocked,
  action,
  receipt: draw,
  retryDraw,
  onViewDraw,
}: {
  state: LobbyState;
  blocked: boolean;
  action: (value: PlayerIntent["action"]) => void;
  receipt: CapsuleReceipt | null;
  retryDraw: (() => void) | undefined;
  onViewDraw: (nonce: bigint, kind: CapsuleKind) => void;
}) {
  const latest =
    state.nonce !== null && state.nonce > 1n ? state.nonce - 1n : null;
  const pending = state.pendingDraw !== null;
  const deadline =
    pending && draw?.status === "pending" && draw.deadline !== null
      ? Number(draw.deadline) * 1000
      : null;
  const [expiredAt, setExpiredAt] = useState<number | null>(null);
  useEffect(() => {
    if (deadline === null) return;
    const timer = setTimeout(
      () => setExpiredAt(deadline),
      Math.max(0, deadline - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [deadline]);
  const canRefund = deadline !== null && expiredAt === deadline;
  const { shopCatalog, catalogVersion, nonce, inventoryVersion } = state;
  if (!shopCatalog || catalogVersion === null)
    return (
      <div className="lobby-section">
        <h2>Shop</h2>
        <p>The shop catalog is unavailable.</p>
      </div>
    );
  const { catPriceBaseUnits: catPrice, upgradePriceBaseUnits: upgradePrice } =
    shopCatalog;
  const eligible = shopCatalog.cats.filter(
    ({ id }) => !state.cats.some((cat) => cat.id === id),
  );
  const total = eligible.reduce((sum, cat) => sum + cat.weight, 0);
  const upgradeTotal = shopCatalog.upgrades.reduce(
    (sum, grade) => sum + grade.weight,
    0,
  );
  const upgradable = state.cats.some(
    (cat) => cat.level < shopCatalog.maxCatLevel,
  );
  const paused = !state.allowPurchases;
  const unavailable =
    blocked || paused || pending || nonce === null || inventoryVersion === null;
  const available = BigInt(state.available);
  const funds = (price: bigint) =>
    available < price
      ? `Needs ${displayUsdc(price.toString())} USDC available.`
      : null;
  const buy = (capsule: Capsule) => {
    if (unavailable || nonce === null || inventoryVersion === null) return;
    action({
      kind: "purchaseCapsule",
      capsule,
      nonce: nonce.toString(),
      inventoryVersion: inventoryVersion.toString(),
      catalogVersion,
    });
  };
  return (
    <div className="lobby-section">
      <header className="lobby-section-head">
        <h2>Shop</h2>
      </header>
      {paused && (
        <p className="lobby-section-note">Purchases are paused on Devnet.</p>
      )}
      {pending ||
      draw?.status === "fulfilled" ||
      draw?.status === "refunded" ? (
        <div className="lobby-banner">
          <p aria-live="polite">
            {pending
              ? canRefund
                ? "Your draw timed out. You can refund it."
                : "Opening your capsule…"
              : draw?.status === "fulfilled"
                ? draw.reward?.kind === "cat"
                  ? `You got ${CAT_NAMES[draw.reward.id]}.`
                  : `You got a ${draw.reward?.rarity} upgrade.`
                : draw?.status === "refunded"
                  ? `${displayUsdc(draw.cost)} USDC returned to your PURRPS balance.`
                  : null}
          </p>
          {canRefund && latest !== null && (
            <button
              type="button"
              className="pixel-button"
              disabled={blocked}
              onClick={() =>
                action({ kind: "refundCapsule", nonce: latest.toString() })
              }
            >
              Refund
            </button>
          )}
          {draw && latest !== null && !canRefund && (
            <button
              type="button"
              className="pixel-button"
              onClick={() => onViewDraw(latest, draw.kind)}
            >
              {draw.status === "fulfilled" ? "Replay reveal" : "View draw"}
            </button>
          )}
          {retryDraw && (
            <button type="button" className="pixel-button" onClick={retryDraw}>
              Check draw
            </button>
          )}
        </div>
      ) : null}
      <div className="lobby-columns">
        <Offer
          title="Cat capsule"
          art={[
            `${MEDIA_ROOT}/capsule-base.svg`,
            `${MEDIA_ROOT}/capsule-lid.svg`,
          ]}
          price={catPrice}
          odds={eligible.map(({ id, weight }) => [
            CAT_NAMES[id],
            weight / total,
          ])}
          reason={
            total === 0
              ? "You own every cat."
              : paused || pending
                ? null
                : funds(catPrice)
          }
          blocked={unavailable}
          opening={pending && !canRefund && draw?.kind === "paidCat"}
          onBuy={() => buy("paidCat")}
        />
        <Offer
          title="Upgrade capsule"
          art={[`${MEDIA_ROOT}/upgrade-item.svg`]}
          price={upgradePrice}
          odds={shopCatalog.upgrades.map((grade) => {
            const { rarity } = grade;
            const label = rarity.charAt(0).toUpperCase() + rarity.slice(1);
            return [
              `${label} · +${grade.levelGain} ${grade.levelGain === 1 ? "level" : "levels"}`,
              grade.weight / upgradeTotal,
            ];
          })}
          reason={
            !upgradable
              ? "All your cats are fully upgraded."
              : paused || pending
                ? null
                : funds(upgradePrice)
          }
          blocked={unavailable}
          opening={pending && !canRefund && draw?.kind === "upgrade"}
          onBuy={() => buy("upgrade")}
        />
      </div>
      <p className="lobby-section-note">
        Purchases use your PURRPS balance. Your wallet pays the Devnet SOL cost
        of opening the capsule.
      </p>
    </div>
  );
}
