"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { WebApiError, webApi, webErrorMessage } from "../lib/game/web-api";
import WalletDialog from "./WalletDialog";
import { useHydratedWallet } from "./WalletProviders";
import { signInWallet } from "./wallet-sign-in";

type Step = "idle" | "connecting" | "signing" | "entering";
const LABELS: Record<Step, string> = {
  idle: "Start",
  connecting: "Connecting…",
  signing: "Check your wallet…",
  entering: "Entering…",
};

// Start on the title screen: pick a wallet in a pop-up if none is connected,
// sign the domain-bound challenge in the wallet if there is no session, then
// enter the lobby. No separate wallet or sign-in page.
export default function TitleStart() {
  const wallet = useHydratedWallet();
  const router = useRouter();
  const address = wallet.publicKey?.toBase58() ?? null;
  const [wanted, setWanted] = useState(false);
  const [picking, setPicking] = useState(false);
  const [step, setStep] = useState<Step>("idle");
  const running = useRef<AbortController | null>(null);
  const { signMessage } = wallet;

  const enter = useCallback(
    async (walletAddress: string, signal: AbortSignal) => {
      const session = await webApi<{ wallet: string }>(
        "/api/auth/session",
        undefined,
        signal,
      ).catch((failure: unknown) => {
        if (failure instanceof WebApiError && failure.code === "AUTH_REQUIRED")
          return null;
        throw failure;
      });
      if (signal.aborted) return;
      if (session?.wallet !== walletAddress) {
        if (signMessage === undefined)
          throw new WebApiError("MESSAGE_SIGNING_REQUIRED");
        setStep("signing");
        if (!(await signInWallet(walletAddress, signMessage, signal))) return;
      }
      setStep("entering");
      router.push("/starter");
    },
    [router, signMessage],
  );

  // Continue once Start was pressed and a wallet is connected.
  useEffect(() => {
    if (!wanted || address === null || running.current !== null) return;
    setPicking(false);
    const controller = new AbortController();
    running.current = controller;
    enter(address, controller.signal)
      .catch((failure: unknown) => {
        if (controller.signal.aborted) return;
        setWanted(false);
        setStep("idle");
        toast.error(
          failure instanceof WebApiError
            ? webErrorMessage(failure.code)
            : "Your wallet didn't sign in. Press Start to try again.",
          { id: "start" },
        );
      })
      .finally(() => {
        if (running.current === controller) running.current = null;
      });
  }, [wanted, address, enter]);
  useEffect(() => () => running.current?.abort(), []);
  // A silent reconnect that was still running when Start was pressed failed:
  // fall back to the wallet pop-up.
  useEffect(() => {
    if (
      wanted &&
      address === null &&
      !wallet.connecting &&
      step === "connecting" &&
      !picking
    ) {
      setStep("idle");
      setPicking(true);
    }
  }, [wanted, address, wallet.connecting, step, picking]);

  const busy = step !== "idle";
  return (
    <>
      <button
        type="button"
        className="title-start"
        disabled={busy}
        aria-busy={busy}
        onClick={() => {
          setWanted(true);
          if (address === null) {
            if (wallet.connecting) setStep("connecting");
            else setPicking(true);
          }
        }}
      >
        {LABELS[step]}
      </button>
      <WalletDialog
        open={picking}
        wallet={wallet}
        busy={wallet.connecting}
        onConnect={() => {
          setStep("connecting");
          wallet.connect().catch(() => {
            setStep("idle");
            toast.error("Your wallet didn't connect. Try again.", {
              id: "start",
            });
          });
        }}
        onClose={() => {
          setPicking(false);
          // Cancelled before choosing a wallet; a connect already under way
          // continues into sign-in.
          if (address === null && !wallet.connecting) {
            setWanted(false);
            setStep("idle");
          }
        }}
      />
    </>
  );
}
