import { PublicKey } from "@solana/web3.js";
import { z } from "zod";
import { publicKeySchema } from "../solana/addresses.ts";
import { rulesForVersion, U64_MAX } from "./rules";

export { publicKeySchema } from "../solana/addresses.ts";

export const PROTOCOL_VERSION = 1;
export const MAX_INTENTS_PER_SUBMISSION = 8;

const u64Schema = z.bigint().min(0n).max(U64_MAX);
const inputAxisSchema = z.enum(["left", "neutral", "right"]);
export const rulesVersionSchema = z.literal([1, 2, 3]);

const playerIntentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("move"), axis: inputAxisSchema }).strict(),
  z.object({ kind: z.literal("jump") }).strict(),
  z.object({ kind: z.literal("dash") }).strict(),
  z.object({ kind: z.literal("boost") }).strict(),
  z.object({ kind: z.literal("cashOut") }).strict(),
  z.object({ kind: z.literal("surrender") }).strict(),
  z.object({ kind: z.literal("heartbeat"), active: z.boolean() }).strict(),
  z.object({ kind: z.literal("inactive") }).strict(),
]);

export const intentEnvelopeSchema = z
  .object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    rulesVersion: rulesVersionSchema,
    run: publicKeySchema,
    clientSequence: u64Schema.min(1n),
    action: playerIntentSchema,
  })
  .strict();

export type PlayerIntent = z.infer<typeof playerIntentSchema>;
export type IntentEnvelope = z.infer<typeof intentEnvelopeSchema>;

export class ProtocolError extends Error {
  constructor(readonly code: "MALFORMED_INTENT" | "UNSUPPORTED_VERSION") {
    super(code);
    this.name = "ProtocolError";
  }
}

const intentTags = {
  move: 0,
  jump: 1,
  dash: 2,
  boost: 3,
  cashOut: 4,
  surrender: 5,
  heartbeat: 6,
  inactive: 7,
} as const;
const axes = ["left", "neutral", "right"] as const;

// Exact Borsh IntentEnvelope body; the generated Anchor client will wrap this
// with instruction data/accounts. The Solana transaction signs all these bytes.
export function encodeIntent(input: unknown): Uint8Array {
  const parsed = intentEnvelopeSchema.safeParse(input);
  if (!parsed.success) throw new ProtocolError("MALFORMED_INTENT");
  const intent = parsed.data;
  const hasPayload =
    intent.action.kind === "move" || intent.action.kind === "heartbeat";
  const bytes = new Uint8Array(hasPayload ? 48 : 47);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, intent.protocolVersion, true);
  view.setUint32(2, intent.rulesVersion, true);
  bytes.set(new PublicKey(intent.run).toBytes(), 6);
  view.setBigUint64(38, intent.clientSequence, true);
  view.setUint8(46, intentTags[intent.action.kind]);
  if (intent.action.kind === "move")
    view.setUint8(47, axes.indexOf(intent.action.axis));
  if (intent.action.kind === "heartbeat")
    view.setUint8(47, intent.action.active ? 1 : 0);
  return bytes;
}

function decodeAction(tag: number, payload: number | undefined): PlayerIntent {
  switch (tag) {
    case 0: {
      const axis = payload === undefined ? undefined : axes[payload];
      if (axis === undefined) throw new ProtocolError("MALFORMED_INTENT");
      return { kind: "move", axis };
    }
    case 1:
      return { kind: "jump" };
    case 2:
      return { kind: "dash" };
    case 3:
      return { kind: "boost" };
    case 4:
      return { kind: "cashOut" };
    case 5:
      return { kind: "surrender" };
    case 6:
      if (payload !== 0 && payload !== 1)
        throw new ProtocolError("MALFORMED_INTENT");
      return { kind: "heartbeat", active: payload === 1 };
    case 7:
      return { kind: "inactive" };
    default:
      throw new ProtocolError("MALFORMED_INTENT");
  }
}

export function decodeIntent(bytes: Uint8Array): IntentEnvelope {
  if (bytes.byteLength < 47 || bytes.byteLength > 48)
    throw new ProtocolError("MALFORMED_INTENT");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const rulesVersion = view.getUint32(2, true);
  if (
    view.getUint16(0, true) !== PROTOCOL_VERSION ||
    !rulesForVersion(rulesVersion)
  ) {
    throw new ProtocolError("UNSUPPORTED_VERSION");
  }
  const tag = view.getUint8(46);
  const expectedLength = tag === 0 || tag === 6 ? 48 : 47;
  if (bytes.byteLength !== expectedLength)
    throw new ProtocolError("MALFORMED_INTENT");
  const action = decodeAction(tag, bytes[47]);
  const parsed = intentEnvelopeSchema.safeParse({
    protocolVersion: PROTOCOL_VERSION,
    rulesVersion,
    run: new PublicKey(bytes.subarray(6, 38)).toBase58(),
    clientSequence: view.getBigUint64(38, true),
    action,
  });
  if (!parsed.success) throw new ProtocolError("MALFORMED_INTENT");
  return parsed.data;
}

export const runPhaseSchema = z.enum([
  "ready",
  "active",
  "suspended",
  "terminalRecorded",
  "completionRequested",
]);
export const terminalReasonSchema = z.enum([
  "cashOut",
  "crash",
  "autoCashOut",
  "surrender",
  "technicalAbort",
]);
export const runUiStatusSchema = z.enum([
  "activating",
  "active",
  "suspended",
  "requested",
  "accepted",
  "lost",
  "settling",
  "settled",
  "refunded",
  "recoveryPending",
  "error",
]);

// A projection of a decoded/owner-checked account, not a substitute for IDL
// account decoding or signature/commit provenance. Final funds need base finality.
const runSnapshotStructure = z
  .object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    schemaVersion: z.literal(1),
    rulesVersion: rulesVersionSchema,
    catalogVersion: z.number().int().min(1).max(0xffff_ffff),
    run: publicKeySchema,
    phase: runPhaseSchema,
    activeTicks: u64Schema,
    acceptedSequence: u64Schema,
    processedSequence: u64Schema,
    terminalReason: terminalReasonSchema.nullable(),
  })
  .strict();

export const runAccountObservationSchema = runSnapshotStructure.pipe(
  runSnapshotStructure
    .refine((value) => value.processedSequence <= value.acceptedSequence, {
      message: "Processed input cannot exceed accepted input",
    })
    .refine(
      (value) => {
        const terminal =
          value.phase === "terminalRecorded" ||
          value.phase === "completionRequested";
        return terminal === (value.terminalReason !== null);
      },
      { message: "Phase and terminal outcome must agree" },
    ),
);

export type RunAccountObservation = z.infer<typeof runAccountObservationSchema>;
export type RunUiStatus = z.infer<typeof runUiStatusSchema>;
