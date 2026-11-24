"use client";
import type { useWallet } from "@solana/wallet-adapter-react";
import { useEffect, useRef } from "react";
import { WalletPicker } from "./LobbyWallet";
import { UiIcon } from "./UiIcon";

// Wallet selection as a modal over the current screen. Closing it (the
// close button or Escape) cancels; connecting closes it from the caller.
export default function WalletDialog({
  open,
  wallet,
  busy = false,
  onClose,
}: {
  readonly open: boolean;
  readonly wallet: ReturnType<typeof useWallet>;
  readonly busy?: boolean;
  readonly onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const surface = dialog.current;
    if (!surface) return;
    if (open && !surface.open) surface.showModal();
    else if (!open && surface.open) surface.close();
  }, [open]);
  return (
    <dialog
      ref={dialog}
      className="wallet-dialog pixel-panel"
      aria-labelledby={open ? "wallet-dialog-title" : undefined}
      onClose={onClose}
    >
      {open && (
        <div className="wallet-dialog-body">
          <button
            type="button"
            className="wallet-dialog-close"
            aria-label="Close"
            onClick={() => dialog.current?.close()}
          >
            <UiIcon name="cross" size={16} />
          </button>
          <WalletPicker
            wallet={wallet}
            busy={busy}
            titleId="wallet-dialog-title"
          />
        </div>
      )}
    </dialog>
  );
}
