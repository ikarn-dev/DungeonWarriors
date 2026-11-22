"use client";

import type { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { type RefObject, useEffect, useRef, useState } from "react";
import type { PlayerIntent } from "../lib/game/protocol";
import { RULES_V1 } from "../lib/game/rules";
import { sendRunInput } from "../lib/game/run-input";

const button = "run-control";
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
}: {
  rpc: Connection;
  run: PublicKey;
  playKey: Keypair;
  accepted: bigint;
  eligible: boolean;
  playing: boolean;
  artReady: boolean;
  surface: RefObject<HTMLDivElement | null>;
}) {
  const root = useRef<HTMLFieldSetElement>(null);
  const [paused, setPaused] = useState(false);
  const [portrait, setPortrait] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [cashOut, setCashOut] = useState(false);
  const enqueue = useRef<(action: PlayerIntent) => void>(() => {});
  const resume = useRef<() => void>(() => {});
  const policy = useRef({ accepted, eligible, playing, artReady });
  useEffect(() => {
    policy.current = { accepted, eligible, playing, artReady };
  }, [accepted, eligible, playing, artReady]);

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
    const isCash = ({ kind }: PlayerIntent) => kind === "cashOut";

    function queueAction(action: PlayerIntent) {
      if (
        inputLost ||
        !policy.current.playing ||
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
    }

    function inactive() {
      if (!document.hidden && !vertical.matches) return;
      pendingInactive();
    }
    function pendingInactive() {
      if (!active) return;
      active = false;
      held.clear();
      queue = queue.filter(isCash);
      liveness = { kind: "inactive" };
      setPaused(true);
    }
    function orientationChanged() {
      setPortrait(vertical.matches);
      inactive();
    }
    orientationChanged();
    setPaused(!active);
    enqueue.current = queueAction;
    resume.current = () => {
      if (vertical.matches || document.hidden || inputLost) return;
      active = true;
      setPaused(false);
      liveness = { kind: "heartbeat", active: true };
    };
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
      pendingInactive();
    }
    vertical.addEventListener("change", orientationChanged);
    document.addEventListener("visibilitychange", inactive);
    window.addEventListener("blur", blur);
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
      if (busy || inputLost) return;
      let actions: PlayerIntent[];
      if (liveness) {
        actions = [liveness];
        liveness = null;
      } else {
        if (queue.length === 0) return;
        actions = queue.splice(0, 8);
      }
      busy = true;
      try {
        const next =
          localSequence > policy.current.accepted
            ? localSequence
            : policy.current.accepted;
        if (await sendRunInput(rpc, run, playKey, next, actions, signal)) {
          localSequence = next + BigInt(actions.length);
          setMessage(null);
        } else {
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
    const commands = setInterval(
      () => void flush(),
      1000 / RULES_V1.maxControlUpdatesPerSecond,
    );
    const heartbeat = setInterval(() => {
      if (active && policy.current.playing && policy.current.artReady)
        liveness = { kind: "heartbeat", active: true };
    }, 1000);
    return () => {
      controller.abort();
      clearInterval(commands);
      clearInterval(heartbeat);
      vertical.removeEventListener("change", orientationChanged);
      document.removeEventListener("visibilitychange", inactive);
      window.removeEventListener("blur", blur);
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
    };
  }, [rpc, run, playKey, surface]);

  return (
    <fieldset className="run-controls" aria-label="Run controls" ref={root}>
      {playing && paused && !portrait && (
        <button
          type="button"
          className={button}
          onClick={() => resume.current()}
        >
          Resume controls
        </button>
      )}
      <div className="run-control-row">
        {(["left", "right"] as const).map((axis) => (
          <button
            key={axis}
            type="button"
            className={button}
            aria-label={axis === "left" ? "Move left" : "Move right"}
            data-direction
            disabled={paused || !playing || !artReady}
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
            <span aria-hidden="true">{axis === "left" ? "←" : "→"}</span>
          </button>
        ))}
        {(["jump", "dash", "boost"] as const).map((kind) => (
          <button
            type="button"
            key={kind}
            className={button}
            disabled={paused || !playing || !artReady}
            onClick={() => enqueue.current({ kind })}
          >
            {kind === "jump" ? "Jump" : kind === "dash" ? "Dash" : "Boost"}
          </button>
        ))}
        <button
          type="button"
          className={button}
          data-cash-out
          disabled={!eligible || cashOut || !playing}
          onClick={() => enqueue.current({ kind: "cashOut" })}
        >
          {cashOut ? "Cash-out requested" : "Cash Out"}
        </button>
      </div>
      {playing && !paused && artReady && (
        <p className="run-keyboard">
          ← / → Move · ↑ Jump · Shift Dash · B Boost · C Cash out
        </p>
      )}
      {message && <output className="text-sm">{message}</output>}
    </fieldset>
  );
}
