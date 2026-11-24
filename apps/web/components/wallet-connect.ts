import type { WalletContextState } from "@solana/wallet-adapter-react";

type Wallet = Pick<WalletContextState, "wallet" | "select" | "connect">;
type Adapter = NonNullable<Wallet["wallet"]>["adapter"];

export function requestWalletConnection(
  wallet: Wallet,
  adapter: Adapter,
  onFailure: () => void,
): () => void {
  let active = true;
  const fail = () => {
    if (active) onFailure();
  };

  if (wallet.wallet?.adapter === adapter) {
    void wallet.connect().then(() => {
      if (!adapter.connected && !adapter.connecting) fail();
    }, fail);
  } else {
    // WalletProvider performs an interactive connect on explicit selection,
    // after it has subscribed to this adapter's connection events.
    adapter.once("error", fail);
    wallet.select(adapter.name);
  }

  return () => {
    active = false;
    adapter.off("error", fail);
  };
}
