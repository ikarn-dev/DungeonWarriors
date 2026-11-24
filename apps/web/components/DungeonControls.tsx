"use client";
import { useCallback, useEffect, useRef } from "react";
import type { Control } from "../lib/dungeon/simulation";

export default function DungeonControls({
  enabled,
  gate,
  onControl,
  onEnter,
}: {
  readonly enabled: boolean;
  readonly gate: number | null;
  readonly onControl: (control: Control) => void;
  readonly onEnter: () => void;
}) {
  const currentGate = useRef(gate);
  useEffect(() => {
    currentGate.current = gate;
  }, [gate]);
  const pressed = useRef(new Set<string>()),
    axis = useRef<-1 | 0 | 1>(0);
  const update = useCallback(() => {
    const keys = pressed.current;
    const left = ["ArrowLeft", "KeyA", "pointer-left"].some((key) =>
      keys.has(key),
    );
    const right = ["ArrowRight", "KeyD", "pointer-right"].some((key) =>
      keys.has(key),
    );
    const next = left === right ? 0 : left ? -1 : 1;
    if (next !== axis.current) {
      axis.current = next;
      onControl({ kind: "move", axis: next });
    }
  }, [onControl]);
  useEffect(() => {
    if (!enabled) {
      pressed.current.clear();
      axis.current = 0;
      return;
    }
    onControl({ kind: "move", axis: 0 });
    const down = (event: KeyboardEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest("input,textarea,select")
      )
        return;
      if (
        event.target instanceof Element &&
        event.target.closest("button") &&
        ["Enter", "Space"].includes(event.code)
      )
        return;
      if (["ArrowLeft", "ArrowRight", "KeyA", "KeyD"].includes(event.code)) {
        event.preventDefault();
        pressed.current.add(event.code);
        update();
      } else if (["Space", "ArrowUp", "KeyW"].includes(event.code)) {
        event.preventDefault();
        if (!event.repeat) onControl({ kind: "jump" });
      } else if (["KeyJ", "KeyX", "KeyF"].includes(event.code)) {
        // Holding the key repeats swings; the runner drops any over the
        // per-second input limit.
        event.preventDefault();
        onControl({ kind: "attack" });
      } else if (event.code === "Enter" && currentGate.current !== null) {
        event.preventDefault();
        if (!event.repeat) onEnter();
      }
    };
    const up = (event: KeyboardEvent) => {
      pressed.current.delete(event.code);
      update();
    };
    const clear = () => {
      pressed.current.clear();
      update();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", clear);
    return () => {
      clear();
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", clear);
    };
  }, [enabled, onControl, onEnter, update]);
  return (
    <fieldset className="dungeon-controls" aria-label="Dungeon controls">
      <div className="dungeon-movement">
        {(["left", "right"] as const).map((direction) => (
          <button
            key={direction}
            type="button"
            className="pixel-button dungeon-direction"
            aria-label={`Move ${direction}`}
            disabled={!enabled}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              pressed.current.add(`pointer-${direction}`);
              update();
            }}
            onPointerUp={() => {
              pressed.current.delete(`pointer-${direction}`);
              update();
            }}
            onPointerCancel={() => {
              pressed.current.delete(`pointer-${direction}`);
              update();
            }}
            onLostPointerCapture={() => {
              pressed.current.delete(`pointer-${direction}`);
              update();
            }}
          >
            {direction === "left" ? "◀" : "▶"}
          </button>
        ))}
      </div>
      <p className="dungeon-key-hint">
        ← → Move · Space Jump · J Attack · Enter Gate
      </p>
      <div className="dungeon-actions">
        <button
          className="pixel-button"
          type="button"
          disabled={!enabled || gate === null}
          onClick={onEnter}
        >
          {gate === null ? "Find a gate" : `Enter ${gate + 1}`}
        </button>
        <button
          className="pixel-button dungeon-attack"
          data-tone="gold"
          type="button"
          disabled={!enabled}
          onClick={(event) => {
            if (event.detail === 0) onControl({ kind: "attack" });
          }}
          onPointerDown={(event) => {
            event.preventDefault();
            onControl({ kind: "attack" });
          }}
        >
          Attack
        </button>
        <button
          className="pixel-button"
          data-tone="green"
          type="button"
          disabled={!enabled}
          onClick={(event) => {
            if (event.detail === 0) onControl({ kind: "jump" });
          }}
          onPointerDown={(event) => {
            event.preventDefault();
            onControl({ kind: "jump" });
          }}
        >
          Jump
        </button>
      </div>
    </fieldset>
  );
}
