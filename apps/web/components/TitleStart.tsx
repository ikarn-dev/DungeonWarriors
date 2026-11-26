"use client";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { WebApiError, webApi, webErrorMessage } from "../lib/game/web-api";
import WalletDialog from "./WalletDialog";
import { useHydratedWallet } from "./WalletProviders";
import { signInGameDevice, signInWallet } from "./wallet-sign-in";

type Step = "idle" | "connecting" | "signing" | "entering";
// Progress shows in one live toast that updates in place (2026-11-26); the
// key keeps its one word and spins a loader beside it. Failures use their
// own toast id so clearing progress never removes them.
const PROGRESS: Record<Exclude<Step, "idle">, string> = {
  connecting: "Connecting your wallet",
  signing: "Approve the sign-in in your wallet",
  entering: "Entering the catacombs",
};
const PROGRESS_TOAST = "start";
const ERROR_TOAST = "start-error";

// Start on the title screen: pick a wallet in a pop-up if none is connected,
// sign the domain-bound challenge in the wallet if there is no session, then
// enter the lobby. No separate wallet or sign-in page.
export default function TitleStart() {
  const wallet = useHydratedWallet();
  const router = useRouter();
  const adapter = wallet.wallet?.adapter;
  const address = wallet.connected
    ? (wallet.publicKey?.toBase58() ?? null)
    : null;
  const [wanted, setWanted] = useState(false);
  const [picking, setPicking] = useState(false);
  const [step, setStep] = useState<Step>("idle");
  const running = useRef<AbortController | null>(null);
  const { select, signIn, signMessage } = wallet;

  const enter = useCallback(
    async (walletAddress: string, signal: AbortSignal) => {
      const session = await webApi<{ wallet: string } | null>(
        "/api/auth/session",
        undefined,
        signal,
      );
      if (signal.aborted) return;
      if (
        session?.wallet !== walletAddress &&
        !(await signInGameDevice(walletAddress, signal))
      ) {
        signal.throwIfAborted();
        if (adapter?.publicKey?.toBase58() !== walletAddress)
          throw new WebApiError("SIGN_IN_ACCOUNT_CHANGED");
        setStep("signing");
        if (
          !(await signInWallet(walletAddress, { signIn, signMessage }, signal))
        )
          return;
      }
      if (signal.aborted) return;
      if (adapter?.publicKey?.toBase58() !== walletAddress)
        throw new WebApiError("SIGN_IN_ACCOUNT_CHANGED");
      setStep("entering");
      router.push("/starter");
    },
    [router, adapter, signIn, signMessage],
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
        if (
          failure instanceof WebApiError &&
          (failure.code === "WALLET_SIGN_IN_UNAUTHORIZED" ||
            failure.code === "MESSAGE_SIGNING_REQUIRED")
        )
          select(null);
        toast.error(
          failure instanceof WebApiError
            ? webErrorMessage(failure.code)
            : "Your wallet didn't sign in. Press Start to try again.",
          { id: ERROR_TOAST },
        );
      })
      .finally(() => {
        if (running.current === controller) running.current = null;
      });
  }, [wanted, address, enter, select]);
  // Next.js preserves state when it hides a cached route.
  useLayoutEffect(() => {
    return () => {
      running.current?.abort();
      running.current = null;
      setWanted(false);
      setPicking(false);
      setStep("idle");
      toast.dismiss(PROGRESS_TOAST);
      toast.dismiss(ERROR_TOAST);
    };
  }, []);
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

  const connecting = wanted && wallet.connecting;
  const busy = step !== "idle" || connecting || (wanted && address !== null);
  const progress = !busy
    ? null
    : PROGRESS[
        step === "idle" ? "connecting" : connecting ? "connecting" : step
      ];
  useEffect(() => {
    if (progress === null) toast.dismiss(PROGRESS_TOAST);
    else toast.loading(progress, { id: PROGRESS_TOAST });
  }, [progress]);
  return (
    <>
      <button
        type="button"
        className="metal-key title-start"
        disabled={busy}
        aria-busy={busy}
        onClick={() => {
          toast.dismiss(ERROR_TOAST);
          setWanted(true);
          if (address === null) {
            if (wallet.connecting) setStep("connecting");
            else setPicking(true);
          }
        }}
      >
        {busy && <span className="key-spinner" aria-hidden="true" />}
        Start
      </button>
      <WalletDialog
        open={picking}
        wallet={wallet}
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
