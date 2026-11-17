import { z } from "zod";
import type { CatStats } from "./catalog";
import { intentEnvelopeSchema } from "./protocol";
import { RULES_V1, U64_MAX } from "./rules";
import { step } from "./simulation";
import { simulationFrameSchema, worldEntitySchema } from "./simulation-state";

const u64 = z.bigint().min(0n).max(U64_MAX);
const snapshotSchema = z.object({
  run: intentEnvelopeSchema.shape.run,
  rulesVersion: z.literal(RULES_V1.rulesVersion),
  acceptedSequence: u64,
  processedSequence: u64,
  frame: simulationFrameSchema,
  entities: z.array(worldEntitySchema).max(RULES_V1.maxWorldEntities),
  queued: z
    .array(
      z.object({ envelope: intentEnvelopeSchema, assignedTick: u64 }).strict(),
    )
    .max(RULES_V1.maxQueuedIntents),
});
type Snapshot = z.infer<typeof snapshotSchema>;
type Local = {
  envelope: z.infer<typeof intentEnvelopeSchema>;
  predictedTick: bigint;
};

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

function parseSnapshot(input: unknown): Snapshot {
  const parsed = snapshotSchema.safeParse(input);
  if (!parsed.success) throw new PredictionError("INVALID_SNAPSHOT");
  const s = parsed.data;
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
  constructor(
    input: unknown,
    private readonly stats: CatStats,
  ) {
    this.snapshot = parseSnapshot(input);
    this.predictedTick = this.snapshot.frame.activeTicks;
  }

  enqueue(input: unknown): void {
    const envelope = intentEnvelopeSchema.parse(input);
    if (envelope.run !== this.snapshot.run)
      throw new PredictionError("RUN_MISMATCH");
    if (this.local.length >= RULES_V1.maxLocalIntents)
      throw new PredictionError("INPUT_FULL");
    const last =
      this.local.at(-1)?.envelope.clientSequence ??
      this.snapshot.acceptedSequence;
    if (envelope.clientSequence !== last + 1n)
      throw new PredictionError("SEQUENCE");
    this.local.push({ envelope, predictedTick: this.predictedTick + 1n });
  }

  reconcile(input: unknown): boolean {
    const next = parseSnapshot(input);
    if (next.run !== this.snapshot.run)
      throw new PredictionError("RUN_MISMATCH");
    if (
      next.frame.activeTicks < this.snapshot.frame.activeTicks ||
      next.processedSequence < this.snapshot.processedSequence ||
      next.acceptedSequence < this.snapshot.acceptedSequence
    )
      return false;
    if (
      this.snapshot.frame.terminalReason !== null &&
      next.frame.terminalReason !== this.snapshot.frame.terminalReason
    )
      throw new PredictionError("INVALID_SNAPSHOT");
    this.snapshot = next;
    this.local = this.local.filter(
      (entry) => entry.envelope.clientSequence > next.acceptedSequence,
    );
    return true;
  }

  predict(
    ticks: number,
  ): ReturnType<typeof step> & { readonly limited: boolean } {
    if (!Number.isInteger(ticks) || ticks < 0)
      throw new RangeError("Invalid prediction horizon");
    const count = Math.min(ticks, RULES_V1.maxPredictionTicks);
    let result = {
      frame: structuredClone(this.snapshot.frame),
      entities: structuredClone(this.snapshot.entities),
    };
    const events = [...this.snapshot.queued, ...this.local];
    for (let i = 0; i < count; i++) {
      const nextTick = result.frame.activeTicks + 1n;
      const actions = events
        .filter((event) =>
          "assignedTick" in event
            ? event.assignedTick === nextTick
            : event.predictedTick <= nextTick,
        )
        .map((event) => event.envelope.action);
      // Remove local events after execution, but retain originals for reconciliation.
      for (let j = events.length - 1; j >= 0; j--) {
        const event = events[j];
        if (
          event !== undefined &&
          ("assignedTick" in event
            ? event.assignedTick === nextTick
            : event.predictedTick <= nextTick)
        )
          events.splice(j, 1);
      }
      if (actions.length > RULES_V1.maxQueuedIntents)
        return { ...result, limited: true };
      result = step(result.frame, result.entities, this.stats, actions);
      if (result.frame.phase !== "active") break;
    }
    this.predictedTick = result.frame.activeTicks;
    return { ...result, limited: ticks > count };
  }
}
