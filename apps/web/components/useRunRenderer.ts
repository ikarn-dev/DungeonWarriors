"use client";

import { type RefObject, useEffect, useRef, useState } from "react";
import type { CatId } from "../lib/game/catalog";
import type { Predictor } from "../lib/game/predictor";
import { RULES_V1 } from "../lib/game/rules";
import { loadRunArtwork, type RunArtwork } from "../lib/game/run-artwork";

export type RunPrediction = {
  engine: Predictor;
  extrapolate: boolean;
  sampledAt: number;
  confirmedTick: bigint;
  ticks: number;
  // Elapsed fraction of the next tick, for smooth motion between ticks.
  lead: number;
  world: ReturnType<Predictor["predict"]>;
};

// Mounts the Phaser scene for one run and feeds it bounded predictions.
export function useRunRenderer({
  present,
  mount,
  hasWorld,
  cat,
  media,
  artwork,
  prediction,
  revision,
  focusable,
}: {
  present: boolean;
  mount: RefObject<HTMLDivElement | null>;
  hasWorld: boolean;
  cat: CatId | undefined;
  media: { version: number; contentHash: string } | null;
  artwork: RunArtwork | undefined;
  prediction: RefObject<RunPrediction | null>;
  revision: RefObject<number>;
  focusable: boolean;
}) {
  const [artError, setArtError] = useState(false);
  const [artReady, setArtReady] = useState(false);
  const focused = useRef(false);
  const version = media?.version;
  const hash = media?.contentHash;

  useEffect(() => {
    if (focusable && artReady && !focused.current) {
      focused.current = true;
      mount.current?.focus({ preventScroll: true });
    }
  }, [artReady, focusable, mount]);

  useEffect(() => {
    if (!present) {
      focused.current = false;
      setArtReady(false);
      return;
    }
    const parent = mount.current;
    if (
      !parent ||
      !hasWorld ||
      cat === undefined ||
      version === undefined ||
      hash === undefined
    )
      return;
    const controller = new AbortController();
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    let game:
      | ReturnType<typeof import("../lib/game/render-run").renderRun>
      | undefined;
    setArtError(false);
    setArtReady(false);
    async function attach(
      container: HTMLDivElement,
      selected: CatId,
      binding: { version: number; contentHash: string },
    ) {
      const { engine, manifest, renderRun, assets } =
        artwork?.binding.version === binding.version &&
        artwork.binding.contentHash === binding.contentHash &&
        artwork.cat === selected
          ? artwork
          : await loadRunArtwork(binding, controller.signal);
      if (controller.signal.aborted) return;
      const initial = prediction.current?.world;
      if (!initial) return;
      game = renderRun(engine, container, manifest, selected, {
        world: () => {
          const active = prediction.current;
          if (!active) return initial;
          const elapsed = active.extrapolate
            ? ((performance.now() - active.sampledAt) *
                RULES_V1.ticksPerSecond) /
              1000
            : 0;
          const ticks = Math.min(
            RULES_V1.maxPredictionTicks,
            Math.floor(elapsed),
          );
          // At the prediction horizon the course holds still until MagicBlock catches up.
          active.lead =
            ticks < RULES_V1.maxPredictionTicks ? elapsed - ticks : 0;
          if (ticks !== active.ticks) {
            try {
              active.world = active.engine.predict(ticks);
              active.ticks = ticks;
            } catch {
              active.extrapolate = false;
              active.world = active.engine.predict(0);
              active.ticks = 0;
              active.lead = 0;
            }
          }
          return active.world;
        },
        sample: () => ({
          lead: prediction.current?.lead ?? 0,
          revision: revision.current,
        }),
        reduced: () => reduced.matches,
        onError: () => {
          if (!controller.signal.aborted) setArtError(true);
        },
        onReady: () => {
          if (!controller.signal.aborted) setArtReady(true);
        },
        preloaded: assets,
      });
    }
    void attach(parent, cat, { version, contentHash: hash }).catch(() => {
      if (!controller.signal.aborted) setArtError(true);
    });
    return () => {
      controller.abort();
      game?.destroy(true);
    };
  }, [
    artwork,
    cat,
    version,
    hash,
    hasWorld,
    present,
    mount,
    prediction,
    revision,
  ]);

  return { artReady, artError: artError || media === null };
}
