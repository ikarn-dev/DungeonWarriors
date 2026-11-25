"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DungeonArtwork } from "../lib/dungeon/artwork";
import { displayMultiplier } from "../lib/dungeon/format";
import type { DungeonRequest, DungeonView } from "../lib/dungeon/protocol";
import { DungeonRunner } from "../lib/dungeon/replay";
import { PHYSICS } from "../lib/dungeon/rules";
import {
  budgetMs,
  type Control,
  type DungeonFrame,
  nearbyGate,
  roomBudgetMs,
} from "../lib/dungeon/simulation";
import { displayUsdc } from "../lib/game/custody-client";
import DungeonControls from "./DungeonControls";
import DungeonHud from "./DungeonHud";

export default function DungeonStage({
  view,
  artwork,
  client,
  send,
  onDone,
  onFailure,
}: {
  readonly view: DungeonView;
  readonly artwork: DungeonArtwork;
  readonly client: string;
  readonly send: (input: DungeonRequest) => Promise<DungeonView | null>;
  readonly onDone: () => void;
  readonly onFailure: () => void;
}) {
  const mount = useRef<HTMLDivElement>(null),
    runner = useRef<DungeonRunner | null>(null);
  const current = useRef(view),
    offset = useRef(0),
    sending = useRef(false),
    notified = useRef(false);
  const autoStarted = useRef(false);
  const [frame, setFrame] = useState<DungeonFrame | null>(null);
  const [ready, setReady] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const roomIndex = view.room?.index,
    seed = view.room?.seed,
    startedAt = view.room?.startedAt;
  useEffect(() => {
    current.current = view;
  }, [view]);
  useEffect(() => {
    if (
      view.phase === "playing" &&
      roomIndex !== undefined &&
      seed !== undefined &&
      startedAt !== undefined
    ) {
      if (
        runner.current?.index === roomIndex &&
        runner.current.startedAt === startedAt
      )
        return;
      offset.current = view.serverNow - performance.now();
      runner.current = new DungeonRunner(
        view.cat,
        roomIndex,
        seed,
        view.rules,
        startedAt,
      );
      notified.current = false;
      setFrame(runner.current.frame);
    }
  }, [
    view.phase,
    view.cat,
    view.rules,
    view.serverNow,
    roomIndex,
    seed,
    startedAt,
  ]);
  const action = useCallback(
    async (input: DungeonRequest) => {
      if (sending.current) return null;
      sending.current = true;
      setBusy(true);
      setError(null);
      try {
        return await send(input);
      } catch {
        if (input.kind === "start") {
          // Retry the same room start after a lost response. Its saved clock
          // and owner are checked by the server.
          try {
            return await send(input);
          } catch {
            onFailure();
            return null;
          }
        }
        setError("Checking your saved expedition…");
        try {
          const saved = await send({
            kind: "status",
            nonce: current.current.nonce,
          });
          if (saved) setError(null);
          return saved;
        } catch {
          return null;
        }
      } finally {
        sending.current = false;
        setBusy(false);
      }
    },
    [send, onFailure],
  );
  useEffect(() => {
    if (!ready || view.phase !== "ready" || autoStarted.current) return;
    const startWhenVisible = () => {
      if (document.hidden || autoStarted.current) return;
      autoStarted.current = true;
      void action({
        kind: "start",
        nonce: current.current.nonce,
        client,
        room: 0,
      });
    };
    startWhenVisible();
    document.addEventListener("visibilitychange", startWhenVisible);
    return () =>
      document.removeEventListener("visibilitychange", startWhenVisible);
  }, [action, client, ready, view.phase]);
  const timeout = useCallback(() => {
    if (notified.current) return;
    notified.current = true;
    void action({ kind: "exit", nonce: current.current.nonce, client });
  }, [action, client]);
  useEffect(() => {
    const parent = mount.current;
    if (!parent) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReady(false);
    setError(null);
    let failed = false;
    const report = () => {
      if (failed) return;
      failed = true;
      onFailure();
    };
    const startupDeadline = setTimeout(report, 15000);
    parent.addEventListener("webglcontextlost", report, true);
    let destroy: (() => void) | undefined;
    try {
      destroy = artwork.render(
        artwork.engine,
        parent,
        artwork.manifest,
        artwork.cat,
        {
          runner: () => runner.current,
          playing: () =>
            current.current.phase === "playing" && !sending.current,
          now: () => performance.now() + offset.current,
          reduced: () => reduced.matches,
          onReady: () => {
            clearTimeout(startupDeadline);
            if (!failed) setReady(true);
          },
          onError: report,
          onTimeout: timeout,
          preloaded: artwork.images,
        },
      );
    } catch {
      report();
    }
    return () => {
      failed = true;
      clearTimeout(startupDeadline);
      parent.removeEventListener("webglcontextlost", report, true);
      destroy?.();
    };
  }, [artwork, timeout, onFailure]);
  useEffect(() => {
    if (view.phase !== "playing") return;
    const timer = setInterval(() => {
      if (runner.current) setFrame({ ...runner.current.frame });
    }, 100);
    return () => clearInterval(timer);
  }, [view.phase]);
  const input = useCallback((control: Control) => {
    if (current.current.phase === "playing" && !sending.current)
      runner.current?.input(control);
  }, []);
  const enter = useCallback(() => {
    const active = runner.current,
      state = current.current;
    if (!active || state.phase !== "playing" || sending.current) return;
    const f = active.advance(performance.now() + offset.current);
    const gate = nearbyGate(f, active.room);
    if (gate === null) return;
    void action({
      kind: "enter",
      nonce: state.nonce,
      client,
      room: active.index,
      gate,
      through: f.tick,
      inputs: active.inputs.filter((input) => input.tick <= f.tick),
    });
  }, [action, client]);
  const waitingAfterTimeout = Boolean(
    frame?.timedOut && view.phase === "playing",
  );
  useEffect(() => {
    if (!waitingAfterTimeout) return;
    const timer = setInterval(
      () =>
        void action({ kind: "status", nonce: current.current.nonce, client }),
      2500,
    );
    return () => clearInterval(timer);
  }, [waitingAfterTimeout, action, client]);
  const active = view.phase === "playing" && !frame?.timedOut;
  const finished = ["won", "lost", "refunded", "cancelled"].includes(
    view.phase,
  );
  const index = Math.min(
    view.room?.index ??
      (view.phase === "intermission"
        ? Math.max(0, view.cleared - 1)
        : view.cleared),
    view.maxRooms - 1,
  );
  const room = runner.current?.room;
  const elapsed = frame ? (frame.tick * 1000) / PHYSICS.ticksPerSecond : 0;
  const remaining =
    frame && room
      ? Math.max(0, budgetMs(frame, room, view.cat, view.rules) - elapsed)
      : 0;
  const ordinary =
    frame && room
      ? roomBudgetMs(room, view.cat, view.rules) +
        (frame.hourglass ? view.rules.hourglassMs : 0) -
        elapsed
      : remaining;
  const gate =
    frame && runner.current ? nearbyGate(frame, runner.current.room) : null;
  const title = frame?.timedOut
    ? "The gas caught you"
    : view.phase === "ready"
      ? "Opening the catacombs…"
      : view.phase === "intermission"
        ? "Treasure found!"
        : view.phase === "won"
          ? "Treasure secured"
          : view.phase === "lost"
            ? "Expedition ended"
            : view.phase === "refunded"
              ? "Wager returned"
              : "Expedition cancelled";
  return (
    <section className="dungeon-stage" aria-label="Catacomb Quest">
      <div
        className="dungeon-canvas"
        ref={mount}
        role="application"
        aria-label="Dungeon. Move with arrows, jump with Space, attack with J, enter a nearby gate with Enter."
      />
      <DungeonHud
        cat={view.cat}
        frame={frame}
        room={index}
        maxRooms={view.maxRooms}
        cleared={view.cleared}
        remainingMs={remaining}
        graceActive={view.cat === "guardian" && ordinary <= 0}
        payout={view.payout}
        stake={view.stake}
        playing={view.phase === "playing"}
      />
      {frame?.hourglass && active && (
        <p className="dungeon-hourglass">
          Hourglass +{view.rules.hourglassMs / 1000}s
        </p>
      )}
      {(!active || !ready) && (
        <div className="dungeon-overlay">
          <div className="dungeon-result pixel-panel" aria-live="polite">
            <span className="dungeon-result-symbol" aria-hidden="true">
              {view.phase === "intermission" || view.phase === "won"
                ? "✦"
                : "◆"}
            </span>
            <h2>{title}</h2>
            {error && <output>{error}</output>}
            {view.phase === "intermission" && (
              <>
                <p className="dungeon-treasure">
                  {displayUsdc(view.payout)} USDC
                </p>
                <p>
                  {displayMultiplier(view.payout, view.stake)} gross return,
                  including your bet. Bank it or risk it in the next room.
                </p>
                <div className="dungeon-result-actions">
                  <button
                    className="pixel-button"
                    data-tone="gold"
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void action({
                        kind: "cashout",
                        nonce: view.nonce,
                        client,
                      })
                    }
                  >
                    Cash out
                  </button>
                  <button
                    className="pixel-button"
                    data-tone="green"
                    type="button"
                    disabled={busy || !ready}
                    onClick={() =>
                      void action({
                        kind: "start",
                        nonce: view.nonce,
                        client,
                        room: view.cleared,
                      })
                    }
                  >
                    Go deeper
                  </button>
                </div>
              </>
            )}
            {(finished || frame?.timedOut) && (
              <>
                {view.phase !== "lost" && !frame?.timedOut && (
                  <p className="dungeon-treasure">
                    {displayUsdc(view.payout)} USDC
                  </p>
                )}
                <p>
                  {view.settled
                    ? "Your expedition is finalized."
                    : "Saving your result and settling automatically…"}
                </p>
                <button className="pixel-button" type="button" onClick={onDone}>
                  Back to lobby
                </button>
              </>
            )}
          </div>
        </div>
      )}
      {active && ready && (
        <DungeonControls
          enabled={!busy}
          gate={gate}
          onControl={input}
          onEnter={enter}
        />
      )}
      {error && active && <output className="dungeon-notice">{error}</output>}
    </section>
  );
}
