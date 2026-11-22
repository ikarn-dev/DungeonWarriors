"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { MEDIA_ROOT } from "../lib/game/assets";
import { CATALOG_V1, catStats, eligibleCatWeights } from "../lib/game/catalog";
import { displayUsdc, type PlayerIntent } from "../lib/game/custody-client";
import {
  CAT_NAMES,
  decodePaidDraw,
  type LobbyState,
} from "../lib/game/lobby-state";
import { webApi } from "../lib/game/web-api";

const control =
  "min-h-11 rounded-md border px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50";
const percent = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 2,
});
const count = new Intl.NumberFormat("en-US");
const date = new Intl.DateTimeFormat("en-US", {
  timeStyle: "short",
  dateStyle: "medium",
  timeZone: "UTC",
});

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
  const [open, setOpen] = useState(false);
  const [draw, setDraw] = useState<ReturnType<typeof decodePaidDraw> | null>(
    null,
  );
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [ownedCat, setOwnedCat] = useState(
    state.selected ?? state.cats[0]?.id ?? null,
  );
  const latest =
    state.nonce !== null && state.nonce > 1n ? state.nonce - 1n : null;
  const pending = state.pendingDraw !== null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: Reread the same nonce after finality or a manual status check.
  useEffect(() => {
    if (!open || latest === null) return;
    const controller = new AbortController();
    void webApi(
      "/api/chain/state",
      { kind: "draw", nonce: latest.toString() },
      controller.signal,
    )
      .then((result) => {
        if (controller.signal.aborted) return;
        setDraw(decodePaidDraw(result, wallet, latest));
        setError(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [open, latest, state.pendingDraw, wallet, refresh]);

  const ownedMask = CATALOG_V1.cats.reduce(
    (mask, cat, i) =>
      state.cats.some((item) => item.id === cat.id) ? mask | (1 << i) : mask,
    0,
  );
  const pool = ownedMask === 15 ? null : eligibleCatWeights(ownedMask);
  const upgradable = state.cats.filter(
    (cat) =>
      cat.level < CATALOG_V1.maxCatLevel &&
      state.definingCatalogs[cat.id] === 1,
  );
  const selected =
    upgradable.find((cat) => cat.id === ownedCat) ?? upgradable[0];
  const disabled =
    blocked ||
    pending ||
    state.inventoryVersion === null ||
    state.catalogVersion !== 1;
  const buy = (capsule: "paidCat" | "upgrade") => {
    if (
      state.nonce === null ||
      state.inventoryVersion === null ||
      state.catalogVersion !== 1
    )
      return;
    setDraw(null);
    action({
      kind: "purchaseCapsule",
      capsule,
      nonce: state.nonce.toString(),
      inventoryVersion: state.inventoryVersion.toString(),
      catalogVersion: state.catalogVersion,
    });
  };
  return (
    <section
      className="grid gap-3 border-t border-[#cbd3be] pt-4"
      aria-label="Capsule shop"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Capsule shop</h2>
        <button
          type="button"
          className={control}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? "Close shop" : "Open shop"}
        </button>
      </div>
      {open && (
        <>
          {!state.allowPurchases && (
            <p className="text-sm">Paid draws are closed on Devnet.</p>
          )}
          {pending && (
            <output className="text-sm">A capsule draw is pending.</output>
          )}
          {error && (
            <p className="text-sm" role="alert">
              Capsule status could not be read.
            </p>
          )}
          {latest !== null && (
            <button
              type="button"
              className={control}
              onClick={() => setRefresh((value) => value + 1)}
            >
              Check latest draw
            </button>
          )}
          {draw && (
            <div
              className="grid gap-2 rounded-md border border-[#cbd3be] p-3 text-sm"
              aria-live="polite"
            >
              {draw.status === "fulfilled" && (
                <>Draw finalized · {draw.reward}</>
              )}
              {draw.status === "refunded" && (
                <>Refund finalized · {displayUsdc(draw.cost)} USDC</>
              )}
              {draw.status === "pending" && (
                <>
                  <span>
                    {displayUsdc(draw.cost)} USDC held for this draw. Refund
                    opens {date.format(new Date(Number(draw.deadline) * 1000))}{" "}
                    UTC.
                  </span>
                  {pending && latest !== null && (
                    <button
                      type="button"
                      className={control}
                      disabled={
                        blocked || Date.now() < Number(draw.deadline) * 1000
                      }
                      onClick={() =>
                        action({
                          kind: "refundCapsule",
                          nonce: latest.toString(),
                        })
                      }
                    >
                      Refund expired draw
                    </button>
                  )}
                </>
              )}
            </div>
          )}
          <p className="text-sm">
            Your wallet pays the Devnet network fee. Each paid draw can debit up
            to 0.02 Devnet SOL for rent and randomness.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="grid content-start gap-2 rounded-md border border-[#cbd3be] p-3 text-sm">
              <Image
                unoptimized
                src={`${MEDIA_ROOT}/capsule-lid.svg`}
                alt=""
                width={64}
                height={64}
              />
              <h3 className="font-semibold">Cat capsule</h3>
              {pool === null ? (
                <p>All cats owned.</p>
              ) : (
                <ul className="grid gap-1">
                  {CATALOG_V1.cats.map((cat, i) => {
                    const weight = pool.weights[i] ?? 0;
                    return weight === 0 ? null : (
                      <li
                        className="flex flex-wrap justify-between gap-2"
                        key={cat.id}
                      >
                        {CAT_NAMES[cat.id]}{" "}
                        <span className="font-mono tabular-nums">
                          {percent.format(weight / pool.total)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
              <button
                type="button"
                className={control}
                disabled={
                  disabled ||
                  !state.allowPurchases ||
                  pool === null ||
                  BigInt(state.available) < CATALOG_V1.catPriceBaseUnits
                }
                onClick={() => buy("paidCat")}
              >
                Buy · {displayUsdc(CATALOG_V1.catPriceBaseUnits.toString())}{" "}
                USDC
              </button>
            </div>
            <div className="grid content-start gap-2 rounded-md border border-[#cbd3be] p-3 text-sm">
              <Image
                unoptimized
                src={`${MEDIA_ROOT}/upgrade-item.svg`}
                alt=""
                width={64}
                height={64}
              />
              <h3 className="font-semibold">Upgrade capsule</h3>
              <ul className="grid gap-1">
                {CATALOG_V1.upgrades.map((grade) => (
                  <li
                    className="flex flex-wrap justify-between gap-2 capitalize"
                    key={grade.rarity}
                  >
                    {grade.rarity}{" "}
                    <span className="font-mono tabular-nums">
                      {percent.format(grade.weight / 10000)}
                    </span>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className={control}
                disabled={
                  disabled ||
                  !state.allowPurchases ||
                  upgradable.length === 0 ||
                  BigInt(state.available) < CATALOG_V1.upgradePriceBaseUnits
                }
                onClick={() => buy("upgrade")}
              >
                Buy · {displayUsdc(CATALOG_V1.upgradePriceBaseUnits.toString())}{" "}
                USDC
              </button>
            </div>
          </div>
          <h3 className="font-semibold">Your upgrades</h3>
          {selected && (
            <select
              aria-label="Cat to upgrade"
              className={control}
              value={selected.id}
              onChange={(event) =>
                setOwnedCat(
                  upgradable.find((cat) => cat.id === event.target.value)?.id ??
                    null,
                )
              }
            >
              {upgradable.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {CAT_NAMES[cat.id]}
                </option>
              ))}
            </select>
          )}
          {CATALOG_V1.upgrades.map((grade) => {
            const quantity = BigInt(state.upgrades[grade.rarity] ?? "0");
            const next = selected
              ? Math.min(
                  CATALOG_V1.maxCatLevel,
                  selected.level + grade.levelGain,
                )
              : null;
            const cooldown =
              selected && next !== null
                ? catStats(selected.id, next).powerCooldownTicks / 60
                : null;
            return (
              <div
                key={grade.rarity}
                className="flex flex-wrap items-center justify-between gap-2 border-t border-[#cbd3be] py-2 text-sm"
              >
                <div className="grid gap-1">
                  <span className="capitalize">
                    {grade.rarity} ·{" "}
                    <span className="font-mono tabular-nums">
                      {count.format(quantity)}
                    </span>
                  </span>
                  {selected &&
                    next !== null &&
                    cooldown !== null &&
                    quantity > 0n && (
                      <span>
                        Level {selected.level} → {next} · {cooldown}s power
                        cooldown
                      </span>
                    )}
                </div>
                <button
                  type="button"
                  className={control}
                  disabled={blocked || pending || !selected || quantity === 0n}
                  onClick={() => {
                    if (!selected || state.inventoryVersion === null) return;
                    action({
                      kind: "applyUpgrade",
                      grade: grade.rarity,
                      cat: selected.id,
                      level: selected.level,
                      definingCatalogVersion: 1,
                      inventoryVersion: state.inventoryVersion.toString(),
                    });
                  }}
                >
                  Apply
                </button>
              </div>
            );
          })}
        </>
      )}
    </section>
  );
}
