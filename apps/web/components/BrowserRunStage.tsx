"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BrowserRunner, browserReplaySchema, decodeBrowser, finishBrowserReplay,
  type BrowserStop,
} from "../lib/game/browser-replay";
import { displayUsdc } from "../lib/game/custody-client";
import { grossPayout } from "../lib/game/economy";
import type { PlayerIntent } from "../lib/game/protocol";
import { earnedMultiplierBps, RULES_V4 } from "../lib/game/rules";
import type { RunArtwork } from "../lib/game/run-artwork";
import { mergeRunPrices, type RunPrice } from "../lib/game/run-price";
import { WebApiError, webApi } from "../lib/game/web-api";
import type { BrowserView } from "../lib/server/browser-run";
import RunControls from "./RunControls";
import { POWER_LABELS, RunHud, RunPanel } from "./RunHud";
import { useRunRenderer } from "./useRunRenderer";

export default function BrowserRunStage({
  nonce, media, artwork, present, activating, onFinalized, runSettled, onLegacy,
}: {
  nonce: string; media: { version: number; contentHash: string } | null;
  artwork?: RunArtwork | undefined; present: boolean; activating?: boolean | undefined;
  onFinalized?: (() => void) | undefined; runSettled?: (() => void) | undefined; onLegacy: () => void;
}) {
  const mount = useRef<HTMLDivElement>(null);
  const runner = useRef<BrowserRunner | null>(null);
  const client = useRef(crypto.randomUUID());
  const clockOffset = useRef(0);
  const exiting = useRef(false);
  const finalized = useRef(false);
  const initialRequest = useRef(false);
  const finalizedCallback = useRef(onFinalized);
  useEffect(() => { finalizedCallback.current = onFinalized; }, [onFinalized]);
  const [view, setView] = useState<BrowserView | null>(null);
  const [frame, setFrame] = useState<ReturnType<BrowserRunner["advance"]>["frame"] | null>(null);
  const [prices, setPrices] = useState<RunPrice[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [started, setStarted] = useState(false);

  const request = useCallback(async (kind: "start" | "step" | "finish" | "status", signal?: AbortSignal) => {
    const active = runner.current;
    const through = Number(active?.world.frame.activeTicks ?? 0n);
    const inputs = active?.inputs.filter((input) => input.tick <= through) ?? [];
    const result = await webApi<BrowserView>("/api/run/browser", {
      kind, nonce, client: client.current, through, inputs,
      ...(kind === "finish" ? { exit: "pageClosed" } : {}),
    }, signal);
    const replay = browserReplaySchema.parse(decodeBrowser(result.replay));
    if (!runner.current) {
      clockOffset.current = result.serverNow - performance.now();
      runner.current = new BrowserRunner(replay);
    } else runner.current.acknowledge(replay);
    if (replay.stop !== null) {
      runner.current.world = replay.world;
      exiting.current = true;
    }
    setFrame(runner.current.world.frame);
    setView(result);
    if (result.settled && !finalized.current) {
      finalized.current = true;
      finalizedCallback.current?.();
    }
    return result;
  }, [nonce]);

  const finish = useCallback((reason: BrowserStop) => {
    if (exiting.current || !runner.current) return;
    exiting.current = true;
    const active = runner.current;
    active.world = finishBrowserReplay({ ...active.replay, world: active.world }, reason).world;
    setFrame(active.world.frame);
    const through = Number(active.world.frame.activeTicks);
    // keepalive is best effort. Server liveness and cron cover a process kill.
    void fetch("/api/run/browser", {
      method: "POST", credentials: "same-origin", keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({kind: "finish", nonce, client: client.current, through,
        inputs: active.inputs.filter((input) => input.tick <= through),
        exit: reason === "hidden" ? "hidden" : reason === "engineError" ? "engineError" : "pageClosed"}),
    }).catch(() => setNotice("Finishing from your last verified progress…"));
  }, [nonce]);

  const source = useMemo(() => ({
    world: () => {
      const active = runner.current;
      if (!active) throw new Error("RUN_NOT_READY");
      if (!exiting.current) {
        try {
          active.advance(performance.now() + clockOffset.current);
          if (active.world.frame.terminalReason) finish(active.world.frame.terminalReason === "crash" ? "crash" : "cashOut");
        } catch { finish("engineError"); }
      }
      return active.world;
    },
    sample: () => ({ lead: runner.current?.lead ?? 0, revision: 0 }),
  }), [finish]);
  const { artReady, artError } = useRunRenderer({
    present, mount, hasWorld: view !== null, rulesVersion: RULES_V4.rulesVersion,
    cat: view?.cat, media, artwork, source, focusable: started && !exiting.current,
  });
  useEffect(() => { if (artError && runner.current) finish("engineError"); }, [artError, finish]);

  // A new document may only finish an old run, never resume it with newer prices.
  useEffect(() => {
    if (activating || initialRequest.current) return;
    initialRequest.current = true;
    const controller = new AbortController();
    void request("status", controller.signal).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      if (error instanceof WebApiError && error.code === "BROWSER_RUN_UNAVAILABLE") onLegacy();
      else if (error instanceof WebApiError && error.code === "RUN_ALREADY_SETTLED") finalizedCallback.current?.();
      else if (!(error instanceof WebApiError && error.code === "RUN_NOT_FOUND"))
        setNotice("Checking the previous run…");
    });
    return () => controller.abort();
  }, [activating, request, onLegacy]);

  useEffect(() => {
    if (!view) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let sending = false;
    async function beat() {
      if (controller.signal.aborted || finalized.current || sending) return;
      sending = true;
      try {
        await request(exiting.current ? "status" : "step", controller.signal);
        setNotice(null);
      } catch {
        if (!controller.signal.aborted) {
          finish("pageClosed");
          setNotice("Finishing from your last verified progress…");
        }
      } finally {
        sending = false;
        if (!controller.signal.aborted && !finalized.current)
          timer = setTimeout(() => void beat(), exiting.current ? 3000 : 1000);
      }
    }
    timer = setTimeout(() => void beat(), 1000);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [!!view, request, finish]);

  useEffect(() => {
    if (!started) return;
    const leave = () => finish("pageClosed");
    const hidden = () => { if (document.hidden) finish("hidden"); };
    const lost = () => finish("engineError");
    window.addEventListener("pagehide", leave);
    document.addEventListener("visibilitychange", hidden);
    mount.current?.addEventListener("webglcontextlost", lost, true);
    const surface = mount.current;
    return () => {
      leave();
      window.removeEventListener("pagehide", leave);
      document.removeEventListener("visibilitychange", hidden);
      surface?.removeEventListener("webglcontextlost", lost, true);
    };
  }, [started, finish]);
  useEffect(() => { if (!present && started) finish("hidden"); }, [present, started, finish]);

  useEffect(() => {
    if (!started) return;
    const timer = setInterval(() => {
      const active = runner.current;
      if (!active) return;
      setFrame({ ...active.world.frame });
      const tick = Number(active.world.frame.activeTicks);
      const applied = active.replay.prices.filter((event) => event.tick <= tick);
      setPrices((old) => mergeRunPrices(old, applied.map((event) => ({
        sequence: event.sequence, price: event.sample.price, exponent: event.sample.exponent,
      }))));
    }, 100);
    return () => clearInterval(timer);
  }, [started]);
  const input = useCallback((action: PlayerIntent) => {
    try { runner.current?.input(action); } catch { finish("engineError"); }
  }, [finish]);
  const onInputs = useCallback(() => {}, []);
  const qualified = (frame?.qualifiedCheckpoints ?? 0n) > 0n;
  const stats = runner.current?.replay.stats;
  const effect = stats && frame?.powers[stats.power];
  const power = stats && effect && frame ? {
    id: stats.power, name: POWER_LABELS[stats.power],
    ready: effect.readyAtTick <= frame.activeTicks,
    active: effect.charges > 0 && effect.endsAtTick > frame.activeTicks,
    remaining: Math.min(1, Math.max(0, Number(effect.readyAtTick - frame.activeTicks) / stats.powerCooldownTicks)),
    detail: effect.readyAtTick <= frame.activeTicks ? "Ready" : "Recharging",
  } : null;
  const payout = view && frame && qualified ? {
    amount: `${displayUsdc(grossPayout(BigInt(view.stake), frame.qualifiedCheckpoints, BigInt(view.maxGross)).toString())} USDC`,
    multiplier: `${earnedMultiplierBps(frame.qualifiedCheckpoints) / 10_000}×`,
  } : null;
  if (!present) return null;
  return <section className="run-stage" aria-label="Run">
    <div className="run-playfield">
      <div className="run-canvas" ref={mount} role="application" tabIndex={started ? 0 : -1} aria-label="Game playfield" />
      {view && frame && stats && <RunHud frame={frame} cat={view.cat} catLevel={view.catLevel}
        power={stats.power} market={view.market} prices={prices} nonce={nonce} />}
      {(!started || exiting.current || !artReady) && <RunPanel title={
        view?.settled ? "Run settled" : exiting.current ? "Finalizing your result…" : activating ? "Preparing your run…" : "Ready to run"}>
        {notice && <p>{notice}</p>}
        {!started && !exiting.current && !activating && <button className="pixel-button" type="button" disabled={busy}
          onClick={() => {
            setBusy(true);
            void request("start").then(() => setStarted(true), (error: unknown) => {
              if (error instanceof WebApiError && error.code === "BROWSER_RUN_UNAVAILABLE") onLegacy();
              else setNotice("Run could not start. Please try again.");
            }).finally(() => setBusy(false));
          }}>{busy ? "Starting…" : "Start"}</button>}
        {view?.settled && <button className="pixel-button" type="button" onClick={runSettled}>Done</button>}
      </RunPanel>}
      {started && view && frame && power && !exiting.current && <RunControls
        accepted={0n} eligible={qualified} playing={frame.phase === "active"} artReady={artReady}
        surface={mount} power={power} payout={payout} onInputs={onInputs} rulesVersion={RULES_V4.rulesVersion} local={input} />}
    </div>
  </section>;
}
