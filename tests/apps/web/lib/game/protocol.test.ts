import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  decodeIntent,
  encodeIntent,
  intentEnvelopeSchema,
  ProtocolError,
  runAccountObservationSchema,
} from "../../../../../apps/web/lib/game/protocol";

const run = "3qbR1eZRqXUWroWKKYhbDmR3FfqTHfqSU8zZSxtANzYh";
const baseIntent = {
  protocolVersion: 1,
  rulesVersion: 1,
  run,
  clientSequence: 1n,
  action: { kind: "jump" },
} as const;

const observation = {
  protocolVersion: 1,
  schemaVersion: 1,
  rulesVersion: 1,
  catalogVersion: 1,
  run,
  phase: "active",
  activeTicks: 60n,
  acceptedSequence: 2n,
  processedSequence: 1n,
  terminalReason: null,
} as const;

function fixtureAction(kind: string, payload: string): unknown {
  if (kind === "move") return { kind, axis: payload };
  if (kind === "heartbeat") {
    if (payload !== "true" && payload !== "false")
      throw new Error("Invalid fixture heartbeat");
    return { kind, active: payload === "true" };
  }
  return { kind };
}

describe("signed input and authoritative observation contracts", () => {
  it("matches every Rust action and full-width sequence byte for byte", () => {
    const rows = readFileSync(
      new URL("../../../../fixtures/game-v1/intents.csv", import.meta.url),
      "utf8",
    )
      .trim()
      .split("\n")
      .slice(1);
    expect(rows).toHaveLength(13);
    for (const line of rows) {
      const [kind, payload, sequence, hex] = line.split(",");
      if (
        kind === undefined ||
        payload === undefined ||
        sequence === undefined ||
        hex === undefined
      )
        throw new Error("Invalid intent fixture");
      const envelope = intentEnvelopeSchema.parse({
        ...baseIntent,
        clientSequence: BigInt(sequence),
        action: fixtureAction(kind, payload),
      });
      const bytes = encodeIntent(envelope);
      expect(Buffer.from(bytes).toString("hex")).toBe(hex);
      expect(decodeIntent(Uint8Array.from(Buffer.from(hex, "hex")))).toEqual(
        envelope,
      );
      // Account/network buffers may be views with a nonzero byteOffset.
      const padded = new Uint8Array(bytes.length + 4);
      padded.set(bytes, 2);
      expect(decodeIntent(padded.subarray(2, -2))).toEqual(envelope);
    }
  });

  it("rejects truncated/trailing data, unknown tags and noncanonical payloads", () => {
    const jump = encodeIntent(baseIntent);
    for (const length of [0, 1, 38, 46]) {
      expect(() => decodeIntent(jump.slice(0, length))).toThrow(ProtocolError);
    }
    expect(() => decodeIntent(new Uint8Array([...jump, 0]))).toThrow(
      ProtocolError,
    );
    expect(() => decodeIntent(new Uint8Array(49))).toThrow(ProtocolError);
    const unsupported = jump.slice();
    unsupported[0] = 2;
    expect(() => decodeIntent(unsupported)).toThrow("UNSUPPORTED_VERSION");
    const unknown = jump.slice();
    unknown[46] = 255;
    expect(() => decodeIntent(unknown)).toThrow("MALFORMED_INTENT");
    const heartbeat = encodeIntent({
      ...baseIntent,
      action: { kind: "heartbeat", active: true },
    });
    heartbeat[47] = 2;
    expect(() => decodeIntent(heartbeat)).toThrow(ProtocolError);
    const move = encodeIntent({
      ...baseIntent,
      action: { kind: "move", axis: "neutral" },
    });
    move[47] = 3;
    expect(() => decodeIntent(move)).toThrow(ProtocolError);
    const zeroSequence = jump.slice();
    zeroSequence.fill(0, 38, 46);
    expect(() => decodeIntent(zeroSequence)).toThrow(ProtocolError);
  });

  it("accepts commands only, rejecting caller-supplied progress, payout or ticks", () => {
    for (const value of [
      { ...baseIntent, score: 100 },
      { ...baseIntent, payout: 1_000_000n },
      { ...baseIntent, assignedTick: 1n },
      { ...baseIntent, clientSequence: 0n },
      { ...baseIntent, clientSequence: 2 ** 53 },
      { ...baseIntent, clientSequence: 1n << 64n },
      { ...baseIntent, run: "invalid" },
      { ...baseIntent, protocolVersion: 2 },
      { ...baseIntent, action: { kind: "cashOut", earnedCheckpoints: 20 } },
    ]) {
      expect(() => encodeIntent(value)).toThrow(ProtocolError);
    }
  });

  it("keeps accepted/processed cursors and terminal observations internally consistent", () => {
    expect(runAccountObservationSchema.parse(observation)).toEqual(observation);
    expect(
      runAccountObservationSchema.safeParse({
        ...observation,
        processedSequence: 3n,
      }).success,
    ).toBe(false);
    expect(
      runAccountObservationSchema.safeParse({
        ...observation,
        terminalReason: "cashOut",
      }).success,
    ).toBe(false);
    expect(
      runAccountObservationSchema.safeParse({
        ...observation,
        phase: "terminalRecorded",
      }).success,
    ).toBe(false);
    expect(
      runAccountObservationSchema.safeParse({
        ...observation,
        phase: "terminalRecorded",
        terminalReason: "crash",
      }).success,
    ).toBe(true);
    expect(
      runAccountObservationSchema.safeParse({
        ...observation,
        phase: "completionRequested",
        terminalReason: "cashOut",
      }).success,
    ).toBe(true);
    expect(
      runAccountObservationSchema.safeParse({
        ...observation,
        activeTicks: -1n,
      }).success,
    ).toBe(false);
    expect(
      runAccountObservationSchema.safeParse({
        ...observation,
        processedSequence: null,
      }).success,
    ).toBe(false);
  });
});
