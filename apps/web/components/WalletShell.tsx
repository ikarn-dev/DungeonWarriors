"use client";
import {
  ConnectionProvider,
  WalletProvider,
  type WalletProviderProps,
} from "@solana/wallet-adapter-react";
import { useEffect, useState } from "react";
import { CATALOG_V1 } from "../lib/game/catalog";
import LobbyScene from "./LobbyScene";
import PixelLoader from "./PixelLoader";
import StarterPanel from "./StarterLobby";

const wallets: WalletProviderProps["wallets"] = [];
export default function WalletShell() {
  const [endpoint, setEndpoint] = useState<string | null>(null);
  useEffect(() => setEndpoint(`${window.location.origin}/api/rpc/devnet`), []);
  if (endpoint === null)
    return (
      <>
        <LobbyScene cats={CATALOG_V1.cats.map(({ id }) => id)} />
        <div className="lobby-body">
          <div className="lobby-start pixel-panel">
            <PixelLoader />
          </div>
        </div>
      </>
    );
  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <StarterPanel />
      </WalletProvider>
    </ConnectionProvider>
  );
}
