"use client";
import Image from "next/image";
import { useEffect, useState } from "react";
import { CATALOG_V1 } from "../lib/game/catalog";
import { displayUsdc, type PlayerIntent } from "../lib/game/custody-client";
import {
  CAT_NAMES,
  type CapsuleKind,
  type CapsuleReceipt,
  type LobbyState,
} from "../lib/game/lobby-state";
import { warriorAvatar } from "../lib/game/warrior-avatars";
import DotsLoader from "./DotsLoader";
import { GachaMachine } from "./GachaMachine";
import { WarriorIcon } from "./WarriorIcon";

const percent = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 2,
});
const rarityOf = (id: string) =>
  CATALOG_V1.cats.find((cat) => cat.id === id)?.rarity ?? "common";
// Shop (2026-11-24): the gold claw machine and one Summon key, then the odds
// for every avatar in small type below (exact weight/total and percentage;
// owned ones read Owned). The latest draw is listed under History with Replay or Refund.
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
        <header className="lobby-section-head">
          <h2>Shop</h2>
        </header>
        <p>The shop is unavailable right now.</p>
      </div>
    );
  const price = shopCatalog.catPriceBaseUnits;
  const eligible = shopCatalog.cats.filter(
    ({ id }) => !state.cats.some((cat) => cat.id === id),
  );
  const total = eligible.reduce((sum, cat) => sum + cat.weight, 0);
  const paused = !state.allowPurchases;
  const opening = pending && !canRefund;
  const unavailable =
    blocked ||
    paused ||
    pending ||
    total === 0 ||
    nonce === null ||
    inventoryVersion === null;
  const short = BigInt(state.available) < price;
  const reason =
    total === 0
      ? "Every avatar is yours"
      : paused
        ? "Summons are paused"
        : !pending && short
          ? `Needs ${displayUsdc(price.toString())} USDC`
          : null;
  const summon = () => {
    if (unavailable || short || nonce === null || inventoryVersion === null)
      return;
    action({
      kind: "purchaseCapsule",
      capsule: "paidCat",
      nonce: nonce.toString(),
      inventoryVersion: inventoryVersion.toString(),
      catalogVersion,
    });
  };
  const reward = draw?.reward;
  return (
    <div className="lobby-section">
      <header className="lobby-section-head">
        <h2>Shop</h2>
      </header>
      <div className="gacha">
        <GachaMachine price={displayUsdc(price.toString())} opening={opening} />
        <button
          type="button"
          className="metal-key gacha-summon"
          aria-busy={opening || undefined}
          disabled={unavailable || short}
          onClick={summon}
        >
          {opening && <DotsLoader label="Opening your capsule" />}
          Summon
        </button>
        {reason && <p className="gacha-reason">{reason}</p>}
      </div>
      <section className="gacha-chances" aria-labelledby="gacha-chances">
        <h3 id="gacha-chances">Odds</h3>
        <dl>
          {shopCatalog.cats.map(({ id, weight }) => {
            const owned = !eligible.some((cat) => cat.id === id);
            return (
              <div key={id} data-owned={owned || undefined}>
                <dt>
                  <span
                    className="gacha-chance-mark"
                    data-rarity={rarityOf(id)}
                    aria-hidden="true"
                  />
                  {CAT_NAMES[id]}
                </dt>
                <dd>
                  {owned ? (
                    "Owned"
                  ) : (
                    <>
                      <span className="gacha-chance-weight">
                        {weight}/{total}
                      </span>
                      <span>{percent.format(weight / total)}</span>
                    </>
                  )}
                </dd>
              </div>
            );
          })}
        </dl>
      </section>
      {draw && latest !== null && (
        <section className="gacha-history" aria-labelledby="gacha-history">
          <h3 id="gacha-history">History</h3>
          <div className="gacha-entry">
            <span className="gacha-entry-art" aria-hidden="true">
              {reward?.kind === "cat" ? (
                <Image
                  src={warriorAvatar(reward.id)}
                  alt=""
                  width={1254}
                  height={1254}
                  sizes="2.5rem"
                />
              ) : (
                <WarriorIcon name="gem" />
              )}
            </span>
            <p aria-live="polite">
              <strong>
                {draw.status === "pending"
                  ? canRefund
                    ? "Timed out"
                    : "Opening…"
                  : draw.status === "refunded"
                    ? "Refunded"
                    : reward?.kind === "cat"
                      ? CAT_NAMES[reward.id]
                      : `${reward?.rarity ?? ""} upgrade`}
              </strong>
              <span>
                {draw.status === "refunded"
                  ? `${displayUsdc(draw.cost)} USDC returned`
                  : `${displayUsdc(draw.cost)} USDC`}
              </span>
            </p>
            {canRefund ? (
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
            ) : retryDraw ? (
              <button
                type="button"
                className="pixel-button"
                onClick={retryDraw}
              >
                Check
              </button>
            ) : draw.status !== "refunded" ? (
              <button
                type="button"
                className="pixel-button"
                onClick={() => onViewDraw(latest, draw.kind)}
              >
                {draw.status === "fulfilled" ? "Replay" : "View"}
              </button>
            ) : null}
          </div>
        </section>
      )}
    </div>
  );
}
