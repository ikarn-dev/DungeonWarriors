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
  DEFEAT_HEAL,
  type DungeonFrame,
  nearbyGate,
  roomBudgetMs,
} from "../lib/dungeon/simulation";
import { WARRIORS } from "../lib/dungeon/warriors";
import { displayUsdc } from "../lib/game/custody-client";
import DungeonControls from "./DungeonControls";
import DungeonHud from "./DungeonHud";

export default function DungeonStage({
  view,
  artwork,
  client,
  send,
  onDone,
}: {
  readonly view: DungeonView;
  readonly artwork: DungeonArtwork;
  readonly client: string;
  readonly send: (input: DungeonRequest) => Promise<DungeonView | null>;
  readonly onDone: () => void;
}) {
  const mount = useRef<HTMLDivElement>(null),
    runner = useRef<DungeonRunner | null>(null);
  const current = useRef(view),
    offset = useRef(0),
    sending = useRef(false),
    notified = useRef(false);
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
        setError("Checking your saved expedition…");
        try {
          return await send({
            kind: "status",
            nonce: current.current.nonce,
            client,
          });
        } catch {
          return null;
        }
      } finally {
        sending.current = false;
        setBusy(false);
      }
    },
    [send, client],
  );
  const leave = useCallback(() => {
    const state = current.current;
    if (state.settled) return;
    void fetch("/api/dungeon", {
      method: "POST",
      credentials: "same-origin",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "exit", nonce: state.nonce, client }),
    }).catch(() =>
      setError("Your saved deadline will resolve this expedition."),
    );
  }, [client]);
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
    const report = () => {
      setError("The dungeon display stopped. Resolving automatically…");
      void send({ kind: "exit", nonce: current.current.nonce, client }).catch(
        () =>
          setError(
            "Your saved deadline will resolve this expedition when you return.",
          ),
      );
    };
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
          onReady: () => setReady(true),
          onError: () => {
            setError(
              "The dungeon display stopped. Resolving your saved expedition automatically.",
            );
            void action({ kind: "exit", nonce: current.current.nonce, client });
          },
          onTimeout: timeout,
          preloaded: artwork.images,
        },
      );
    } catch {
      report();
    }
    return () => {
      parent.removeEventListener("webglcontextlost", report, true);
      destroy?.();
    };
  }, [artwork, action, client, timeout, send]);
  useEffect(() => {
    if (view.phase !== "playing") return;
    const timer = setInterval(() => {
      if (runner.current) setFrame({ ...runner.current.frame });
    }, 100);
    const hidden = () => {
      if (document.hidden) {
        notified.current = true;
        leave();
      } else
        void action({ kind: "status", nonce: current.current.nonce, client });
    };
    window.addEventListener("pagehide", leave);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      clearInterval(timer);
      window.removeEventListener("pagehide", leave);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [view.phase, leave, action, client]);
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
  const warrior = WARRIORS[view.cat];
  const gate =
    frame && runner.current ? nearbyGate(frame, runner.current.room) : null;
  const title = frame?.timedOut
    ? "The gas caught you"
    : view.phase === "preparing"
      ? "Preparing your expedition…"
      : view.phase === "ready"
        ? "Enter the catacombs"
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
            {view.phase === "ready" && (
              <>
                <p>
                  Fight through the room, defeat the warden and reach a gate
                  before the green gas. Two gates hold treasure; one is a trap.
                </p>
                <ul className="dungeon-traits">
                  {warrior.traits.map((t) => (
                    <li key={t.id}>
                      <strong>{t.name}</strong> {t.description}
                    </li>
                  ))}
                </ul>
                <p>
                  Each beaten foe heals {DEFEAT_HEAL} health. Rooms get longer,
                  busier and their foes bigger as you go deeper. Leaving during
                  a room ends the expedition.
                </p>
                <button
                  className="pixel-button"
                  data-tone="gold"
                  type="button"
                  disabled={!ready || busy}
                  onClick={() =>
                    void action({
                      kind: "start",
                      nonce: view.nonce,
                      client,
                      room: 0,
                    })
                  }
                >
                  Start exploring
                </button>
              </>
            )}
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
            {view.phase === "preparing" && (
              <p>
                Getting the dungeon ready. Your room timer starts when you tap
                Start exploring.
              </p>
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
