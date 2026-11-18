"use client";
import {
  ConnectionProvider,
  WalletProvider,
  type WalletProviderProps,
} from "@solana/wallet-adapter-react";
import { useEffect, useState } from "react";
import StarterPanel from "./StarterLobby";

const wallets: WalletProviderProps["wallets"] = [];
export default function WalletShell() {
  const [endpoint, setEndpoint] = useState<string | null>(null);
  useEffect(() => setEndpoint(`${window.location.origin}/api/rpc/devnet`), []);
  if (endpoint === null) return <output>Loading wallet controls…</output>;
  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <StarterPanel />
      </WalletProvider>
    </ConnectionProvider>
  );
}
