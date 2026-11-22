import { z } from "zod";
import type { CatStats } from "./catalog";
import { intentEnvelopeSchema, rulesVersionSchema } from "./protocol";
import { RULES_V1, RULES_V2, U64_MAX } from "./rules";
import { stepWorld } from "./world";
import {
  priceSampleSchema,
  validateWorldState,
  type WorldState,
  worldStateSchema,
} from "./world-state";

const u64 = z.bigint().min(0n).max(U64_MAX);
const snapshotSchema = worldStateSchema
  .extend({
    run: intentEnvelopeSchema.shape.run,
    rulesVersion: rulesVersionSchema,
    acceptedSequence: u64,
    processedSequence: u64,
    sample: priceSampleSchema,
    queued: z
      .array(
        z
          .object({ envelope: intentEnvelopeSchema, assignedTick: u64 })
          .strict(),
      )
      .max(RULES_V1.maxQueuedIntents),
  })
  .strict();
type Snapshot = z.infer<typeof snapshotSchema>;
type Local = {
  envelope: z.infer<typeof intentEnvelopeSchema>;
  predictedTick: bigint;
};

function worldOf(s: Snapshot): WorldState {
  return {
    frame: s.frame,
    entities: s.entities,
    generation: s.generation,
    worldOriginPixels: s.worldOriginPixels,
    nextEntityId: s.nextEntityId,
  };
}

export class PredictionError extends Error {
  constructor(
    readonly code:
      | "INVALID_SNAPSHOT"
      | "INPUT_FULL"
      | "SEQUENCE"
      | "RUN_MISMATCH",
  ) {
    super(code);
    this.name = "PredictionError";
  }
}

export function parsePredictionSnapshot(input: unknown): Snapshot {
  const parsed = snapshotSchema.safeParse(input);
  if (!parsed.success) throw new PredictionError("INVALID_SNAPSHOT");
  const s = parsed.data;
  try {
    validateWorldState(worldOf(s));
  } catch {
    throw new PredictionError("INVALID_SNAPSHOT");
  }
  if (
    s.processedSequence > s.acceptedSequence ||
    s.acceptedSequence - s.processedSequence > BigInt(RULES_V1.maxQueuedIntents)
  )
    throw new PredictionError("INVALID_SNAPSHOT");
  let previous = s.processedSequence;
  let previousTick = s.frame.activeTicks;
  for (const q of s.queued) {
    if (
      q.envelope.run !== s.run ||
      q.envelope.rulesVersion !== s.rulesVersion ||
      q.envelope.clientSequence !== previous + 1n ||
      q.assignedTick < previousTick ||
      q.assignedTick <= s.frame.activeTicks
    )
      throw new PredictionError("INVALID_SNAPSHOT");
    previous = q.envelope.clientSequence;
    previousTick = q.assignedTick;
  }
  if (previous !== s.acceptedSequence)
    throw new PredictionError("INVALID_SNAPSHOT");
  return s;
}

// Caller first decodes the generated IDL and verifies account owner/run bindings.
// This buffer predicts presentation only; it never submits ticks, money or results.
export class Predictor {
  private snapshot: Snapshot;
  private local: Local[] = [];
  private predictedTick: bigint;
  private cached?: { ticks: number; world: WorldState } | undefined;
  constructor(
    input: unknown,
    private readonly stats: CatStats,
  ) {
    this.snapshot = parsePredictionSnapshot(input);
    this.predictedTick = this.snapshot.frame.activeTicks;
  }

  enqueue(input: unknown): void {
    const envelope = intentEnvelopeSchema.parse(input);
    if (envelope.run !== this.snapshot.run)
      throw new PredictionError("RUN_MISMATCH");
    if (envelope.rulesVersion !== this.snapshot.rulesVersion)
      throw new PredictionError("INVALID_SNAPSHOT");
    if (this.local.length >= RULES_V1.maxLocalIntents)
      throw new PredictionError("INPUT_FULL");
    const last =
      this.local.at(-1)?.envelope.clientSequence ??
      this.snapshot.acceptedSequence;
    if (envelope.clientSequence !== last + 1n)
      throw new PredictionError("SEQUENCE");
    const queuedTick = this.snapshot.queued.at(-1)?.assignedTick ?? 0n;
    this.local.push({
      envelope,
      predictedTick:
        this.predictedTick + 1n > queuedTick
          ? this.predictedTick + 1n
          : queuedTick,
    });
    this.cached = undefined;
  }

  discardAfter(sequence: bigint) {
    this.local = this.local.filter(
      (entry) => entry.envelope.clientSequence <= sequence,
    );
    this.cached = undefined;
  }

  reconcile(input: unknown): boolean {
    const next = parsePredictionSnapshot(input);
    if (
      next.run !== this.snapshot.run ||
      next.rulesVersion !== this.snapshot.rulesVersion
    )
      throw new PredictionError("RUN_MISMATCH");
    if (
      next.frame.activeTicks < this.snapshot.frame.activeTicks ||
      next.processedSequence < this.snapshot.processedSequence ||
      next.acceptedSequence < this.snapshot.acceptedSequence ||
      next.worldOriginPixels < this.snapshot.worldOriginPixels
    )
      return false;
    if (
      this.snapshot.frame.terminalReason !== null &&
      (next.frame.terminalReason !== this.snapshot.frame.terminalReason ||
        next.frame.activeTicks !== this.snapshot.frame.activeTicks)
    )
      throw new PredictionError("INVALID_SNAPSHOT");
    this.snapshot = next;
    this.cached = undefined;
    this.local = this.local.filter(
      (entry) => entry.envelope.clientSequence > next.acceptedSequence,
    );
    return true;
  }

  predict(ticks: number): WorldState & { readonly limited: boolean } {
    if (!Number.isInteger(ticks) || ticks < 0)
      throw new RangeError("Invalid prediction horizon");
    const count = Math.min(ticks, RULES_V1.maxPredictionTicks);
    const cached =
      this.cached && this.cached.ticks <= count ? this.cached : undefined;
    let result = cached?.world ?? worldOf(this.snapshot);
    const queuedTick = this.snapshot.queued.at(-1)?.assignedTick ?? 0n;
    const firstTick = this.snapshot.frame.activeTicks + 1n;
    const events = [
      ...this.snapshot.queued.map((event) => ({
        tick: event.assignedTick,
        action: event.envelope.action,
      })),
      ...this.local.map((event) => {
        const tick =
          event.predictedTick > queuedTick ? event.predictedTick : queuedTick;
        return {
          tick: tick > firstTick ? tick : firstTick,
          action: event.envelope.action,
        };
      }),
    ];
    const rules = this.snapshot.rulesVersion === 2 ? RULES_V2 : RULES_V1;
    for (
      let i = cached?.ticks ?? 0;
      i < count && result.frame.phase === "active";
      i++
    ) {
      const nextTick = result.frame.activeTicks + 1n;
      const actions = events
        .filter((event) => event.tick === nextTick)
        .map((event) => event.action);
      if (actions.length > RULES_V1.maxQueuedIntents)
        return { ...result, limited: true };
      result = stepWorld(
        result,
        this.stats,
        actions,
        this.snapshot.sample,
        rules,
      );
    }
    this.cached = { ticks: count, world: result };
    this.predictedTick = result.frame.activeTicks;
    return { ...result, limited: ticks > count };
  }
}
