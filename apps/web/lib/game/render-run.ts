import type Phaser from "phaser";
import type { AssetManifest } from "./assets";
import type { CatId } from "./catalog";
import { coinFrame, GAME_VIEW } from "./presentation";
import { surfaceAt } from "./simulation-collision";
import type { WorldEntity } from "./simulation-state";
import type { WorldState } from "./world-state";

const width = GAME_VIEW.width;
const height = GAME_VIEW.height;
const pixels = (value: number) => value / 256;
const stills = [
  "background-sky",
  "background-forest-far",
  "background-forest-near",
  "coin-shadow",
  "star",
  "hazard-obstacle",
  "booster-magnet",
  "booster-shield",
  "booster-double-jump",
  "booster-extra-dash",
] as const;
const boosters = {
  magnet: "booster-magnet",
  shield: "booster-shield",
  doubleJump: "booster-double-jump",
  extraDash: "booster-extra-dash",
} as const;

export function renderRun(
  engine: typeof Phaser,
  parent: HTMLElement,
  manifest: AssetManifest,
  cat: CatId,
  world: () => WorldState,
  reduced: () => boolean,
  onError: () => void,
) {
  const catSheet = `cat-${cat}`;
  const images = manifest.assets.filter((item) =>
    [catSheet, "coin-spin", ...stills].includes(item.id),
  );
  if (images.length !== stills.length + 2) throw new Error("ASSETS_NOT_READY");
  class RunScene extends engine.Scene {
    private scenery: Phaser.GameObjects.TileSprite[] = [];
    private land?: Phaser.GameObjects.Graphics;
    private runner?: Phaser.GameObjects.Image;
    private sprites: Phaser.GameObjects.Image[] = [];
    private shadows: Phaser.GameObjects.Image[] = [];
    private unavailable = false;
    private catClips = new Map(
      images
        .find((item) => item.id === catSheet)
        ?.clips.map((clip) => [clip.name, clip]),
    );

    preload() {
      this.load.on("loaderror", () => {
        this.unavailable = true;
        onError();
      });
      for (const art of images) {
        const key = art.frames === 1 ? art.id : `${art.id}-source`;
        if (art.path.endsWith(".svg")) this.load.svg(key, art.path);
        else this.load.image(key, art.path);
      }
    }

    create() {
      if (this.unavailable) return;
      for (const art of images) {
        if (art.frames === 1) continue;
        const sheet = this.textures.addSpriteSheet(
          art.id,
          this.textures.get(`${art.id}-source`),
          {
            frameWidth: art.frameWidth,
            frameHeight: art.frameHeight,
            endFrame: art.frames - 1,
          },
        );
        if (sheet === null) {
          this.unavailable = true;
          onError();
          return;
        }
      }
      this.scenery = [
        "background-sky",
        "background-forest-far",
        "background-forest-near",
      ].map((id) => this.add.tileSprite(0, 0, width, height, id).setOrigin(0));
      this.land = this.add.graphics().setDepth(1);
      this.shadows = Array.from({ length: 64 }, () =>
        this.add.image(0, 0, "coin-shadow").setDepth(2).setVisible(false),
      );
      this.sprites = Array.from({ length: 64 }, () =>
        this.add.image(0, 0, "star").setDepth(3).setVisible(false),
      );
      this.runner = this.add
        .image(0, 0, catSheet, 0)
        .setOrigin(24 / 48, 40 / 48)
        .setDepth(4);
    }

    override update(time: number) {
      if (!this.land || !this.runner || this.unavailable) return;
      const { frame, entities, worldOriginPixels } = world();
      const { runner } = frame;
      const left = pixels(runner.xSubpixels) - width * 0.28;
      const origin = Number(worldOriginPixels % BigInt(width * 40)) + left;
      this.scenery.forEach((layer, i) => {
        layer.tilePositionX = origin * (i === 0 ? 0 : i === 1 ? 0.15 : 0.35);
      });
      const terrain = entities.filter(
        (entity) => entity.kind === "ramp" || entity.kind === "terrain",
      );
      this.land.clear();
      for (const entity of terrain) {
        const x = pixels(entity.xSubpixels) - left;
        const y = pixels(entity.ySubpixels);
        const end = x + pixels(entity.widthSubpixels);
        if (end < 0 || x > width) continue;
        const rise = entity.kind === "ramp" ? pixels(entity.riseSubpixels) : 0;
        this.land
          .fillStyle(0x314b3e)
          .beginPath()
          .moveTo(x, y)
          .lineTo(end, y + rise)
          .lineTo(end, height)
          .lineTo(x, height)
          .closePath()
          .fillPath();
        this.land.lineStyle(4, 0xb0ce74).lineBetween(x, y, end, y + rise);
      }
      let used = 0;
      for (const entity of entities) {
        if (
          entity.consumed ||
          entity.kind === "ramp" ||
          entity.kind === "terrain"
        )
          continue;
        const center = entity.xSubpixels + entity.widthSubpixels / 2;
        const x = pixels(center) - left;
        if (x < -32 || x > width + 32) continue;
        const sprite = this.sprites[used];
        const shadow = this.shadows[used++];
        if (!sprite || !shadow) break;
        this.spawn(entity, x, sprite, shadow, terrain, time);
      }
      for (let i = used; i < this.sprites.length; i++) {
        this.sprites[i]?.setVisible(false);
        this.shadows[i]?.setVisible(false);
      }
      const pose =
        frame.phase === "terminalRecorded" ||
        frame.phase === "completionRequested"
          ? "idle"
          : runner.dashEndsAtTick > frame.activeTicks
            ? "dash"
            : runner.grounded
              ? "run"
              : runner.vySubpixelsPerTick < 0
                ? "jump"
                : "fall";
      const clip = this.catClips.get(pose);
      const animated =
        clip && !reduced()
          ? clip.start + (Math.floor((time * clip.fps) / 1000) % clip.count)
          : (clip?.start ?? 0);
      this.runner
        .setFrame(animated)
        .setPosition(
          pixels(runner.xSubpixels) - left + GAME_VIEW.hitboxWidth / 2,
          pixels(runner.ySubpixels) + GAME_VIEW.hitboxHeight,
        );
    }

    private spawn(
      entity: WorldEntity,
      x: number,
      sprite: Phaser.GameObjects.Image,
      shadow: Phaser.GameObjects.Image,
      terrain: WorldEntity[],
      time: number,
    ) {
      const y = pixels(entity.ySubpixels + entity.heightSubpixels / 2);
      shadow.setVisible(false);
      if (entity.kind === "coin") {
        sprite
          .setVisible(true)
          .setTexture("coin-spin", coinFrame(time, reduced()))
          .setPosition(x, y);
        const point = Math.trunc(entity.xSubpixels + entity.widthSubpixels / 2);
        const track = terrain.find(
          (e) =>
            point >= e.xSubpixels && point < e.xSubpixels + e.widthSubpixels,
        );
        const surface = track ? surfaceAt(track, point) : null;
        if (track && surface !== null)
          shadow
            .setVisible(true)
            .setPosition(x, pixels(surface))
            .setRotation(
              Math.atan2(
                track.kind === "ramp" ? track.riseSubpixels : 0,
                track.widthSubpixels,
              ),
            );
      } else {
        const texture =
          entity.kind === "star"
            ? "star"
            : entity.kind === "booster"
              ? boosters[entity.power]
              : "hazard-obstacle";
        sprite.setVisible(true).setTexture(texture).setPosition(x, y);
      }
    }
  }
  return new engine.Game({
    type: engine.AUTO,
    parent,
    width,
    height,
    render: { pixelArt: true, antialias: false },
    scale: { mode: engine.Scale.FIT, autoCenter: engine.Scale.CENTER_BOTH },
    backgroundColor: "#173b32",
    scene: [RunScene],
  });
}
