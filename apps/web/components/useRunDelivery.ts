import { useEffect, useRef, useState } from "react";
import {
  confirmGameAction,
  type GameSignature,
  prepareSponsoredPlay,
  type SponsoredPlayTransaction,
  submitSponsoredPlay,
} from "../lib/game/run-client";
import type { GameIntent, PlaySponsor } from "../lib/game/run-transactions";
import { WebApiError } from "../lib/game/web-api";

export function useRunDelivery(
  wallet: string,
  action: GameIntent["action"] | null,
  sponsor: PlaySponsor | undefined,
  playKey: Parameters<typeof prepareSponsoredPlay>[3],
) {
  const [notice, setNotice] = useState<string | null>(null);
  const current = useRef({ action, sponsor, playKey });
  useEffect(() => {
    current.current = { action, sponsor, playKey };
  }, [action, sponsor, playKey]);
  const enabled = action !== null && sponsor !== undefined;
  useEffect(() => {
    if (!enabled) {
      setNotice(null);
      return;
    }
    const controller = new AbortController();
    const { signal } = controller;
    let timer: ReturnType<typeof setTimeout>;
    let flight:
      | {
          key: string;
          prepared?: SponsoredPlayTransaction;
          signature?: GameSignature;
          confirmed?: boolean;
        }
      | undefined;
    let failures = 0;

    async function deliver() {
      if (signal.aborted) return;
      const { action, sponsor, playKey } = current.current;
      if (!action || !sponsor) return;
      const key = JSON.stringify([action, sponsor]);
      if (flight?.key !== key) {
        flight = { key };
        failures = 0;
      }
      const pending = flight;
      const resuming = action.kind === "resumeRun";
      try {
        if (pending.confirmed) return;
        const request = AbortSignal.any([signal, AbortSignal.timeout(12_000)]);
        setNotice(
          resuming ? "Reconnecting to your run…" : "Finalizing your result…",
        );
        pending.prepared ??= await prepareSponsoredPlay(
          wallet,
          { operation: "game", sponsored: false, playSponsor: sponsor, action },
          request,
          resuming ? playKey : undefined,
        );
        pending.signature ??= await submitSponsoredPlay(
          pending.prepared,
          request,
        );
        const result = await confirmGameAction(
          pending.signature,
          request,
          3,
          "confirmed",
        );
        if (result === "confirmed") pending.confirmed = true;
        if (result === "failed" || result === "expired") {
          flight = undefined;
          failures++;
        }
      } catch (error) {
        if (signal.aborted) return;
        if (
          error instanceof WebApiError &&
          !pending.signature &&
          [
            "BLOCKHASH_EXPIRED",
            "INVALID_RUN_SPONSOR",
            "SIMULATION_REJECTED",
            "TRANSACTION_REJECTED",
          ].includes(error.code)
        )
          flight = undefined;
        failures++;
        setNotice(
          resuming
            ? "Waiting for MagicBlock to reconnect…"
            : "Settlement is pending. Retrying automatically…",
        );
      } finally {
        if (!signal.aborted)
          timer = setTimeout(deliver, Math.min(15000, 2000 * 2 ** failures));
      }
    }

    void deliver();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [enabled, wallet]);
  return notice;
}
