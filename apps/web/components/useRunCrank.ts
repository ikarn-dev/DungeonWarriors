"use client";

import {
  type Connection,
  type Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { useEffect } from "react";
import { crankInstructions } from "../lib/game/run-crank";
import { getRunBlockhash } from "../lib/game/run-input";

const maxCranksInFlight = 4;

// The tab holding the play key submits Hydra triggers while the run is live.
// Confirmed account snapshots, never these submissions, drive the UI.
export function useRunCrank(
  control: { rpc: Connection; run: PublicKey } | null,
  playKey: Keypair | undefined,
  active: boolean,
  crank:
    | {
        oracle: string;
        epoch: string;
        generation: string;
        intervalMs: number;
      }
    | undefined,
) {
  const crankOracle = crank?.oracle;
  const crankEpoch = crank?.epoch;
  const crankGeneration = crank?.generation;
  const crankInterval = crank?.intervalMs;
  useEffect(() => {
    if (
      !control ||
      !playKey ||
      !active ||
      !crankOracle ||
      !crankEpoch ||
      !crankInterval ||
      !crankGeneration ||
      crankGeneration === "0"
    )
      return;
    const controller = new AbortController();
    const { rpc, run } = control;
    const oracle = new PublicKey(crankOracle);
    const epoch = crankEpoch;
    const generation = crankGeneration;
    const driver = crypto.randomUUID();
    let attempt = 0;
    let inFlight = 0;
    async function drive(key: Keypair) {
      if (controller.signal.aborted || inFlight >= maxCranksInFlight) return;
      inFlight++;
      try {
        const { blockhash } = await getRunBlockhash(rpc);
        if (controller.signal.aborted) return;
        const message = new TransactionMessage({
          payerKey: key.publicKey,
          recentBlockhash: blockhash,
          instructions: crankInstructions(
            run,
            key.publicKey,
            oracle,
            epoch,
            generation,
            `${driver}:${attempt++}`,
          ),
        }).compileToV0Message();
        const tx = new VersionedTransaction(message);
        tx.sign([key]);
        await rpc.sendRawTransaction(tx.serialize(), {
          skipPreflight: true,
          maxRetries: 0,
        });
      } catch {
        // A failed trigger grants no progress. Confirmed snapshots drive the UI.
      } finally {
        inFlight--;
      }
    }
    void drive(playKey);
    const timer = setInterval(() => void drive(playKey), crankInterval);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [
    control,
    playKey,
    active,
    crankOracle,
    crankEpoch,
    crankGeneration,
    crankInterval,
  ]);
}
