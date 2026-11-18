import { expect, it } from "vitest";
import { catStats } from "../../../../../apps/web/lib/game/catalog";
import { Predictor } from "../../../../../apps/web/lib/game/predictor";
import { RULES_V1 } from "../../../../../apps/web/lib/game/rules";
import {
  initializeWorld,
  stepWorld,
} from "../../../../../apps/web/lib/game/world";
import { frame } from "./simulation-fixtures";
import { sample as flatSample, initialWorld } from "./world-fixtures";

const run = "11111111111111111111111111111111";
function snapshot() {
  const f = frame();
  f.runner.ySubpixels =
    (RULES_V1.physics.viewportHeightPixels * 256) / 2 -
    RULES_V1.physics.hitboxHeightSubpixels;
  const sample = {
    previousPrice: 10000n,
    previousExponent: 8,
    price: 10000n,
    exponent: 8,
  };
  return {
    ...initializeWorld(f, catStats("collector", 1), sample),
    run,
    rulesVersion: 1,
    acceptedSequence: 0n,
    processedSequence: 0n,
    sample,
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
  const next = stepWorld(
    initialWorld(),
    catStats("collector", 1),
    [],
    flatSample(),
  );
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
  expect(p.predict(1).frame.runner.ySubpixels).toBe(
    snapshot().frame.runner.ySubpixels,
  );
  expect(p.predict(2).frame.runner.ySubpixels).toBe(
    snapshot().frame.runner.ySubpixels - 2944,
  );
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

it("orders unaccepted controls after the last accepted assigned tick", () => {
  const s = snapshot();
  const accepted = { ...jump(), action: { kind: "move", axis: "left" } };
  const p = new Predictor(
    {
      ...s,
      acceptedSequence: 1n,
      queued: [{ envelope: accepted, assignedTick: 10n }],
    },
    catStats("collector", 1),
  );
  p.enqueue({ ...jump(), clientSequence: 2n });
  expect(p.predict(9).frame.runner.grounded).toBe(true);
  const result = p.predict(10);
  expect(result.frame.runner.axis).toBe("left");
  expect(result.frame.runner.vySubpixelsPerTick).toBe(-2944);
});

it("rejects missing terrain and advancing terminal ticks", () => {
  const s = snapshot();
  expect(
    () => new Predictor({ ...s, entities: [] }, catStats("collector", 1)),
  ).toThrow("INVALID_SNAPSHOT");
  const terminal = {
    ...s,
    frame: {
      ...s.frame,
      phase: "terminalRecorded",
      terminalReason: "surrender",
    },
  };
  const p = new Predictor(terminal, catStats("collector", 1));
  expect(() =>
    p.reconcile({ ...terminal, frame: { ...terminal.frame, activeTicks: 1n } }),
  ).toThrow("INVALID_SNAPSHOT");
  expect(p.predict(15).frame.activeTicks).toBe(0n);
});

it("replays from rebased coordinates without duplicating distance or coins", () => {
  const stats = catStats("collector", 1);
  let state = initialWorld();
  for (let i = 0; i < 1100; i++)
    state = stepWorld(state, stats, [], flatSample());
  expect(state.worldOriginPixels).toBeGreaterThan(0n);
  const p = new Predictor({ ...snapshot(), ...state }, stats);
  const predicted = p.predict(15);
  for (let i = 0; i < 15; i++)
    state = stepWorld(state, stats, [], flatSample());
  const { limited, ...world } = predicted;
  expect(limited).toBe(false);
  expect(world).toEqual(state);
});
