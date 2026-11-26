"use client";
import type { useWallet } from "@solana/wallet-adapter-react";
import { useEffect, useRef, useState } from "react";
import { canSignInWallet } from "./wallet-sign-in";

// Lobby entry without separate pages: the wallet pop-up opens by itself when
// no wallet is remembered for this browser, and a connected wallet without a
// session is asked to sign once. A rejected prompt is not repeated; the
// lobby shows Try again instead.
export function useWalletEntry(
  wallet: ReturnType<typeof useWallet>,
  session: {
    readonly address: string | null;
    readonly restoring: boolean;
    readonly authenticated: boolean;
    readonly restoreFailed: boolean;
  },
  signIn: () => void,
) {
  const [picking, setPicking] = useState(false);
  const asked = useRef<string | null>(null);
  const latestSignIn = useRef(signIn);
  useEffect(() => {
    latestSignIn.current = signIn;
  });
  const noWallet =
    !wallet.connected && !wallet.connecting && wallet.wallet === null;
  useEffect(() => {
    if (noWallet) setPicking(true);
  }, [noWallet]);
  useEffect(() => {
    if (wallet.connected) setPicking(false);
  }, [wallet.connected]);
  const { address, restoring, authenticated, restoreFailed } = session;
  const canSign = canSignInWallet(wallet);
  useEffect(() => {
    if (
      address === null ||
      restoring ||
      authenticated ||
      restoreFailed ||
      !canSign ||
      asked.current === address
    )
      return;
    asked.current = address;
    latestSignIn.current();
  }, [address, restoring, authenticated, restoreFailed, canSign]);
  return { picking, setPicking };
}
