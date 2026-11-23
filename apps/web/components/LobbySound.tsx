"use client";

import { useEffect, useSyncExternalStore } from "react";
import { lobbyMusic } from "../lib/audio/lobby-music";
import type { LobbyTrack } from "../lib/audio/lobby-tracks";

// Sound defaults to on and starts with the first tap or key press, as
// browsers require. The choice is remembered on this device.
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

export default function LobbySound({ track }: { readonly track: LobbyTrack }) {
  const enabled = useSyncExternalStore(subscribe, readEnabled, () => true);

  useEffect(() => {
    lobbyMusic.setTrack(track);
    return () => lobbyMusic.setTrack(null);
  }, [track]);
  useEffect(() => lobbyMusic.setEnabled(enabled), [enabled]);
  useEffect(() => {
    // Capture phase: unlock audio inside the gesture, then add a soft blip
    // for pixel buttons and a short meow for Start.
    const press = (event: Event) => {
      lobbyMusic.unlock();
      if (!(event.target instanceof Element)) return;
      const control = event.target.closest(".lobby a, .lobby button");
      if (!control || control.matches(":disabled, .lobby-sound")) return;
      if (control.matches(".lobby-play")) lobbyMusic.start();
      else if (
        control.matches(".pixel-button, .dpad-arm, .face-button, .console-pill")
      )
        lobbyMusic.blip();
    };
    // Hover chirp for Start, mouse pointers only.
    const over = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || !(event.target instanceof Element))
        return;
      const start = event.target.closest(".lobby-play");
      const from = event.relatedTarget;
      if (start && !(from instanceof Node && start.contains(from)))
        lobbyMusic.hover();
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

  return <LobbySoundToggle />;
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
        lobbyMusic.unlock();
        lobbyMusic.cue(!enabled);
        writeEnabled(!enabled);
      }}
    >
      <span
        className="pixel-icon"
        data-icon={enabled ? "sound" : "mute"}
        aria-hidden="true"
      />
    </button>
  );
}
