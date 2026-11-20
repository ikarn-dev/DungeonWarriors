"use client";

import { utils } from "@anchor-lang/core";
import { PublicKey } from "@solana/web3.js";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { verifyManifestBinding } from "../lib/game/assets";
import { displayUsdc } from "../lib/game/custody-client";
import { Predictor } from "../lib/game/predictor";
import { RULES_V1 } from "../lib/game/rules";
import { decodeRunAccount, runAddresses } from "../lib/game/run-accounts";
import { RunState } from "../lib/game/run-feed";
import { readWebJson, webApi } from "../lib/game/web-api";
import { DEVNET } from "../lib/solana/addresses";

const amount = z.string().regex(/^(0|[1-9][0-9]{0,19})$/);
const payout = z.object({
  grossPayoutBaseUnits: amount,
  refundBaseUnits: amount,
});
const schema = z.object({
  run: z.object({
    status: z.enum([
      "absent",
      "reserved",
      "refundReady",
      "recoveryPending",
      "settlementReady",
      "settled",
      "refunded",
    ]),
    pending: payout.optional(),
    grossPayoutBaseUnits: amount.optional(),
    refundBaseUnits: amount.optional(),
  }),
  er: z
    .strictObject({
      slot: z.number().int().nonnegative(),
      owner: z.literal(DEVNET.program),
      data: z.string().min(12).max(14000),
      market: z.enum(["BTC", "ETH", "SOL"]),
    })
    .nullable(),
});
type Run = Awaited<ReturnType<typeof decodeRunAccount>>;
const labels: Record<z.infer<typeof schema>["run"]["status"], string> = {
  absent: "Run unavailable",
  reserved: "Waiting for activation",
  refundReady: "Reservation expired",
  recoveryPending: "Checking the run on MagicBlock",
  settlementReady: "Ready for settlement",
  settled: "Settlement finalized",
  refunded: "Refund finalized",
};
const formatNumber = new Intl.NumberFormat("en-US");

export default function RunStage({
  wallet,
  nonce,
  close,
}: {
  wallet: string;
  nonce: string;
  close: () => void;
}) {
  const [status, setStatus] = useState("Reading your run…");
  const [visible, setVisible] = useState<{ run: Run; market: string } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [artError, setArtError] = useState(false);
  const [settlement, setSettlement] = useState<string | null>(null);
  const mount = useRef<HTMLDivElement>(null);
  const prediction = useRef<{
    engine: Predictor;
    extrapolate: boolean;
    sampledAt: number;
    ticks: number;
    world: ReturnType<Predictor["predict"]>;
  } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const identity = { owner: wallet, nonce: BigInt(nonce) };
    const addresses = runAddresses(identity);
    const feed = new RunState();
    let lastSlot = -1;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        if (document.hidden) return;
        const response = schema.parse(
          await webApi(
            "/api/chain/state",
            { kind: "liveRun", nonce },
            controller.signal,
          ),
        );
        if (controller.signal.aborted) return;
        setError(null);
        setStatus(labels[response.run.status]);
        const funds = response.run.pending ?? response.run;
        const gross = funds.grossPayoutBaseUnits;
        const refund = funds.refundBaseUnits;
        setSettlement(
          gross === undefined || refund === undefined
            ? null
            : `${response.run.pending ? "Pending" : "Finalized"} ${
                refund !== "0"
                  ? `refund ${displayUsdc(refund)}`
                  : `payout ${displayUsdc(gross)}`
              } USDC`,
        );
        if (response.er === null) {
          setVisible(null);
          if (
            response.run.status === "settled" ||
            response.run.status === "refunded" ||
            response.run.status === "absent"
          )
            controller.abort();
          return;
        }
        if (response.er.slot < lastSlot) return;
        const decoded = await decodeRunAccount(identity, addresses.run[0], {
          owner: new PublicKey(response.er.owner),
          data: utils.bytes.base64.decode(response.er.data),
          executable: false,
        });
        if (controller.signal.aborted) return;
        feed.applyRun(response.er.slot, decoded);
        lastSlot = response.er.slot;
        if (decoded.prediction !== null) {
          const engine =
            prediction.current?.engine ??
            new Predictor(decoded.prediction, decoded.stats);
          if (engine.reconcile(decoded.prediction))
            prediction.current = {
              engine,
              extrapolate: decoded.prediction.frame.phase === "active",
              sampledAt: performance.now(),
              ticks: 0,
              world: engine.predict(0),
            };
        }
        setVisible({ run: decoded, market: response.er.market });
        setStatus(
          decoded.observation.phase === "active"
            ? "Run active on MagicBlock"
            : decoded.observation.phase === "suspended"
              ? "Run suspended"
              : decoded.observation.phase === "ready"
                ? "Waiting for activation"
                : "Waiting for finalized settlement",
        );
      } catch {
        if (!controller.signal.aborted)
          setError("Run data is temporarily unavailable.");
      } finally {
        if (!controller.signal.aborted)
          timer = setTimeout(() => void poll(), 6000);
      }
    };
    prediction.current = null;
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [wallet, nonce]);

  const cat = visible?.run.cat;
  const version = visible?.run.assetBinding.version;
  const hash = visible?.run.assetBinding.contentHash;
  const hasWorld = visible?.run.prediction != null;

  useEffect(() => {
    const parent = mount.current;
    if (
      !parent ||
      !hasWorld ||
      cat === undefined ||
      version === undefined ||
      hash === undefined
    )
      return;
    const controller = new AbortController();
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    let game:
      | ReturnType<typeof import("../lib/game/render-run").renderRun>
      | undefined;
    setArtError(false);
    async function attach(
      container: HTMLDivElement,
      selected: typeof cat,
      binding: { version: number; contentHash: string },
    ) {
      if (selected === undefined) return;
      const response = await fetch(
        `/game-assets/v${binding.version}/manifest.json`,
        { signal: controller.signal },
      );
      if (!response.ok) throw new Error("ASSETS_NOT_READY");
      const manifest = await verifyManifestBinding(
        await readWebJson(response),
        binding,
      );
      const [{ default: Phaser }, { renderRun }] = await Promise.all([
        import("phaser"),
        import("../lib/game/render-run"),
      ]);
      if (controller.signal.aborted) return;
      const initial = prediction.current?.world;
      if (!initial) return;
      game = renderRun(
        Phaser,
        container,
        manifest,
        selected,
        () => {
          const active = prediction.current;
          if (!active) return initial;
          const ticks = active.extrapolate
            ? Math.min(
                RULES_V1.maxPredictionTicks,
                Math.floor(
                  ((performance.now() - active.sampledAt) * 60) / 1000,
                ),
              )
            : 0;
          if (ticks !== active.ticks) {
            active.world = active.engine.predict(ticks);
            active.ticks = ticks;
          }
          return active.world;
        },
        () => reduced.matches,
        () => {
          if (!controller.signal.aborted) setArtError(true);
        },
      );
    }
    void attach(parent, cat, { version, contentHash: hash }).catch(() => {
      if (!controller.signal.aborted) setArtError(true);
    });
    return () => {
      controller.abort();
      game?.destroy(true);
    };
  }, [cat, version, hash, hasWorld]);

  return (
    <section
      className="grid gap-2 rounded-md border border-[#cbd3be] p-3"
      aria-label="Run viewer"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-medium">
          Run {formatNumber.format(BigInt(nonce))}
          {visible ? ` · ${visible.market}` : ""}
        </h3>
        <button
          type="button"
          className="min-h-11 px-2 text-sm underline"
          onClick={close}
        >
          Close viewer
        </button>
      </div>
      <output className="text-sm">{error ?? status}</output>
      {settlement && (
        <p className="font-mono text-sm tabular-nums">{settlement}</p>
      )}
      {hasWorld && (
        <div
          className="aspect-video w-full overflow-hidden rounded bg-[#173b32]"
          ref={mount}
          role="img"
          aria-label="Run scene"
        />
      )}
      {artError && (
        <p className="text-sm" role="alert">
          Run artwork is unavailable.
        </p>
      )}
      {visible?.run.prediction && (
        <p className="font-mono text-sm tabular-nums">
          Score {formatNumber.format(visible.run.prediction.frame.score)}
        </p>
      )}
    </section>
  );
}
