"use client";
import { useCallback, useEffect, useRef } from "react";
import type { Control } from "../lib/dungeon/simulation";
import type { Weapon } from "../lib/dungeon/warriors";
import { WarriorIcon } from "./WarriorIcon";

// Control bar: movement keys on the left, actions on the right, each with its
// keyboard key shown (hidden on touch-only screens).
export default function DungeonControls({
  enabled,
  gate,
  weapon,
  onControl,
  onEnter,
}: {
  readonly enabled: boolean;
  readonly gate: number | null;
  readonly weapon: Weapon;
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
  const hold = (direction: "left" | "right", down: boolean) => {
    if (down) pressed.current.add(`pointer-${direction}`);
    else pressed.current.delete(`pointer-${direction}`);
    update();
  };
  return (
    <fieldset className="dungeon-controls" aria-label="Dungeon controls">
      <div className="dungeon-movement">
        {(["left", "right"] as const).map((direction) => (
          <button
            key={direction}
            type="button"
            className="dungeon-key"
            aria-label={`Move ${direction}`}
            aria-keyshortcuts={
              direction === "left" ? "ArrowLeft A" : "ArrowRight D"
            }
            disabled={!enabled}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              hold(direction, true);
            }}
            onPointerUp={() => hold(direction, false)}
            onPointerCancel={() => hold(direction, false)}
            onLostPointerCapture={() => hold(direction, false)}
          >
            <WarriorIcon name={direction} />
            <span className="keycap" aria-hidden="true">
              {direction === "left" ? "A" : "D"}
            </span>
          </button>
        ))}
      </div>
      <div className="dungeon-actions">
        <button
          className="dungeon-key"
          data-wide
          type="button"
          aria-keyshortcuts="Enter"
          disabled={!enabled || gate === null}
          onClick={onEnter}
        >
          <WarriorIcon name="gate" />
          <span>{gate === null ? "No gate" : `Gate ${gate + 1}`}</span>
          <span className="keycap" aria-hidden="true">
            Enter
          </span>
        </button>
        <button
          className="dungeon-key"
          data-tone="gold"
          data-wide
          type="button"
          aria-keyshortcuts="J"
          disabled={!enabled}
          onClick={(event) => {
            if (event.detail === 0) onControl({ kind: "attack" });
          }}
          onPointerDown={(event) => {
            event.preventDefault();
            onControl({ kind: "attack" });
          }}
        >
          <WarriorIcon name={weapon} />
          <span>Attack</span>
          <span className="keycap" aria-hidden="true">
            J
          </span>
        </button>
        <button
          className="dungeon-key"
          data-tone="teal"
          data-wide
          type="button"
          aria-keyshortcuts="Space"
          disabled={!enabled}
          onClick={(event) => {
            if (event.detail === 0) onControl({ kind: "jump" });
          }}
          onPointerDown={(event) => {
            event.preventDefault();
            onControl({ kind: "jump" });
          }}
        >
          <WarriorIcon name="jump" />
          <span>Jump</span>
          <span className="keycap" aria-hidden="true">
            Space
          </span>
        </button>
      </div>
    </fieldset>
  );
}
