"use client";
import {
  ConnectionProvider,
  WalletProvider,
  type WalletProviderProps,
} from "@solana/wallet-adapter-react";
import { useEffect, useState } from "react";
import StarterCapsule from "./StarterCapsule";
import style from "./StarterExperience.module.css";
import StarterPanel from "./StarterLobby";

const wallets: WalletProviderProps["wallets"] = [];
export default function WalletShell() {
  const [endpoint, setEndpoint] = useState<string | null>(null);
  useEffect(() => setEndpoint(`${window.location.origin}/api/rpc/devnet`), []);
  if (endpoint === null)
    return (
      <div className={style.grid}>
        <StarterCapsule state={null} />
        <output className={style.controls}>Loading wallet controls…</output>
      </div>
    );
  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <StarterPanel />
      </WalletProvider>
    </ConnectionProvider>
  );
}
