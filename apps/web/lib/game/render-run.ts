import type Phaser from "phaser";
import type { AssetManifest } from "./assets";
import type { CatId } from "./catalog";
import { coinFrame, GAME_VIEW } from "./presentation";
import { RULES_V1 } from "./rules";
import { surfaceAt } from "./simulation-collision";
import type { WorldEntity } from "./simulation-state";
import type { WorldState } from "./world-state";

const width = GAME_VIEW.width;
const height = GAME_VIEW.height;
const groundOffset = Math.round(height * 0.18);
const pixels = (value: number) => value / 256;
const correctionMs = 46;
const powerTints = {
  magnet: 0xffd880,
  doubleJump: 0xb6a4f3,
  shield: 0x9ae1ff,
  extraDash: 0xfbaf91,
} as const;
const stills = [
  "background-sky",
  "background-forest-far",
  "background-forest-near",
  "coin-shadow",
  "star",
  "hazard-obstacle",
  "terrain-fill",
  "terrain-grass",
  "water-fill",
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
export function runImages(manifest: AssetManifest, cat: CatId) {
  return manifest.assets.filter(({ id }) =>
    [`cat-${cat}`, "coin-spin", ...stills].includes(id),
  );
}

export function renderRun(
  engine: typeof Phaser,
  parent: HTMLElement,
  manifest: AssetManifest,
  cat: CatId,
  world: () => WorldState,
  reduced: () => boolean,
  onError: () => void,
  onReady: () => void,
  preloaded?: ReadonlyMap<string, Blob>,
) {
  const catSheet = `cat-${cat}`;
  const images = runImages(manifest, cat);
  if (images.length !== stills.length + 2) throw new Error("ASSETS_NOT_READY");
  class RunScene extends engine.Scene {
    private scenery: Phaser.GameObjects.TileSprite[] = [];
    private land?: Phaser.GameObjects.Graphics;
    private effects?: Phaser.GameObjects.Graphics;
    private ground: [
      Phaser.GameObjects.TileSprite,
      Phaser.GameObjects.TileSprite,
    ][] = [];
    private runner?: Phaser.GameObjects.Image;
    private sprites: Phaser.GameObjects.Image[] = [];
    private shadows: Phaser.GameObjects.Image[] = [];
    private unavailable = false;
    private lastWorld?: WorldState;
    private lastReduced?: boolean;
    private displayX = 0;
    private displayY = 0;
    private catClips = new Map(
      images
        .find((item) => item.id === catSheet)
        ?.clips.map((clip) => [clip.name, clip]),
    );

    preload() {
      const urls: string[] = [];
      if (preloaded) {
        const release = () => {
          for (const url of urls.splice(0)) URL.revokeObjectURL(url);
        };
        this.load.once("complete", release);
        this.events.once("shutdown", release);
      }
      this.load.on("loaderror", () => {
        this.unavailable = true;
        onError();
      });
      for (const art of images) {
        const bytes = preloaded?.get(art.id);
        const url = bytes ? URL.createObjectURL(bytes) : art.path;
        if (bytes) urls.push(url);
        if (art.path.endsWith(".svg")) this.load.svg(art.id, url);
        else this.load.image(art.id, url);
      }
    }

    create() {
      if (this.unavailable) return;
      for (const art of images) {
        if (art.frames === 1) continue;
        const sheet = this.textures.addSpriteSheet(
          "",
          this.textures.get(art.id),
          {
            frameWidth: art.frameWidth,
            frameHeight: art.frameHeight,
            endFrame: art.frames - 1,
          },
        );
        if (!sheet || !sheet.has("0") || !sheet.has(String(art.frames - 1))) {
          this.unavailable = true;
          onError();
          return;
        }
      }
      this.scenery = [
        "background-sky",
        "background-forest-far",
        "background-forest-near",
      ].map((id, i) =>
        this.add
          .tileSprite(0, -i * groundOffset, width, height, id)
          .setOrigin(0),
      );
      this.add.tileSprite(0, height - 56, width, 56, "water-fill").setOrigin(0);
      this.land = this.add.graphics().setDepth(1);
      this.effects = this.add.graphics().setDepth(4);
      this.ground = Array.from({ length: 64 }, () => [
        this.add
          .tileSprite(0, 0, 32, 32, "terrain-fill")
          .setOrigin(0)
          .setDepth(2),
        this.add
          .tileSprite(0, 0, 32, 8, "terrain-grass")
          .setOrigin(0)
          .setDepth(2),
      ]);
      this.shadows = Array.from({ length: 64 }, () =>
        this.add.image(0, 0, "coin-shadow").setDepth(3).setVisible(false),
      );
      this.sprites = Array.from({ length: 64 }, () =>
        this.add.image(0, 0, "star").setDepth(4).setVisible(false),
      );
      this.runner = this.add
        .image(0, 0, catSheet, 0)
        .setOrigin(24 / 48, 40 / 48)
        .setDepth(5);
      onReady();
    }

    override update(_time: number, delta: number) {
      if (!this.land || !this.runner || !this.effects || this.unavailable)
        return;
      const current = world();
      const reduceMotion = reduced();
      const { frame, entities, worldOriginPixels } = current;
      const { runner } = frame;
      const playing = frame.phase === "active" && frame.activeTicks > 0n;
      const previous = this.lastWorld;
      const targetX = pixels(runner.xSubpixels);
      const targetY = pixels(runner.ySubpixels);
      const offset = previous
        ? Number(worldOriginPixels - previous.worldOriginPixels)
        : 0;
      const fromX = this.displayX - offset;
      const fromY = this.displayY;
      const mix =
        !playing ||
        !previous ||
        previous.frame.phase !== "active" ||
        reduceMotion
          ? 1
          : 1 - Math.exp(-delta / correctionMs);
      const blend = (from: number, target: number) =>
        Math.abs(target - from) < 0.125 ||
        Math.abs(target - from) > GAME_VIEW.hitboxWidth * 2
          ? target
          : from + (target - from) * mix;
      this.displayX = blend(fromX, targetX);
      this.displayY = blend(fromY, targetY);
      if (
        previous === current &&
        this.lastReduced === reduceMotion &&
        this.displayX === fromX &&
        this.displayY === fromY
      )
        return;
      this.lastWorld = current;
      this.lastReduced = reduceMotion;
      const animationTime =
        (Number(frame.activeTicks % BigInt(RULES_V1.ticksPerSecond * 60)) *
          1000) /
        RULES_V1.ticksPerSecond;
      const left = this.displayX - width * 0.28;
      const origin = Number(worldOriginPixels % BigInt(width * 40)) + left;
      this.scenery.forEach((layer, i) => {
        layer.tilePositionX = origin * (i === 0 ? 0 : i === 1 ? 0.15 : 0.35);
      });
      const terrain = entities.filter(
        (entity) => entity.kind === "ramp" || entity.kind === "terrain",
      );
      this.land.clear();
      let groundUsed = 0;
      for (const entity of terrain) {
        const x = Math.round(pixels(entity.xSubpixels) - left);
        const y = Math.round(pixels(entity.ySubpixels)) + groundOffset;
        const end = Math.round(
          pixels(entity.xSubpixels + entity.widthSubpixels) - left,
        );
        if (end <= 0 || x >= width) continue;
        const tiles = this.ground[groundUsed];
        if (
          (entity.kind === "terrain" ||
            (entity.kind === "ramp" && entity.riseSubpixels === 0)) &&
          tiles &&
          y < height
        ) {
          const from = Math.max(0, x);
          const span = Math.min(width, end) - from;
          tiles[0]
            .setPosition(from, y)
            .setSize(span, height - y)
            .setVisible(true);
          tiles[1].setPosition(from, y).setSize(span, 8).setVisible(true);
          for (const tile of tiles) tile.tilePositionX = from - x;
          groundUsed++;
          continue;
        }
        const rise = entity.kind === "ramp" ? pixels(entity.riseSubpixels) : 0;
        this.land
          .fillStyle(0x34463a)
          .beginPath()
          .moveTo(x, y)
          .lineTo(end, y + rise)
          .lineTo(end, height)
          .lineTo(x, height)
          .closePath()
          .fillPath();
        this.land
          .lineStyle(4, 0x52644a)
          .lineBetween(x, y + 12, end, y + rise + 12)
          .lineStyle(5, 0x8cbe61)
          .lineBetween(x, y + 2, end, y + rise + 2)
          .lineStyle(2, 0xbfda7b)
          .lineBetween(x, y, end, y + rise);
      }
      for (let i = groundUsed; i < this.ground.length; i++)
        this.ground[i]?.forEach((tile) => {
          tile.setVisible(false);
        });
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
        this.spawn(entity, x, sprite, shadow, terrain, animationTime);
      }
      for (let i = used; i < this.sprites.length; i++) {
        this.sprites[i]?.setVisible(false);
        this.shadows[i]?.setVisible(false);
      }
      const pose = !playing
        ? "idle"
        : runner.dashEndsAtTick > frame.activeTicks
          ? "dash"
          : runner.grounded
            ? "run"
            : runner.vySubpixelsPerTick < 0
              ? "jump"
              : "fall";
      const clip = this.catClips.get(pose);
      const cadence =
        pose === "run"
          ? runner.automaticSpeedSubpixelsPerTick /
            RULES_V1.physics.runnerSpeedSubpixelsPerTick
          : 1;
      const animated =
        clip && !reduceMotion
          ? clip.start +
            (Math.floor((animationTime * clip.fps * cadence) / 1000) %
              clip.count)
          : (clip?.start ?? 0);
      const runnerX = this.displayX - left + GAME_VIEW.hitboxWidth / 2;
      const runnerY = this.displayY + GAME_VIEW.hitboxHeight + groundOffset;
      this.runner.setFrame(animated).setPosition(runnerX, runnerY);
      this.effects.clear();
      let radius = 22;
      for (const power of [
        "magnet",
        "doubleJump",
        "shield",
        "extraDash",
      ] as const) {
        const state = frame.powers[power];
        if (state.charges > 0 && frame.activeTicks < state.endsAtTick) {
          this.effects
            .lineStyle(2, powerTints[power], 0.84)
            .strokeCircle(
              runnerX,
              runnerY - GAME_VIEW.hitboxHeight / 2,
              radius,
            );
          radius += 4;
        }
      }
    }

    private spawn(
      entity: WorldEntity,
      x: number,
      sprite: Phaser.GameObjects.Image,
      shadow: Phaser.GameObjects.Image,
      terrain: WorldEntity[],
      time: number,
    ) {
      const y =
        pixels(entity.ySubpixels + entity.heightSubpixels / 2) + groundOffset;
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
            .setPosition(x, pixels(surface) + groundOffset)
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
        sprite
          .setVisible(true)
          .setTexture(texture)
          .setPosition(
            x,
            entity.kind === "hazard"
              ? y + pixels(entity.heightSubpixels) / 2 - sprite.height / 2
              : y,
          );
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
