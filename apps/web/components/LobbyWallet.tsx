import type { useWallet } from "@solana/wallet-adapter-react";
import { lobbyMusic } from "../lib/audio/lobby-music";
import { type Fill, PixelMark } from "./PixelMark";

type Wallet = ReturnType<typeof useWallet>;
const ink: Fill = (key) => (key === "o" ? "currentColor" : null);
const POWER = [
  "....o....",
  "..o.o.o..",
  ".o..o..o.",
  "o...o...o",
  "o.......o",
  "o.......o",
  ".o.....o.",
  "..ooooo..",
] as const;
const COPY = [
  "..ooooo",
  "..o...o",
  "ooooo.o",
  "o...o.o",
  "o...ooo",
  "o...o..",
  "ooooo..",
] as const;

export function WalletPicker({
  wallet,
  busy,
  onConnect,
}: {
  readonly wallet: Wallet;
  readonly busy: boolean;
  readonly onConnect: () => void;
}) {
  return (
    <div className="lobby-stack">
      <label htmlFor="wallet-choice" className="lobby-label">
        Solana wallet
      </label>
      <select
        id="wallet-choice"
        className="pixel-field"
        value={wallet.wallet?.adapter.name ?? ""}
        disabled={busy}
        onChange={(event) => {
          const selected = wallet.wallets.find(
            (value) => value.adapter.name === event.target.value,
          );
          if (selected !== undefined) wallet.select(selected.adapter.name);
        }}
      >
        <option value="" disabled>
          Select a wallet
        </option>
        {wallet.wallets.map((value) => (
          <option key={value.adapter.name} value={value.adapter.name}>
            {value.adapter.name}
          </option>
        ))}
      </select>
      {wallet.wallets.length === 0 && (
        <p>No compatible wallet detected in this browser.</p>
      )}
      <button
        type="button"
        className="pixel-button"
        data-tone="gold"
        disabled={wallet.wallet === null || wallet.connecting || busy}
        onClick={onConnect}
      >
        {wallet.connecting ? "Connecting…" : "Connect wallet"}
      </button>
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
          lobbyMusic.blip();
          onCopy();
        }}
      >
        <span className="sr-only">Copy wallet address </span>
        {address.slice(0, 4)}…{address.slice(-4)}
        <PixelMark rows={COPY} fill={ink} />
      </button>
      <button
        type="button"
        className="lobby-disconnect"
        aria-label="Disconnect wallet"
        title="Disconnect"
        disabled={busy}
        onClick={() => {
          lobbyMusic.powerDown();
          onDisconnect();
        }}
      >
        <PixelMark rows={POWER} fill={ink} />
      </button>
    </div>
  );
}
