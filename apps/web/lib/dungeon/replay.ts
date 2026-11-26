import type { CatId } from "../game/catalog";
import { generateRoom } from "./generate";
import type { DungeonRoom } from "./rooms";
import { type DungeonRules, inputsSchema, PHYSICS } from "./rules";
import {
  type Control,
  type DungeonFrame,
  type DungeonInput,
  initialFrame,
  roomOver,
  stepRoom,
} from "./simulation";

export function replayRoom(
  room: DungeonRoom,
  cat: CatId,
  rules: DungeonRules,
  through: number,
  rawInputs: unknown,
): DungeonFrame {
  const inputs = inputsSchema.parse(rawInputs);
  if (
    !Number.isInteger(through) ||
    through < 0 ||
    through > PHYSICS.maxRoomTicks
  )
    throw new Error("INVALID_DUNGEON_TICKS");
  let prior = 1;
  const rates = new Map<number, number>();
  for (const input of inputs) {
    if (input.tick < prior || input.tick > through)
      throw new Error("INVALID_DUNGEON_INPUT_ORDER");
    prior = input.tick;
    const second = Math.floor((input.tick - 1) / PHYSICS.ticksPerSecond);
    const count = (rates.get(second) ?? 0) + 1;
    if (count > PHYSICS.maxInputsPerSecond)
      throw new Error("DUNGEON_CONTROL_RATE");
    rates.set(second, count);
  }
  let frame = initialFrame(room, cat),
    head = 0;
  for (let tick = 1; tick <= through && !roomOver(frame); tick++) {
    const actions: Control[] = [];
    while (inputs[head]?.tick === tick) {
      const input = inputs[head++];
      if (input) actions.push(input.action);
    }
    frame = stepRoom(frame, room, cat, rules, actions);
  }
  return frame;
}
export class DungeonRunner {
  readonly room: DungeonRoom;
  frame: DungeonFrame;
  readonly inputs: DungeonInput[] = [];
  private head = 0;
  private previous: DungeonFrame;
  private perSecond = new Map<number, number>();
  constructor(
    readonly cat: CatId,
    readonly index: number,
    seed: string,
    readonly rules: DungeonRules,
    readonly startedAt: number,
  ) {
    this.room = generateRoom(seed, index);
    this.frame = initialFrame(this.room, cat);
    this.previous = this.frame;
  }
  position(now: number) {
    if (this.previous.resets !== this.frame.resets || roomOver(this.frame))
      return this.frame;
    const fraction = Math.max(
      0,
      Math.min(
        1,
        ((now - this.startedAt) * PHYSICS.ticksPerSecond) / 1000 -
          this.frame.tick,
      ),
    );
    return {
      x: this.previous.x + (this.frame.x - this.previous.x) * fraction,
      y: this.previous.y + (this.frame.y - this.previous.y) * fraction,
    };
  }
  // Inputs over the server's per-second limit are dropped locally, so a held
  // attack key cannot make the replay invalid.
  input(action: Control) {
    if (roomOver(this.frame) || this.inputs.length >= PHYSICS.maxInputs) return;
    const tick = this.frame.tick + 1;
    const second = Math.floor((tick - 1) / PHYSICS.ticksPerSecond);
    const count = this.perSecond.get(second) ?? 0;
    if (count >= PHYSICS.maxInputsPerSecond) return;
    this.perSecond.set(second, count + 1);
    this.inputs.push({ tick, action });
  }
  advance(now: number): DungeonFrame {
    const through = Math.min(
      PHYSICS.maxRoomTicks,
      Math.max(
        0,
        Math.floor(((now - this.startedAt) * PHYSICS.ticksPerSecond) / 1000),
      ),
    );
    while (this.frame.tick < through && !roomOver(this.frame)) {
      const next = this.frame.tick + 1;
      const actions: Control[] = [];
      while (this.inputs[this.head]?.tick === next) {
        const input = this.inputs[this.head++];
        if (input) actions.push(input.action);
      }
      this.previous = this.frame;
      this.frame = stepRoom(
        this.frame,
        this.room,
        this.cat,
        this.rules,
        actions,
      );
    }
    return this.frame;
  }
}
