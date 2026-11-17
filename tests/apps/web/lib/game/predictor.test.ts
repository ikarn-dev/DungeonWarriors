import { expect, it } from "vitest";
import { catStats } from "../../../../../apps/web/lib/game/catalog";
import { Predictor } from "../../../../../apps/web/lib/game/predictor";
import { step } from "../../../../../apps/web/lib/game/simulation";
import { floor, frame } from "./simulation-fixtures";

const run = "11111111111111111111111111111111";
function snapshot() {
  return {
    run,
    rulesVersion: 1,
    acceptedSequence: 0n,
    processedSequence: 0n,
    frame: frame(),
    entities: [floor()],
    queued: [],
  };
}
function jump() {
  return {
    protocolVersion: 1,
    rulesVersion: 1,
    run,
    clientSequence: 1n,
    action: { kind: "jump" },
  };
}

it("bounds prediction and never mutates the authoritative snapshot", () => {
  const s = snapshot();
  const p = new Predictor(s, catStats("collector", 1));
  expect(p.predict(100).frame.activeTicks).toBe(15n);
  expect(s.frame.activeTicks).toBe(0n);
});
it("replays once after a processed acknowledgement and rejects stale snapshots", () => {
  const p = new Predictor(snapshot(), catStats("collector", 1));
  p.enqueue(jump());
  const next = step(frame(), [floor()], catStats("collector", 1), []);
  expect(
    p.reconcile({
      ...snapshot(),
      ...next,
      acceptedSequence: 1n,
      processedSequence: 1n,
    }),
  ).toBe(true);
  expect(p.predict(1).frame.runner.vySubpixelsPerTick).toBe(0);
  expect(p.reconcile(snapshot())).toBe(false);
});
it("uses accepted ticks instead of guessed ticks", () => {
  const p = new Predictor(
    {
      ...snapshot(),
      acceptedSequence: 1n,
      queued: [{ envelope: jump(), assignedTick: 2n }],
    },
    catStats("collector", 1),
  );
  expect(p.predict(1).frame.runner.ySubpixels).toBe(0);
  expect(p.predict(2).frame.runner.ySubpixels).toBe(-2944);
});
it("rejects gaps, wrong identities and full local queues", () => {
  const p = new Predictor(snapshot(), catStats("collector", 1));
  expect(() => p.enqueue({ ...jump(), clientSequence: 2n })).toThrow(
    "SEQUENCE",
  );
  for (let i = 0; i < 128; i++)
    p.enqueue({ ...jump(), clientSequence: BigInt(i + 1) });
  expect(() => p.enqueue({ ...jump(), clientSequence: 129n })).toThrow(
    "INPUT_FULL",
  );
  expect(p.predict(1).limited).toBe(true);
});
