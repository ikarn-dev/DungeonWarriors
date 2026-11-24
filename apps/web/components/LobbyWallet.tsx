import type { useWallet } from "@solana/wallet-adapter-react";
import Image from "next/image";
import { useEffect, useState } from "react";
import { lobbySounds } from "../lib/audio/lobby-sounds";
import { UiIcon } from "./UiIcon";

type Wallet = ReturnType<typeof useWallet>;

// Lists the wallets the browser exposes (Wallet Standard detection). One
// press selects the wallet and opens its connect prompt.
export function WalletPicker({
  wallet,
  busy,
  onConnect,
  titleId,
}: {
  readonly wallet: Wallet;
  readonly busy: boolean;
  readonly onConnect: () => void;
  readonly titleId?: string;
}) {
  const [chosen, setChosen] = useState<string | null>(null);
  const selected = wallet.wallet?.adapter.name ?? null;
  // Connect once the provider has switched to the chosen wallet. If its own
  // silent auto-connect already succeeded, `connected` ends the wait.
  useEffect(() => {
    if (chosen === null || selected !== chosen || wallet.connecting) return;
    setChosen(null);
    if (!wallet.connected) onConnect();
  }, [chosen, selected, wallet.connecting, wallet.connected, onConnect]);
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
                disabled={busy || wallet.connecting}
                onClick={() => {
                  if (selected === adapter.name) onConnect();
                  else {
                    setChosen(adapter.name);
                    wallet.select(adapter.name);
                  }
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
    </div>
  );
}

// Compact wallet pill: copy the address, or disconnect with the power icon.
export function WalletChip({
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
