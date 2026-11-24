"use client";
import {
  ConnectionProvider,
  WalletProvider,
  type WalletProviderProps,
} from "@solana/wallet-adapter-react";
import { type ReactNode, useSyncExternalStore } from "react";

// No adapters are registered by hand: the list holds only wallets the browser
// announces (Wallet Standard), plus Mobile Wallet Adapter on phones.
const wallets: WalletProviderProps["wallets"] = [];
const noSubscription = () => () => {};
// The app's RPC proxy on this origin. The server render has no origin, so it
// uses the public Devnet URL; no request is made from that render, and the
// endpoint only tells Mobile Wallet Adapter which cluster to use.
const proxyEndpoint = () => `${window.location.origin}/api/rpc/devnet`;
const serverEndpoint = () => "https://api.devnet.solana.com";

// Shared by every page, so a wallet connected on the title screen stays
// connected in the lobby.
export default function WalletProviders({
  children,
}: {
  readonly children: ReactNode;
}) {
  const endpoint = useSyncExternalStore(
    noSubscription,
    proxyEndpoint,
    serverEndpoint,
  );
  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        {children}
      </WalletProvider>
    </ConnectionProvider>
  );
}
