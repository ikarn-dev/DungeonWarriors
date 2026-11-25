import type { useWallet } from "@solana/wallet-adapter-react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { lobbySounds } from "../lib/audio/lobby-sounds";
import { displayUsdc } from "../lib/game/custody-client";
import { UiIcon } from "./UiIcon";
import { WarriorIcon } from "./WarriorIcon";
import { requestWalletConnection } from "./wallet-connect";

type Wallet = ReturnType<typeof useWallet>;

// Lists the wallets the browser exposes (Wallet Standard detection). One
// press selects the wallet and opens its connect prompt.
export function WalletPicker({
  wallet,
  busy = false,
  titleId,
}: {
  readonly wallet: Wallet;
  readonly busy?: boolean;
  readonly titleId?: string;
}) {
  const [failedWallet, setFailedWallet] = useState<string | null>(null);
  const clearAttempt = useRef<(() => void) | null>(null);
  useEffect(() => () => clearAttempt.current?.(), []);
  const selected = wallet.wallet?.adapter.name ?? null;
  // No adapters are registered by hand, so this list holds only wallets the
  // browser announced (plus Mobile Wallet Adapter on phones).
  const detected = wallet.wallets;
  return (
    <div className="wallet-picker">
      <h2 id={titleId}>Connect a wallet</h2>
      {detected.length === 0 ? (
        <p>
          No Solana wallet found in this browser. Install one, such as Phantom
          or Solflare, then reload the page.
        </p>
      ) : (
        <ul>
          {detected.map(({ adapter }) => (
            <li key={adapter.name}>
              <button
                type="button"
                className="pixel-button"
                data-shape="round"
                data-tone={detected.length === 1 ? "gold" : undefined}
                disabled={busy || wallet.connecting || wallet.disconnecting}
                onClick={() => {
                  clearAttempt.current?.();
                  setFailedWallet(null);
                  clearAttempt.current = requestWalletConnection(
                    wallet,
                    adapter,
                    () => setFailedWallet(adapter.name),
                  );
                }}
              >
                <Image
                  unoptimized
                  src={adapter.icon}
                  alt=""
                  width={28}
                  height={28}
                />
                <span className="wallet-picker-name">{adapter.name}</span>
                <span className="wallet-picker-tag">
                  {wallet.connecting && selected === adapter.name
                    ? "Connecting…"
                    : "Detected"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {failedWallet !== null && (
        <p role="alert">
          Couldn’t connect to {failedWallet}. Open and unlock your wallet, then
          select it again.
        </p>
      )}
      {wallet.connecting && selected !== null && failedWallet === null && (
        <p aria-live="polite">Open {selected} to finish connecting.</p>
      )}
    </div>
  );
}

// Top-right bar: the in-game funds badge (settled Available credit, shown
// once the player account exists), then the wallet pill to copy the address
// or disconnect with the power icon.
export function WalletChip({
  address,
  available,
  busy,
  onCopy,
  onDisconnect,
}: {
  readonly address: string;
  // Available credit in USDC base units; null hides the badge.
  readonly available: string | null;
  readonly busy: boolean;
  readonly onCopy: () => void;
  readonly onDisconnect: () => void;
}) {
  return (
    <div className="lobby-topbar">
      {available !== null && (
        <p className="lobby-funds" title="Available to play in PURRPS">
          <span className="lobby-funds-mark" aria-hidden="true">
            <WarriorIcon name="coins" />
          </span>
          <span className="sr-only">Available in PURRPS: </span>
          <strong>{displayUsdc(available)}</strong>
          <span className="lobby-funds-unit">USDC</span>
        </p>
      )}
      <WalletPill
        address={address}
        busy={busy}
        onCopy={onCopy}
        onDisconnect={onDisconnect}
      />
    </div>
  );
}
function WalletPill({
  address,
  busy,
  onCopy,
  onDisconnect,
}: {
  readonly address: string;
  readonly busy: boolean;
  readonly onCopy: () => void;
  readonly onDisconnect: () => void;
}) {
  return (
    <div className="lobby-wallet">
      <button
        type="button"
        className="lobby-address"
        title="Copy wallet address"
        onClick={() => {
          lobbySounds.blip();
          onCopy();
        }}
      >
        <span className="sr-only">Copy wallet address </span>
        {address.slice(0, 4)}…{address.slice(-4)}
        <UiIcon name="copy" size={14} />
      </button>
      <button
        type="button"
        className="lobby-disconnect"
        aria-label="Disconnect wallet"
        title="Disconnect"
        disabled={busy}
        onClick={() => {
          lobbySounds.powerDown();
          onDisconnect();
        }}
      >
        <UiIcon name="power" size={18} />
      </button>
    </div>
  );
}
