"use client";

import { useEffect, useSyncExternalStore } from "react";
import { lobbySounds } from "../lib/audio/lobby-sounds";

// Sound defaults to on and starts with the first tap or key press, as
// browsers require. The choice is remembered on this device. There is no
// music; only clicks and short feedback sounds play.
const KEY = "purrps:sound";
const listeners = new Set<() => void>();
function readEnabled() {
  try {
    return window.localStorage.getItem(KEY) !== "off";
  } catch {
    // Storage can be blocked (private mode); fall back to the default.
    return true;
  }
}
function writeEnabled(enabled: boolean) {
  try {
    window.localStorage.setItem(KEY, enabled ? "on" : "off");
  } catch {
    // Unsaved preference still applies for this page view.
  }
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}
const START = ".lobby-play, .title-start";

// Click sounds for buttons and links on this screen; renders nothing.
export function LobbyClickSounds() {
  const enabled = useSyncExternalStore(subscribe, readEnabled, () => true);
  useEffect(() => lobbySounds.setEnabled(enabled), [enabled]);
  useEffect(() => {
    // Capture phase: unlock audio inside the gesture, then a soft click for
    // buttons and the start jingle for Start.
    const press = (event: Event) => {
      lobbySounds.unlock();
      if (!(event.target instanceof Element)) return;
      const control = event.target.closest(".lobby a, .lobby button");
      if (!control || control.matches(":disabled, .lobby-sound")) return;
      if (control.matches(START)) lobbySounds.start();
      else if (
        control.matches(
          ".pixel-button, .metal-key, .title-start, .lobby-option, .dungeon-key, .dpad-arm, .face-button, .console-pill",
        )
      )
        lobbySounds.blip();
    };
    // Hover chirp for Start and the main-menu options, mouse pointers only.
    const over = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || !(event.target instanceof Element))
        return;
      const start = event.target.closest(`${START}, .lobby-option`);
      const from = event.relatedTarget;
      if (start && !(from instanceof Node && start.contains(from)))
        lobbySounds.hover();
    };
    window.addEventListener("pointerdown", press, true);
    window.addEventListener("keydown", press, true);
    window.addEventListener("pointerover", over, true);
    return () => {
      window.removeEventListener("pointerdown", press, true);
      window.removeEventListener("keydown", press, true);
      window.removeEventListener("pointerover", over, true);
    };
  }, []);
  return null;
}

// Click sounds plus the on/off toggle.
export default function LobbySound() {
  return (
    <>
      <LobbyClickSounds />
      <LobbySoundToggle />
    </>
  );
}

export function LobbySoundToggle() {
  const enabled = useSyncExternalStore(subscribe, readEnabled, () => true);
  const label = enabled ? "Turn sound off" : "Turn sound on";
  return (
    <button
      type="button"
      className="pixel-button lobby-sound"
      aria-label={label}
      aria-pressed={enabled}
      title={label}
      onClick={() => {
        lobbySounds.unlock();
        lobbySounds.cue(!enabled);
        writeEnabled(!enabled);
      }}
    >
      <svg
        viewBox="0 0 24 24"
        width="20"
        height="20"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" />
        {enabled ? (
          <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />
        ) : (
          <path d="M16 9l5 6M21 9l-5 6" />
        )}
      </svg>
    </button>
  );
}
