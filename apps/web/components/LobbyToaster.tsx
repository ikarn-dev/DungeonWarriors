"use client";

import type { CSSProperties } from "react";
import { Toaster } from "sonner";
import { UiIcon } from "./UiIcon";

const toasterStyle: CSSProperties & { "--width": string } = {
  "--width": "20rem",
};

// Sonner with its own styling switched off; the metal theme lives in CSS.
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
        success: (
          <span className="pixel-toast-mark" data-kind="success">
            <UiIcon name="check" />
          </span>
        ),
        error: (
          <span className="pixel-toast-mark" data-kind="error">
            <UiIcon name="cross" />
          </span>
        ),
        info: (
          <span className="pixel-toast-mark" data-kind="info">
            <UiIcon name="alert" />
          </span>
        ),
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
