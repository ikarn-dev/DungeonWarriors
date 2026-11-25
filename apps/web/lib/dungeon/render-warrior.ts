import type Phaser from "phaser";
import { type AssetManifest, RIG_PARTS, type RigPart } from "../game/assets";
import type { CatId } from "../game/catalog";
import { WARRIORS } from "./warriors";

// Side-view warrior rig (2026-11-24). Parts share one 128 px body space with
// feet on y = 120 and face right; their manifest anchors are the pivots
// (scripts/assets/warrior-rig.mjs). The container sits on the feet, so a part
// drawn at its pivot with no rotation rebuilds the whole cat.
export const BODY_SCALE = 0.56;
const ROOT = { x: 62, y: 120 };
// Weapon hand on the near arm (RIG_HAND in warrior-rig.mjs).
const HAND = { x: 70, y: 88 };
// Body units travelled per full walk cycle, so feet do not slide.
const STRIDE = 30;
const REST_WEAPON = 1.0;

export type RigPose = {
  readonly x: number;
  readonly feet: number;
  readonly dir: -1 | 1;
  readonly grounded: boolean;
  readonly vy: number;
  // 0 at the start of a swing, 1 at its end; null between swings.
  readonly swing: number | null;
  readonly hurt: boolean;
  readonly blink: boolean;
  readonly down: boolean;
};

const approach = (from: number, to: number, rate: number, dt: number) =>
  from + (to - from) * (1 - Math.exp(-rate * dt));
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const easeInOut = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;

export class WarriorRig {
  readonly container: Phaser.GameObjects.Container;
  private parts = new Map<RigPart, Phaser.GameObjects.Image>();
  private pivots = new Map<RigPart, { x: number; y: number }>();
  private weapon: Phaser.GameObjects.Image;
  private spear: boolean;
  private phase = 0;
  private move = 0;
  private air = 0;
  private face = 1;
  private lastX: number | null = null;
  private lastTime: number | null = null;
  private landedAt = -Infinity;
  private hurtAt = -Infinity;
  private wasGrounded = true;
  private lean = 0;

  constructor(
    scene: Phaser.Scene,
    manifest: AssetManifest,
    cat: CatId,
    depth: number,
  ) {
    const weaponId = `weapon-${WARRIORS[cat].weapon}`;
    const grip = manifest.assets.find((a) => a.id === weaponId)?.anchor;
    if (!grip) throw new Error("ASSETS_NOT_READY");
    this.spear = WARRIORS[cat].weapon === "spear";
    // The axe head is wide, so it is drawn smaller, as in the portraits.
    const size = 96 * (WARRIORS[cat].weapon === "axe" ? 0.68 : 0.78);
    this.weapon = scene.add
      .image(0, 0, weaponId)
      .setOrigin(grip.x / 96, grip.y / 96)
      .setDisplaySize(size, size);
    const children: Phaser.GameObjects.Image[] = [];
    for (const part of RIG_PARTS) {
      const id = `rig-${cat}-${part}`;
      const pivot = manifest.assets.find((a) => a.id === id)?.anchor;
      if (!pivot) throw new Error("ASSETS_NOT_READY");
      const image = scene.add
        .image(pivot.x - ROOT.x, pivot.y - ROOT.y, id)
        .setOrigin(pivot.x / 128, pivot.y / 128)
        .setDisplaySize(128, 128);
      this.parts.set(part, image);
      this.pivots.set(part, pivot);
      // The weapon sits between the head and the hand that grips it.
      if (part === "arm-near") children.push(this.weapon);
      children.push(image);
    }
    this.container = scene.add.container(0, 0, children).setDepth(depth);
  }

  // Called once per rendered frame with the interpolated pose.
  update(pose: RigPose, time: number, still: boolean) {
    const dt =
      this.lastTime === null
        ? 0
        : Math.min(0.05, (time - this.lastTime) / 1000);
    this.lastTime = time;
    const travelled =
      this.lastX === null ? 0 : Math.abs(pose.x - this.lastX) / BODY_SCALE;
    this.lastX = pose.x;
    const walking = pose.grounded && travelled > 0.05 && !pose.down;
    if (pose.grounded && !this.wasGrounded) this.landedAt = time;
    this.wasGrounded = pose.grounded;
    if (pose.hurt) this.hurtAt = time;
    if (still) {
      this.move = 0;
      this.air = pose.grounded ? 0 : 1;
      this.face = pose.dir;
    } else {
      this.move = approach(this.move, walking ? 1 : 0, 12, dt);
      this.air = approach(this.air, pose.grounded ? 0 : 1, 14, dt);
      this.face = approach(this.face, pose.dir, 18, dt);
      if (pose.grounded) this.phase += (travelled / STRIDE) * Math.PI * 2;
    }
    const s = Math.sin(this.phase);
    const breath = still ? 0 : Math.sin(time / 650);
    const idle = 1 - this.move;
    const rising = pose.vy < 0 ? 1 : 0;
    const land = still ? 0 : Math.max(0, 1 - (time - this.landedAt) / 180);
    const hurt = still ? 0 : Math.max(0, 1 - (time - this.hurtAt) / 260);

    let legNear = -0.34 * s * this.move;
    let legFar = 0.34 * s * this.move;
    let armFar = 0.2 * s * this.move + 0.03 * breath * idle;
    let armNear = -0.1 * s * this.move + 0.04 * breath * idle;
    let weapon = REST_WEAPON;
    let lunge = 0;
    let lean = 0.07 * this.move;
    // Airborne: tuck the near leg forward, trail the far one, lift the shield.
    legNear += (-0.4 - legNear) * this.air;
    legFar += (0.3 - legFar) * this.air;
    armFar += (-0.35 - armFar) * this.air;
    // The simulation lands the hit about a quarter of the way through the
    // swing (SWING_HIT), so the wind-up ends at 0.2 and the blade connects then.
    if (pose.swing !== null && !still) {
      const p = pose.swing;
      if (this.spear) {
        // Draw back, thrust level, then recover.
        const draw = p < 0.2 ? easeOut(p / 0.2) : 1;
        const thrust = p < 0.2 ? 0 : easeOut(Math.min(1, (p - 0.2) / 0.2));
        const back = p > 0.75 ? easeInOut((p - 0.75) / 0.25) : 0;
        armNear = -0.45 * (1 - back) + armNear * back;
        weapon = REST_WEAPON + (Math.PI / 2 - REST_WEAPON) * draw * (1 - back);
        lunge = (8 * thrust - 3 * draw * (1 - thrust)) * (1 - back);
        lean = (0.14 * thrust - 0.04 * (1 - thrust)) * (1 - back);
      } else {
        // Draw the blade back past the hip, then slash forward and down; the
        // arc stays clear of the face in side view.
        const up = p < 0.2 ? easeOut(p / 0.2) : 1;
        const down = p < 0.2 ? 0 : easeOut(Math.min(1, (p - 0.2) / 0.3));
        const back = p > 0.8 ? easeInOut((p - 0.8) / 0.2) : 0;
        armNear = (0.5 * up - 1.2 * down) * (1 - back) + armNear * back;
        weapon =
          (REST_WEAPON - 2 * up + 3 * down) * (1 - back) + REST_WEAPON * back;
        lunge = 4 * down * (1 - back);
        lean = (-0.06 * up + 0.16 * down) * (1 - back) + lean * back;
      }
    } else if (pose.swing !== null) {
      weapon = this.spear ? Math.PI / 2 : REST_WEAPON + 0.8;
    }
    const bob = -2.4 * Math.abs(Math.cos(this.phase)) * this.move;
    const squash = 1 - 0.12 * land;
    const stretch = 1 + (0.06 * rising - 0.02 * (1 - rising)) * this.air;
    const sy = squash * stretch * (1 + 0.016 * breath * idle);
    const sx = 1 / Math.sqrt(sy);

    this.lean = lean;
    this.set("leg-near", legNear, 0, false);
    this.set("leg-far", legFar, 0, false);
    this.set("torso", lean, bob, false);
    this.set("arm-far", armFar + lean, bob);
    this.set("arm-near", armNear + lean * 0.5, bob);
    this.set(
      "head",
      lean * 0.6 + 0.035 * Math.sin(this.phase * 2 + 0.6) * this.move,
      bob * 1.15 - 0.8 * breath * idle,
    );
    const flutter = still ? 0 : 0.05 * Math.sin(time / 280);
    this.set(
      "cape",
      0.16 * this.move + 0.22 * this.air * rising + flutter,
      bob,
    );
    this.set(
      "tail",
      (still ? 0 : 0.12 * Math.sin(time / 420)) + 0.1 * s * this.move,
      bob,
    );
    const arm = this.parts.get("arm-near");
    const turn = arm?.rotation ?? 0;
    const shoulder = { x: arm?.x ?? 0, y: arm?.y ?? 0 };
    const pivot = this.pivots.get("arm-near") ?? HAND;
    const hx = HAND.x - pivot.x;
    const hy = HAND.y - pivot.y;
    this.weapon
      .setPosition(
        shoulder.x + hx * Math.cos(turn) - hy * Math.sin(turn),
        shoulder.y + hx * Math.sin(turn) + hy * Math.cos(turn),
      )
      .setRotation(weapon + lean * 0.5);

    // Turning narrows the cat through its side instead of snapping.
    const facing =
      Math.sign(this.face || pose.dir) * Math.max(0.15, Math.abs(this.face));
    this.container
      .setPosition(
        pose.x + (lunge - 2.5 * hurt) * BODY_SCALE * Math.sign(facing),
        pose.feet,
      )
      .setScale(BODY_SCALE * sx * facing, BODY_SCALE * sy)
      .setRotation(
        pose.down ? 1.3 * pose.dir : -0.14 * hurt * Math.sign(facing),
      )
      .setAlpha(pose.blink ? 0.45 : 1);
    const tint = pose.down ? 0x8f88ad : hurt > 0.4 ? 0xff8a8a : null;
    for (const image of [...this.parts.values(), this.weapon]) {
      if (tint === null) image.clearTint();
      else image.setTint(tint);
    }
    this.weapon.setVisible(!pose.down);
  }

  // Parts above the hips ride on the torso: its lean carries their pivots
  // round the hip, so the neck and shoulders stay joined.
  private set(part: RigPart, rotation: number, lift: number, follow = true) {
    const image = this.parts.get(part);
    const pivot = this.pivots.get(part);
    const hip = this.pivots.get("torso");
    if (!image || !pivot || !hip) return;
    const rise = follow ? hip.y - pivot.y : 0;
    image
      .setRotation(rotation)
      .setPosition(
        pivot.x - ROOT.x + rise * Math.sin(this.lean),
        pivot.y - ROOT.y + lift + rise * (1 - Math.cos(this.lean)),
      );
  }
}
