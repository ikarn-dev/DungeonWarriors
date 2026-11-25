import type Phaser from "phaser";
import {
  type AssetManifest,
  ENEMY_RIG_PARTS,
  type RiggedEnemy,
} from "../game/assets";
import type { EnemyKind } from "./rooms";

// Enemy rigs (2026-11-25). Skeletons, bats and wardens are drawn from parts
// that share their 128 px canvas (scripts/assets/enemy-art.mjs); the slime is
// one piece that squashes. Art faces left. Each foe walks or flaps as it
// moves and, within reach of the warrior, winds up and strikes in a loop.
// The simulation still decides damage (contact, in enemies.ts and
// simulation.ts); this is presentation only and leaves the engine unchanged.
const ROOT: Readonly<Record<EnemyKind, { x: number; y: number }>> = {
  slime: { x: 64, y: 120 },
  skeleton: { x: 64, y: 120 },
  bat: { x: 64, y: 90 },
  warden: { x: 64, y: 120 },
};
// Attack loop length in ms; the strike lands at the middle of the loop.
const ATTACK_MS: Readonly<Record<EnemyKind, number>> = {
  slime: 900,
  skeleton: 820,
  bat: 700,
  warden: 1150,
};
// Canvas units travelled per walk cycle.
const STRIDE = 34;

export type EnemyPose = {
  readonly id: number;
  readonly kind: EnemyKind;
  readonly x: number;
  readonly feet: number;
  // World units per canvas unit.
  readonly scale: number;
  readonly flip: boolean;
  // Within reach of the warrior.
  readonly engaged: boolean;
  readonly staggered: boolean;
  readonly flash: boolean;
  // 0 to 1 just after a hit, for the recoil.
  readonly recoil: number;
};

const isRigged = (kind: EnemyKind): kind is RiggedEnemy => kind !== "slime";
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const easeIn = (t: number) => t * t * t;

// Wind-up to 0.45, a fast strike to 0.6, then recovery.
function attackCurve(t: number) {
  if (t < 0.45) return { windup: easeOut(t / 0.45), strike: 0 };
  if (t < 0.6) return { windup: 1, strike: easeIn((t - 0.45) / 0.15) };
  const back = easeOut((t - 0.6) / 0.4);
  return { windup: 1 - back, strike: 1 - back };
}

export class EnemyRig {
  readonly container: Phaser.GameObjects.Container;
  private kind: EnemyKind | null = null;
  private id: number | null = null;
  private parts = new Map<string, Phaser.GameObjects.Image>();
  private pivots = new Map<string, { x: number; y: number }>();
  private phase = 0;
  private lastX: number | null = null;
  private move = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly engine: typeof Phaser,
    private readonly manifest: AssetManifest,
    depth: number,
  ) {
    this.container = scene.add
      .container(0, 0)
      .setDepth(depth)
      .setVisible(false);
  }

  private build(kind: EnemyKind) {
    this.container.removeAll(true);
    this.parts.clear();
    this.pivots.clear();
    this.kind = kind;
    this.lastX = null;
    const root = ROOT[kind];
    const names: readonly string[] = isRigged(kind)
      ? ENEMY_RIG_PARTS[kind]
      : ["whole"];
    for (const name of names) {
      const id = name === "whole" ? `enemy-${kind}` : `enemy-${kind}-${name}`;
      const pivot =
        name === "whole"
          ? root
          : this.manifest.assets.find((a) => a.id === id)?.anchor;
      if (!pivot) throw new Error("ASSETS_NOT_READY");
      const image = this.scene.add
        .image(pivot.x - root.x, pivot.y - root.y, id)
        .setOrigin(pivot.x / 128, pivot.y / 128)
        .setDisplaySize(128, 128);
      this.parts.set(name, image);
      this.pivots.set(name, pivot);
      this.container.add(image);
    }
  }

  hide() {
    this.container.setVisible(false);
    this.lastX = null;
  }

  update(pose: EnemyPose, time: number, still: boolean) {
    if (pose.kind !== this.kind) this.build(pose.kind);
    if (pose.id !== this.id) {
      this.id = pose.id;
      this.lastX = null;
      this.move = 0;
    }
    const travelled =
      this.lastX === null ? 0 : Math.abs(pose.x - this.lastX) / pose.scale;
    this.lastX = pose.x;
    this.move = still
      ? 0
      : this.move + ((travelled > 0.05 ? 1 : 0) - this.move) * 0.2;
    if (!still) this.phase += (travelled / STRIDE) * Math.PI * 2;
    const loop = ATTACK_MS[pose.kind];
    const attack =
      pose.engaged && !pose.staggered && !still
        ? attackCurve(((time + pose.id * 137) % loop) / loop)
        : { windup: 0, strike: 0 };
    const breath = still ? 0 : Math.sin(time / 520 + pose.id);
    const swing = Math.sin(this.phase) * this.move;
    let lunge = 0;
    let lift = 0;
    let sy = 1;
    let tilt = 0;
    switch (pose.kind) {
      case "slime": {
        // Gathers low, then springs forward and stretches at the strike.
        const hop = still ? 0 : Math.abs(Math.sin(time / 160 + pose.id));
        sy =
          1 + 0.06 * (hop - 0.5) - 0.18 * attack.windup + 0.3 * attack.strike;
        lunge = 14 * attack.strike;
        lift = -10 * attack.strike;
        break;
      }
      case "skeleton": {
        this.turn("leg-back", 0.42 * swing);
        this.turn("leg-front", -0.42 * swing);
        this.turn(
          "torso",
          -0.05 * attack.windup + 0.12 * attack.strike,
          -1.5 * Math.abs(swing),
        );
        // Raise the blade back over the shoulder, then chop forward.
        this.turn(
          "weapon-arm",
          0.15 * swing +
            0.04 * breath +
            0.95 * attack.windup -
            1.9 * attack.strike,
          -1.5 * Math.abs(swing),
        );
        this.turn(
          "head",
          0.05 * breath - 0.1 * attack.strike,
          -1.5 * Math.abs(swing) + breath,
        );
        lunge = 6 * attack.strike - 2 * attack.windup;
        break;
      }
      case "warden": {
        this.turn("leg-back", 0.28 * swing);
        this.turn("leg-front", -0.28 * swing);
        this.turn("robe", 0.04 * swing + 0.02 * breath);
        this.turn(
          "body",
          -0.06 * attack.windup + 0.1 * attack.strike,
          -1.2 * Math.abs(swing),
        );
        // Heave the axe high, then bring it down hard. The axe sits behind
        // the body and the arm in front, turning together at the shoulder.
        const chop = 0.03 * breath + 1.1 * attack.windup - 2.1 * attack.strike;
        this.turn("axe", chop, -1.2 * Math.abs(swing));
        this.turn("arm", chop, -1.2 * Math.abs(swing));
        this.turn(
          "head",
          0.04 * breath - 0.08 * attack.strike,
          -1.2 * Math.abs(swing) + breath,
        );
        lunge = 8 * attack.strike - 3 * attack.windup;
        sy = 1 - 0.04 * attack.strike;
        break;
      }
      case "bat": {
        // Wings beat faster in the dive; the body swoops at the strike.
        const beat = still
          ? 0
          : Math.sin(time / (attack.windup > 0 ? 45 : 70) + pose.id);
        this.turn("wing-back", 0.55 * beat - 0.5 * attack.strike);
        this.turn("wing-front", -0.55 * beat + 0.5 * attack.strike);
        this.turn("body", 0.06 * beat);
        lunge = 16 * attack.strike - 4 * attack.windup;
        lift = -6 * attack.windup + 10 * attack.strike;
        tilt = -0.25 * attack.strike;
        break;
      }
      default: {
        const unknown: never = pose.kind;
        throw new Error(`UNKNOWN_ENEMY_${String(unknown)}`);
      }
    }
    sy *= 1 + 0.015 * breath - 0.1 * pose.recoil;
    const sx = 1 / Math.sqrt(sy);
    // Art faces left; forward is −x unless flipped.
    const forward = pose.flip ? 1 : -1;
    this.container
      .setVisible(true)
      .setPosition(
        pose.x + (lunge - 5 * pose.recoil) * pose.scale * forward,
        pose.feet + lift * pose.scale,
      )
      .setScale(pose.scale * sx * (pose.flip ? -1 : 1), pose.scale * sy)
      .setRotation((tilt + 0.12 * pose.recoil) * -forward);
    for (const image of this.parts.values()) {
      if (pose.flash && !still)
        image.setTint(0xffffff).setTintMode(this.engine.TintModes.FILL);
      else {
        image.setTintMode(this.engine.TintModes.MULTIPLY);
        if (pose.staggered) image.setTint(0xffb8b8);
        else image.clearTint();
      }
    }
  }

  // Rotates a part about its pivot and lifts it, in canvas units.
  private turn(name: string, rotation: number, lift = 0) {
    const image = this.parts.get(name);
    const pivot = this.pivots.get(name);
    if (!image || !pivot || this.kind === null) return;
    const root = ROOT[this.kind];
    image
      .setRotation(rotation)
      .setPosition(pivot.x - root.x, pivot.y - root.y + lift);
  }
}
