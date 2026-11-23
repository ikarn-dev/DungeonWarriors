"use client";

import type { CSSProperties } from "react";
import { Toaster } from "sonner";
import { type Fill, PixelMark } from "./PixelMark";

const CHECK = [
  "......o",
  ".....oo",
  "o...oo.",
  "oo.oo..",
  ".ooo...",
  "..o....",
] as const;
const CROSS = [
  "o....o",
  "oo..oo",
  ".oooo.",
  "..oo..",
  ".oooo.",
  "oo..oo",
  "o....o",
] as const;
const BANG = ["oo", "oo", "oo", "oo", "..", "oo"] as const;
const green: Fill = (key) => (key === "o" ? "#8ee05c" : null);
const red: Fill = (key) => (key === "o" ? "#ff6b6b" : null);
const gold: Fill = (key) => (key === "o" ? "#ffc531" : null);
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
      icons={{
        success: <PixelMark rows={CHECK} fill={green} />,
        error: <PixelMark rows={CROSS} fill={red} />,
        info: <PixelMark rows={BANG} fill={gold} />,
        loading: <span className="pixel-spinner" />,
      }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast: "pixel-toast",
          title: "pixel-toast-title",
          icon: "pixel-toast-icon",
          actionButton: "pixel-toast-action",
        },
      }}
    />
  );
}
