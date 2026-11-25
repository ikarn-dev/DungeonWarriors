import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import {
  clearDeparture,
  type DungeonExit,
  departOnPageHide,
  rememberDeparture,
} from "../lib/dungeon/departure";
import type { DungeonView } from "../lib/dungeon/protocol";
import { WebApiError, webErrorMessage } from "../lib/game/web-api";

export function useDungeonExit({
  open,
  phase,
  latest,
  wallet,
  client,
  send,
  onMenu,
  toastId,
}: {
  readonly open: boolean;
  readonly phase: DungeonView["phase"] | undefined;
  readonly latest: RefObject<DungeonView | null>;
  readonly wallet: string;
  readonly client: string;
  readonly send: (
    input: DungeonExit | { kind: "status"; nonce: string },
    signal: AbortSignal,
  ) => Promise<DungeonView | null>;
  readonly onMenu: () => void;
  readonly toastId: string;
}) {
  const requested = useRef<string | null>(null);
  const [pending, setPending] = useState<DungeonExit | null>(null);
  const exit = useCallback(
    (target: DungeonExit) => {
      if (requested.current === target.nonce) return;
      requested.current = target.nonce;
      rememberDeparture(wallet, target);
      setPending(target);
      onMenu();
      toast.loading("Resolving your quest…", { id: toastId });
    },
    [onMenu, wallet, toastId],
  );
  useEffect(() => {
    if (!pending) return;
    const controller = new AbortController();
    const { signal } = controller;
    let timer: ReturnType<typeof setTimeout>;
    let sent = false;
    const target = pending;
    function finish(message: string) {
      clearDeparture(wallet, target.nonce);
      setPending(null);
      toast(message, { id: toastId, duration: 6000 });
    }
    async function resolve() {
      try {
        const result = await send(
          sent ? { kind: "status", nonce: target.nonce } : target,
          signal,
        );
        sent = true;
        if (result?.nonce === target.nonce && result.settled) {
          switch (result.phase) {
            case "lost":
              finish("Quest ended. Your wager was forfeited.");
              break;
            case "won":
              finish("Your treasure was banked.");
              break;
            case "refunded":
              finish("Your wager was refunded.");
              break;
            default:
              requested.current = null;
              finish("No wager was taken.");
          }
          return;
        }
        if (result && result.nonce !== target.nonce) {
          finish("Your earlier quest has ended.");
          return;
        }
      } catch (failure) {
        if (signal.aborted) return;
        if (
          failure instanceof WebApiError &&
          ["DUNGEON_OTHER_CLIENT", "DUNGEON_NOT_FOUND"].includes(failure.code)
        ) {
          finish(
            failure.code === "DUNGEON_NOT_FOUND"
              ? "That quest is no longer active."
              : webErrorMessage(failure.code),
          );
          return;
        }
      }
      if (!signal.aborted) timer = setTimeout(() => void resolve(), 2500);
    }
    void resolve();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [pending, send, wallet, toastId]);
  useEffect(() => {
    if (!open) return;
    let departure: DungeonExit | null = null;
    const hide = () => {
      const current = latest.current;
      if (!current || current.settled || requested.current === current.nonce)
        return;
      departure = { kind: "exit", nonce: current.nonce, client };
      rememberDeparture(wallet, departure);
      // The same saved request is reconciled if the page returns.
      void departOnPageHide(departure).catch(() => undefined);
    };
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted && departure) exit(departure);
    };
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", restore);
    return () => {
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", restore);
    };
  }, [open, client, exit, latest, wallet]);
  useEffect(() => {
    if (!open || phase !== "playing") return;
    const confirm = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = true;
    };
    window.addEventListener("beforeunload", confirm);
    return () => window.removeEventListener("beforeunload", confirm);
  }, [open, phase]);
  return { pending, requested, exit };
}
