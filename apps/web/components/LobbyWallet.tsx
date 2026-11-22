import type { useWallet } from "@solana/wallet-adapter-react";

type Wallet = ReturnType<typeof useWallet>;

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
    <div className="lobby-wallet pixel-panel">
      <button
        type="button"
        className="lobby-address"
        title={address}
        onClick={onCopy}
      >
        <span className="sr-only">Copy wallet address </span>
        {address.slice(0, 4)}…{address.slice(-4)}
      </button>
      <button
        type="button"
        className="pixel-button"
        disabled={busy}
        onClick={onDisconnect}
      >
        Disconnect
      </button>
    </div>
  );
}
