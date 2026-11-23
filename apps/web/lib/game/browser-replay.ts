import { z } from "zod";
import type { CatStats } from "./catalog";
import { intentEnvelopeSchema, type PlayerIntent } from "./protocol";
import { type GameplayRules, rulesForVersion, RULES_V1 } from "./rules";
import { simulationFrameSchema } from "./simulation-state";
import { stepWorld, type TimedIntent } from "./world";
import { priceSampleSchema, type PriceSample, validateWorldState, type WorldState, worldStateSchema } from "./world-state";

const tick = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const browserInputsSchema = z.array(z.object({
  tick, action: intentEnvelopeSchema.shape.action,
}).strict()).max(RULES_V1.maxLocalIntents).refine(
  (inputs) => inputs.every(({ action }) => !["heartbeat", "inactive"].includes(action.kind)),
);
const statsSchema = z.object({
  power: z.enum(["magnet", "doubleJump", "shield", "extraDash"]),
  powerCooldownTicks: tick.positive(),
  pickupRadiusSubpixels: tick.positive(),
  airControlSubpixelsPerTick: tick,
  dashDurationTicks: tick.positive(),
  dashCooldownTicks: tick.positive(),
}).strict();
const priceEventSchema = z.object({ tick, sequence: z.bigint().min(0n), sample: priceSampleSchema }).strict();
export const browserReplaySchema = z.object({
  rulesVersion: z.number().int().positive(),
  startedAt: tick,
  lastSeenAt: tick,
  controlSecond: tick,
  controlsInSecond: tick,
  world: worldStateSchema,
  stats: statsSchema,
  prices: z.array(priceEventSchema).min(1).max(64),
  stop: z.enum(["cashOut", "crash", "reload", "pageClosed", "hidden", "engineError", "priceUnavailable", "keyExpired", "unstarted"]).nullable(),
}).strict();
export type BrowserReplay = z.infer<typeof browserReplaySchema>;
export type BrowserInput = z.infer<typeof browserInputsSchema>[number];
export type BrowserStop = NonNullable<BrowserReplay["stop"]>;
export const browserGraceMs = RULES_V1.heartbeatGraceTicks * 1000 / RULES_V1.ticksPerSecond;

// BigInts retain their exact value through Redis and HTTP.
export function encodeBrowser(value: unknown): string {
  return JSON.stringify(value, (_, v: unknown) =>
    typeof v === "bigint" ? { bigint: v.toString() } : v);
}
export function decodeBrowser(value: string): unknown {
  return JSON.parse(value, (_, v: unknown) => {
    if (typeof v === "object" && v !== null && "bigint" in v &&
        Object.keys(v).length === 1 && typeof v.bigint === "string" &&
        /^-?[0-9]{1,20}$/.test(v.bigint)) return BigInt(v.bigint);
    return v;
  });
}
export function replayRules(replay: BrowserReplay): GameplayRules {
  const rules = rulesForVersion(replay.rulesVersion);
  if (!rules) throw new Error("UNSUPPORTED_VERSION");
  return rules;
}
export function beginBrowserReplay(
  world: WorldState, stats: CatStats, sample: PriceSample, rules: GameplayRules, now: number, sequence = 0n,
): BrowserReplay {
  const { frame, entities, generation, worldOriginPixels, nextEntityId } = world;
  const clean = { frame, entities, generation, worldOriginPixels, nextEntityId };
  validateWorldState(clean, rules);
  if (world.frame.phase !== "active" || world.frame.activeTicks !== 0n)
    throw new Error("RUN_ALREADY_STARTED");
  return browserReplaySchema.parse({
    rulesVersion: rules.rulesVersion, startedAt: now, lastSeenAt: now,
    world: structuredClone(clean), stats, controlSecond: 0, controlsInSecond: 0, prices: [{ tick: 0, sequence, sample }], stop: null,
  });
}
export function priceAt(replay: Pick<BrowserReplay, "prices">, tick: number): PriceSample {
  const event = replay.prices.findLast((event) => event.tick <= tick);
  if (!event) throw new Error("PRICE_HISTORY_MISSING");
  return event.sample;
}
export function scheduleBrowserPrice(replay: BrowserReplay, sample: PriceSample, now: number, sequence = (replay.prices.at(-1)?.sequence ?? 0n) + 1n) {
  if (replay.stop !== null) return;
  const rules = replayRules(replay);
  priceSampleSchema.parse(sample);
  // A short lead gives the browser time to receive a witnessed update before
  // it changes the still-unbuilt terrain. Both engines apply it on this tick.
  const effectiveTick = Math.max(
    Math.floor((now - replay.startedAt) * rules.ticksPerSecond / 1000) + rules.ticksPerSecond,
    (replay.prices.at(-1)?.tick ?? 0) + 1,
  );
  const current = Number(replay.world.frame.activeTicks);
  const preceding = replay.prices.findLastIndex((event) => event.tick <= current);
  replay.prices = replay.prices.slice(Math.max(0, preceding));
  replay.prices.push({ tick: effectiveTick, sequence, sample });
  if (replay.prices.length > 64) throw new Error("PRICE_QUEUE_FULL");
}
export function finishBrowserReplay(replay: BrowserReplay, stop: BrowserStop): BrowserReplay {
  const result = structuredClone(replay);
  if (result.stop !== null) return result;
  if (stop === "unstarted" && result.world.frame.activeTicks !== 0n)
    throw new Error("RUN_ALREADY_STARTED");
  result.stop = result.world.frame.terminalReason === "crash" ? "crash" : stop;
  if (result.world.frame.terminalReason === null) {
    result.world.frame.phase = "terminalRecorded";
    result.world.frame.terminalReason =
      stop === "unstarted" ? "technicalAbort" :
      result.world.frame.qualifiedCheckpoints > 0n ? "autoCashOut" : "surrender";
  }
  simulationFrameSchema.parse(result.world.frame);
  return result;
}
export function verifyBrowserStep(
  original: BrowserReplay, through: number, rawInputs: unknown, now: number,
): BrowserReplay {
  tick.parse(through);
  const rules = replayRules(original);
  const inputs = browserInputsSchema.parse(rawInputs);
  if (original.stop !== null) return structuredClone(original);
  if (now < original.lastSeenAt) throw new Error("CLOCK_REGRESSION");
  if (now - original.lastSeenAt > browserGraceMs)
    return finishBrowserReplay(original, "pageClosed");
  const current = Number(original.world.frame.activeTicks);
  const elapsedTicks = Math.floor((now - original.startedAt) * rules.ticksPerSecond / 1000);
  if (through > elapsedTicks || through - current > rules.heartbeatGraceTicks)
    throw new Error("INVALID_REPLAY_TIME");
  if (through <= current) return structuredClone(original);
  let previousTick = current + 1;
  const rates = new Map<number, number>([[original.controlSecond, original.controlsInSecond]]);
  for (const input of inputs) {
    if (input.tick < previousTick || input.tick > through) throw new Error("INVALID_REPLAY_ORDER");
    previousTick = input.tick;
    const second = Math.floor((input.tick - 1) / rules.ticksPerSecond);
    const count = (rates.get(second) ?? 0) + 1;
    if (count > rules.maxControlUpdatesPerSecond) throw new Error("CONTROL_RATE_EXCEEDED");
    rates.set(second, count);
  }
  const result = structuredClone(original);
  const events = new Map<number, PlayerIntent[]>();
  for (const input of inputs) {
    const actions = events.get(input.tick) ?? [];
    actions.push(input.action);
    events.set(input.tick, actions);
  }
  for (let next = current + 1; next <= through && result.world.frame.phase === "active"; next++) {
    result.world = stepWorld(result.world, result.stats, events.get(next) ?? [], priceAt(result, next), rules);
  }
  result.lastSeenAt = now;
  result.controlSecond = Math.floor((through - 1) / rules.ticksPerSecond);
  result.controlsInSecond = rates.get(result.controlSecond) ?? 0;
  if (result.world.frame.terminalReason !== null)
    return finishBrowserReplay(result, result.world.frame.terminalReason === "crash" ? "crash" : "cashOut");
  return result;
}

// Runs on requestAnimationFrame. Verification uses the same deterministic step.
export class BrowserRunner {
  world: WorldState;
  lead = 0;
  inputs: BrowserInput[] = [];
  private lastTick: number;
  constructor(public replay: BrowserReplay) {
    this.world = structuredClone(replay.world);
    this.lastTick = Number(this.world.frame.activeTicks);
  }
  input(action: PlayerIntent) {
    if (this.world.frame.phase !== "active") return;
    if (this.inputs.length >= RULES_V1.maxLocalIntents) throw new Error("INPUT_FULL");
    this.inputs.push({ tick: Number(this.world.frame.activeTicks) + 1, action });
  }
  advance(now: number) {
    if (this.world.frame.phase !== "active") return this.world;
    const rules = replayRules(this.replay);
    const fractional = (now - this.replay.startedAt) * rules.ticksPerSecond / 1000;
    const target = Math.floor(fractional);
    if (target < this.lastTick || target - this.lastTick > rules.heartbeatGraceTicks)
      throw new Error("FRAME_GAP");
    const inputs: TimedIntent[] = this.inputs.map(({ tick, action }) => ({ tick: BigInt(tick), action }));
    for (let tick = this.lastTick + 1; tick <= target && this.world.frame.phase === "active"; tick++)
      this.world = stepWorld(this.world, this.replay.stats,
        inputs.filter((input) => input.tick === BigInt(tick)).map((input) => input.action),
        priceAt(this.replay, tick), rules);
    this.lastTick = Number(this.world.frame.activeTicks);
    this.lead = fractional - target;
    return this.world;
  }
  acknowledge(replay: BrowserReplay) {
    if (replay.world.frame.activeTicks < this.replay.world.frame.activeTicks) return;
    const previous = this.replay.prices.at(-1)?.tick ?? 0;
    if (replay.prices.some((event) => event.tick > previous &&
        event.tick <= Number(this.world.frame.activeTicks))) throw new Error("PRICE_DELIVERY_LATE");
    this.replay = replay;
    this.inputs = this.inputs.filter((input) => BigInt(input.tick) > replay.world.frame.activeTicks);
  }
}
