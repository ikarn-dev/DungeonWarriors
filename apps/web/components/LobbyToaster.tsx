"use client";

import type { CSSProperties } from "react";
import { Toaster } from "sonner";
import { webErrorMessage } from "../lib/game/web-api";
import { type Fill, PixelMark } from "./PixelMark";

const CHECK = [
  "......o",
  ".....oo",
  "o...oo.",
  "oo.oo..",
  ".ooo...",
  "..o....",
] as const;
const green: Fill = (key) => (key === "o" ? "#8ee05c" : null);
const toasterStyle: CSSProperties & { "--width": string } = {
  "--width": "20rem",
};

// Sonner with its own styling switched off; the pixel theme lives in CSS.
export default function LobbyToaster() {
  return (
    <Toaster
      position="top-center"
      offset={{ top: "4.75rem" }}
      mobileOffset={{ top: "4.75rem" }}
      duration={2400}
      visibleToasts={3}
      style={toasterStyle}
      icons={{ success: <PixelMark rows={CHECK} fill={green} /> }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast: "pixel-toast",
          title: "pixel-toast-title",
          icon: "pixel-toast-icon",
        },
      }}
    />
  );
}

export function LobbyRequestStatus({
  message,
  error,
  busy,
  onCheck,
}: {
  message: string | null;
  error: string | null;
  busy: boolean;
  onCheck: (() => void) | null;
}) {
  if (!message && error === null && !onCheck) return null;
  return (
    <footer className="lobby-status">
      {message && <output aria-live="polite">{message}</output>}
      {error !== null && <p role="alert">{webErrorMessage(error)}</p>}
      {onCheck && (
        <button
          type="button"
          className="pixel-button"
          disabled={busy}
          onClick={onCheck}
        >
          Check transaction
        </button>
      )}
    </footer>
  );
}
