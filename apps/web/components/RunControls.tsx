"use client";

import type { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { type RefObject, useEffect, useRef, useState } from "react";
import type { PlayerIntent } from "../lib/game/protocol";
import { RULES_V1 } from "../lib/game/rules";
import { sendRunInput } from "../lib/game/run-input";

const button = "pixel-button run-control";
const powerIcons = {
  magnet: "magnet",
  doubleJump: "double-jump",
  shield: "shield",
  extraDash: "extra-dash",
} as const;
const binding: Record<string, PlayerIntent> = {
  ArrowLeft: { kind: "move", axis: "left" },
  ArrowRight: { kind: "move", axis: "right" },
  ArrowUp: { kind: "jump" },
  " ": { kind: "jump" },
  Shift: { kind: "dash" },
  b: { kind: "boost" },
  c: { kind: "cashOut" },
};

export default function RunControls({
  rpc,
  run,
  playKey,
  accepted,
  eligible,
  playing,
  artReady,
  surface,
  power,
  payout,
  onInputs,
  rulesVersion,
}: {
  rpc: Connection;
  run: PublicKey;
  playKey: Keypair;
  accepted: bigint;
  eligible: boolean;
  playing: boolean;
  artReady: boolean;
  surface: RefObject<HTMLDivElement | null>;
  power: {
    id: keyof typeof powerIcons;
    name: string;
    ready: boolean;
    active: boolean;
    remaining: number;
    detail: string;
  };
  payout: { amount: string; multiplier: string } | null;
  onInputs: (sequence: bigint, actions: readonly PlayerIntent[]) => void;
  rulesVersion: number;
}) {
  const root = useRef<HTMLFieldSetElement>(null);
  const [paused, setPaused] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [cashOut, setCashOut] = useState(false);
  const enqueue = useRef<(action: PlayerIntent) => void>(() => {});
  const powerReady = power.ready;
  const policy = useRef({ accepted, eligible, playing, artReady, powerReady });
  useEffect(() => {
    policy.current = { accepted, eligible, playing, artReady, powerReady };
  }, [accepted, eligible, playing, artReady, powerReady]);

  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;
    const vertical = matchMedia(
      "(orientation: portrait) and (pointer: coarse)",
    );
    const held = new Set<string>();
    let active = !vertical.matches && !document.hidden;
    let busy = false;
    let inputLost = false;
    let localSequence = policy.current.accepted;
    let queue: PlayerIntent[] = [];
    let liveness: PlayerIntent | null = null;
    let wasPlaying = false;
    let cashPending = false;
    let lastFlush = -Infinity;
    const sendInterval = 1000 / RULES_V1.maxControlUpdatesPerSecond;
    const isCash = ({ kind }: PlayerIntent) => kind === "cashOut";

    function queueAction(action: PlayerIntent) {
      if (
        inputLost ||
        !policy.current.playing ||
        (action.kind === "boost" && !policy.current.powerReady) ||
        (action.kind === "cashOut"
          ? !policy.current.eligible || cashPending
          : !active || !policy.current.artReady)
      )
        return;
      if (action.kind === "move")
        queue = queue.filter(({ kind }) => kind !== "move");
      if (queue.length >= 8) {
        if (action.kind !== "cashOut") {
          setMessage("Controls are catching up. Try again.");
          return;
        }
        queue = [];
      }
      if (action.kind === "cashOut") {
        cashPending = true;
        setCashOut(true);
        queue.unshift(action);
      } else queue.push(action);
      void flush();
    }

    function inactive() {
      if (document.hidden || vertical.matches) pendingInactive();
      else if (document.hasFocus()) restoreControls();
    }
    function pendingInactive() {
      if (!active) return;
      active = false;
      held.clear();
      queue = queue.filter(isCash);
      liveness = { kind: "inactive" };
      setPaused(true);
    }
    inactive();
    setPaused(!active);
    enqueue.current = queueAction;
    function restoreControls() {
      if (vertical.matches || document.hidden || inputLost) return;
      if (active) return;
      active = true;
      setPaused(false);
      liveness = { kind: "heartbeat", active: true };
      if (policy.current.playing)
        surface.current?.focus({ preventScroll: true });
      void flush();
    }
    function keyAction(event: KeyboardEvent) {
      const action =
        binding[event.key.length === 1 ? event.key.toLowerCase() : event.key];
      if (
        action &&
        (surface.current === document.activeElement ||
          root.current?.contains(document.activeElement) ||
          held.has(event.key)) &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      )
        return action;
      return undefined;
    }
    function keyDown(event: KeyboardEvent) {
      const action = keyAction(event);
      if (!action) return;
      if (event.key === " " && event.target instanceof HTMLButtonElement)
        return;
      event.preventDefault();
      if (event.repeat) return;
      if (action.kind === "move") held.add(event.key);
      queueAction(action);
    }
    function keyUp(event: KeyboardEvent) {
      if (!held.delete(event.key)) return;
      const keys = [...held];
      const last = keys[keys.length - 1];
      const action = last ? binding[last] : undefined;
      queueAction(
        action?.kind === "move" ? action : { kind: "move", axis: "neutral" },
      );
    }
    function blur() {
      if (held.size > 0) {
        held.clear();
        queueAction({ kind: "move", axis: "neutral" });
      }
    }
    vertical.addEventListener("change", inactive);
    document.addEventListener("visibilitychange", inactive);
    window.addEventListener("blur", blur);
    window.addEventListener("focus", restoreControls);
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    // One in-flight message at a time keeps strict sequential nonces, even on lost replies.
    async function flush() {
      if (signal.aborted) return;
      if (!policy.current.playing) {
        if (wasPlaying) {
          wasPlaying = false;
          held.clear();
          queue = [];
          liveness = null;
          cashPending = false;
          setCashOut(false);
        }
        return;
      }
      if (!wasPlaying) {
        wasPlaying = true;
        liveness =
          active && policy.current.artReady
            ? { kind: "heartbeat", active: true }
            : { kind: "inactive" };
      }
      if (busy || inputLost || performance.now() - lastFlush < sendInterval)
        return;
      let actions: PlayerIntent[];
      if (liveness) {
        actions = [liveness];
        liveness = null;
      } else {
        if (queue.length === 0) return;
        actions = queue.splice(0, 8);
      }
      busy = true;
      lastFlush = performance.now();
      try {
        const next =
          localSequence > policy.current.accepted
            ? localSequence
            : policy.current.accepted;
        onInputs(next, actions);
        if (
          await sendRunInput(
            rpc,
            run,
            playKey,
            next,
            actions,
            signal,
            rulesVersion,
          )
        ) {
          localSequence = next + BigInt(actions.length);
          setMessage(null);
        } else {
          onInputs(next, []);
          setMessage("Control was declined by MagicBlock.");
          if (actions.some(isCash)) {
            cashPending = false;
            setCashOut(false);
          }
        }
      } catch {
        if (signal.aborted) return;
        inputLost = true;
        setMessage(
          "Controls lost their connection. The run is still resolved onchain.",
        );
      } finally {
        busy = false;
      }
    }
    const commands = setInterval(() => void flush(), sendInterval);
    const heartbeat = setInterval(() => {
      if (active && policy.current.playing && policy.current.artReady)
        liveness = { kind: "heartbeat", active: true };
    }, 1000);
    return () => {
      controller.abort();
      clearInterval(commands);
      clearInterval(heartbeat);
      vertical.removeEventListener("change", inactive);
      document.removeEventListener("visibilitychange", inactive);
      window.removeEventListener("blur", blur);
      window.removeEventListener("focus", restoreControls);
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
    };
  }, [rpc, run, playKey, surface, onInputs, rulesVersion]);

  function playAction(kind: "dash" | "boost" | "jump", byPointer: boolean) {
    enqueue.current({ kind });
    // Keep Space available for the next jump after clicking a control.
    if (byPointer) surface.current?.focus({ preventScroll: true });
  }

  const controlsOff = paused || !playing || !artReady;
  return (
    <fieldset className="run-controls" aria-label="Run controls" ref={root}>
      <div className="run-pad" data-pad="move">
        {(["left", "right"] as const).map((axis) => (
          <button
            key={axis}
            type="button"
            className={button}
            aria-label={axis === "left" ? "Move left" : "Move right"}
            data-direction
            disabled={controlsOff}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              enqueue.current({ kind: "move", axis });
            }}
            onLostPointerCapture={() =>
              enqueue.current({ kind: "move", axis: "neutral" })
            }
            onKeyDown={(event) => {
              if (event.key === " " || event.key === "Enter") {
                event.preventDefault();
                enqueue.current({ kind: "move", axis });
              }
            }}
            onKeyUp={(event) => {
              if (event.key === " " || event.key === "Enter")
                enqueue.current({ kind: "move", axis: "neutral" });
            }}
          >
            <span className="pixel-icon" data-icon={axis} aria-hidden="true" />
          </button>
        ))}
      </div>
      <div className="run-pad" data-pad="cash">
        <button
          type="button"
          className="pixel-button run-cash"
          data-tone={eligible ? "gold" : undefined}
          disabled={!eligible || cashOut || !playing}
          onClick={() => enqueue.current({ kind: "cashOut" })}
        >
          <span
            className="pixel-icon"
            data-icon={eligible ? "cash-out" : "lock"}
            aria-hidden="true"
          />
          <span className="run-cash-text">
            <span>
              {cashOut
                ? "Cash-out requested"
                : eligible
                  ? "Cash out"
                  : "Cash out locked"}
            </span>
            <strong>
              {payout
                ? `${payout.amount} · ${payout.multiplier}`
                : "Reach a checkpoint"}
            </strong>
          </span>
        </button>
      </div>
      <div className="run-pad" data-pad="action">
        <button
          type="button"
          className={button}
          data-tone="blue"
          disabled={controlsOff}
          onClick={(event) => playAction("dash", event.detail > 0)}
        >
          <span className="pixel-icon" data-icon="dash" aria-hidden="true" />
          <span className="run-control-label">Dash</span>
        </button>
        <button
          type="button"
          className={button}
          data-tone={power.id}
          data-active={power.active || undefined}
          disabled={controlsOff || !power.ready}
          aria-describedby={`power-${run.toBase58()}`}
          onClick={(event) => playAction("boost", event.detail > 0)}
        >
          <span
            className="run-cooldown"
            aria-hidden="true"
            style={{ transform: `scaleY(${power.remaining})` }}
          />
          <span
            className="pixel-icon"
            data-icon={powerIcons[power.id]}
            aria-hidden="true"
          />
          <span className="run-control-label">{power.name}</span>
        </button>
        <button
          type="button"
          className={button}
          data-tone="green"
          data-size="large"
          disabled={controlsOff}
          onClick={(event) => playAction("jump", event.detail > 0)}
        >
          <span className="pixel-icon" data-icon="jump" aria-hidden="true" />
          <span className="run-control-label">Jump</span>
        </button>
      </div>
      <p className="run-controls-note">
        <span id={`power-${run.toBase58()}`}>
          {power.name}: {power.detail}
        </span>
        {message && <output>{message}</output>}
      </p>
      {playing && !paused && artReady && (
        <p className="run-keyboard">
          ← / → Move · ↑ Jump · Shift Dash · B Power · C Cash out
        </p>
      )}
    </fieldset>
  );
}
