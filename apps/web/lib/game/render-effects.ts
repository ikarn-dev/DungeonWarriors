import type Phaser from "phaser";
import type { ImageAsset } from "./assets";

type Clip = ImageAsset["clips"][number];
type Burst = {
  sprite: Phaser.GameObjects.Image;
  clip: Clip | undefined;
  startedAt: number;
};

// Short one-shot animations (dust, pickups, hits) from a bounded pool. A new
// burst reuses the oldest sprite instead of growing the scene.
export class BurstPool {
  private readonly bursts: Burst[];
  private next = 0;
  private readonly clips: Map<string, Clip>;

  constructor(
    scene: Phaser.Scene,
    sheet: ImageAsset,
    size: number,
    depth: number,
  ) {
    this.clips = new Map(sheet.clips.map((clip) => [clip.name, clip]));
    this.bursts = Array.from({ length: size }, () => ({
      sprite: scene.add
        .image(0, 0, sheet.id, 0)
        .setDepth(depth)
        .setVisible(false),
      clip: undefined,
      startedAt: 0,
    }));
  }

  spawn(name: string, x: number, y: number, now: number, flip = false) {
    const burst = this.bursts[this.next];
    const clip = this.clips.get(name);
    if (!burst || !clip) return;
    this.next = (this.next + 1) % this.bursts.length;
    burst.clip = clip;
    burst.startedAt = now;
    burst.sprite
      .setPosition(x, y)
      .setFlipX(flip)
      .setFrame(clip.start)
      .setVisible(true);
  }

  update(now: number) {
    for (const burst of this.bursts) {
      const { clip, sprite } = burst;
      if (!clip || !sprite.visible) continue;
      const frame = Math.floor(((now - burst.startedAt) * clip.fps) / 1000);
      if (frame >= clip.count) {
        burst.clip = undefined;
        sprite.setVisible(false);
      } else sprite.setFrame(clip.start + frame);
    }
  }

  clear() {
    for (const burst of this.bursts) {
      burst.clip = undefined;
      burst.sprite.setVisible(false);
    }
  }
}

// Looping power aura that follows the runner while its effect is active.
export class Aura {
  private readonly sprite: Phaser.GameObjects.Image;
  private readonly clip: Clip | undefined;

  constructor(
    scene: Phaser.Scene,
    sheet: ImageAsset,
    name: string,
    depth: number,
  ) {
    this.clip = sheet.clips.find((clip) => clip.name === name);
    this.sprite = scene.add
      .image(0, 0, sheet.id, this.clip?.start ?? 0)
      .setDepth(depth)
      .setVisible(false);
  }

  show(active: boolean, x: number, y: number, now: number, still: boolean) {
    if (!active || !this.clip) {
      this.sprite.setVisible(false);
      return;
    }
    const frame = still
      ? 0
      : Math.floor((now * this.clip.fps) / 1000) % this.clip.count;
    this.sprite
      .setPosition(x, y)
      .setFrame(this.clip.start + frame)
      .setVisible(true);
  }
}
