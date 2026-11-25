"use client";

import type { CSSProperties } from "react";
import { Toaster } from "sonner";
import { UiIcon } from "./UiIcon";

const toasterStyle: CSSProperties & { "--width": string } = {
  "--width": "min(28rem, calc(100vw - 2rem))",
};

// Sonner with its own styling switched off; the metal theme lives in CSS.
// The dungeon renders a second one (id "dungeon") inside its modal dialog,
// because the dialog's top layer covers the page toaster.
export default function LobbyToaster({ id }: { readonly id?: string }) {
  return (
    <Toaster
      {...(id === undefined ? {} : { id })}
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
          loader: "pixel-toast-loader",
          icon: "pixel-toast-icon",
          actionButton: "pixel-toast-action",
        },
      }}
    />
  );
}
