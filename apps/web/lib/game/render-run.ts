import type Phaser from "phaser";
import type { AssetManifest, ImageAsset } from "./assets";
import type { CatId } from "./catalog";
import {
  coinFrame,
  GAME_VIEW,
  RUN_VIEW,
  type RunViewport,
  runViewport,
} from "./presentation";
import { Aura, BurstPool } from "./render-effects";
import {
  type Surface,
  surfacePixels,
  surfaces,
  TerrainColumns,
} from "./render-terrain";
import { RULES_V1, RULES_V3 } from "./rules";
import type { WorldEntity } from "./simulation-state";
import type { WorldState } from "./world-state";

const px = (value: number) => value / 256;
const correctionMs = 90;
// A whole number of repeats for every parallax layer, tile and segment, so
// rebasing the world origin never shifts a texture.
const ANCHOR_PERIOD = 19_200n;
const RUN_STRIDE_PX = 16;
const LAND_MS = 110;
const layers = [
  ["background-sky", 0.05],
  ["background-forest-far", 0.2],
  ["background-forest-near", 0.4],
] as const;
const stills = [
  "background-sky",
  "background-forest-far",
  "background-forest-near",
  "coin-shadow",
  "hazard-obstacle",
  "terrain-fill",
  "terrain-grass",
  "booster-magnet",
  "booster-shield",
  "booster-double-jump",
  "booster-extra-dash",
] as const;
const sheets = [
  "coin-spin",
  "star",
  "effects-actions",
  "effects-powers",
] as const;
const boosters = {
  magnet: "booster-magnet",
  shield: "booster-shield",
  doubleJump: "booster-double-jump",
  extraDash: "booster-extra-dash",
} as const;
const auras = [
  ["magnet", "magnet"],
  ["doubleJump", "double-jump"],
  ["extraDash", "extra-dash"],
  ["shield", "shield-active"],
] as const;

export function runImages(manifest: AssetManifest, cat: CatId) {
  const wanted = new Set<string>([`cat-${cat}`, ...sheets, ...stills]);
  return manifest.assets.filter(({ id }) => wanted.has(id));
}

export type RunRenderOptions = {
  rulesVersion: number;
  world: () => WorldState;
  // Elapsed fraction of the next predicted tick and the reconcile counter.
  sample: () => { lead: number; revision: number };
  reduced: () => boolean;
  onError: () => void;
  onReady: () => void;
  preloaded?: ReadonlyMap<string, Blob> | undefined;
};

type Motion = { x: number; y: number; t: number; revision: number };

export function renderRun(
  engine: typeof Phaser,
  parent: HTMLElement,
  manifest: AssetManifest,
  cat: CatId,
  options: RunRenderOptions,
) {
  const images = runImages(manifest, cat);
  const asset = (id: string): ImageAsset => {
    const found = images.find((art) => art.id === id);
    if (!found) throw new Error("ASSETS_NOT_READY");
    return found;
  };
  const catSheet = asset(`cat-${cat}`);
  const starSheet = asset("star");
  const actions = asset("effects-actions");
  const powerSheet = asset("effects-powers");
  const catClips = new Map(catSheet.clips.map((clip) => [clip.name, clip]));
  const measure = (): RunViewport => {
    const box = parent.getBoundingClientRect();
    return runViewport(
      Math.max(1, box.width),
      Math.max(1, box.height),
      globalThis.devicePixelRatio || 1,
    );
  };
  let view = measure();

  class RunScene extends engine.Scene {
    private layers: Phaser.GameObjects.TileSprite[] = [];
    private terrain?: TerrainColumns;
    private runner?: Phaser.GameObjects.Image;
    private pickups: Phaser.GameObjects.Image[] = [];
    private shadows: Phaser.GameObjects.Image[] = [];
    private dust?: BurstPool;
    private sparkle?: BurstPool;
    private auras: [(typeof auras)[number][0], Aura][] = [];
    private contact?: Aura;
    private applied?: RunViewport;
    private unavailable = false;
    private lastWorld?: WorldState;
    private motion?: Motion;
    private error = { x: 0, y: 0 };
    private grounded = true;
    private dashing = false;
    private landedAt = -Infinity;
    private defeatedAt = -1;
    private seen = new Map<bigint, { x: number; y: number }>();

    preload() {
      const urls: string[] = [];
      const release = () => {
        for (const url of urls.splice(0)) URL.revokeObjectURL(url);
      };
      if (options.preloaded) {
        this.load.once("complete", release);
        this.events.once("shutdown", release);
      }
      this.load.on("loaderror", () => {
        this.unavailable = true;
        options.onError();
      });
      for (const art of images) {
        const bytes = options.preloaded?.get(art.id);
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
          options.onError();
          return;
        }
      }
      this.layers = layers.map(([id]) =>
        this.add.tileSprite(0, 0, view.width, RUN_VIEW.height, id).setOrigin(0),
      );
      this.terrain = new TerrainColumns(
        this,
        RUN_VIEW.maxHeight,
        options.rulesVersion >= RULES_V3.rulesVersion,
      );
      this.shadows = Array.from({ length: 24 }, () =>
        this.add.image(0, 0, "coin-shadow").setDepth(4).setVisible(false),
      );
      this.pickups = Array.from({ length: 48 }, () =>
        this.add.image(0, 0, "hazard-obstacle").setDepth(5).setVisible(false),
      );
      this.dust = new BurstPool(this, actions, 8, 6);
      this.sparkle = new BurstPool(this, actions, 8, 9);
      this.runner = this.add
        .image(0, 0, catSheet.id, 0)
        .setOrigin(catSheet.anchor.x / 48, catSheet.anchor.y / 48)
        .setDepth(7);
      this.auras = auras.map(([power, clip]) => [
        power,
        new Aura(this, powerSheet, clip, 8),
      ]);
      this.contact = new Aura(this, powerSheet, "shield-contact", 8);
      this.applyView();
      options.onReady();
    }

    private applyView() {
      this.applied = view;
      const { width, height, zoom } = view;
      this.cameras.main
        .setOrigin(0, 0)
        .setSize(width * zoom, height * zoom)
        .setZoom(zoom);
      for (const layer of this.layers)
        layer.setSize(width, RUN_VIEW.height).setY(height - RUN_VIEW.height);
    }

    override update(time: number, delta: number) {
      if (!this.runner || !this.terrain || this.unavailable) return;
      if (this.applied !== view) this.applyView();
      const world = options.world();
      const still = options.reduced();
      const { frame } = world;
      const playing = frame.phase === "active" && frame.activeTicks > 0n;
      const track = surfaces(world.entities);
      const shown = this.follow(world, track, playing, delta);
      const { width, height, zoom } = view;
      const snap = (value: number) => Math.round(value * zoom) / zoom;
      const hitbox = GAME_VIEW.hitboxWidth / 2;
      const left = snap(shown.x + hitbox - RUN_VIEW.runnerScreenX);
      const anchor = Number(world.worldOriginPixels % ANCHOR_PERIOD);
      const yOffset = RUN_VIEW.groundOffset + view.skyRows;
      this.layers.forEach((layer, i) => {
        layer.tilePositionX = snap((left + anchor) * (layers[i]?.[1] ?? 0));
      });
      this.terrain.draw(track, { left, anchor, width, height, yOffset, snap });
      this.drawEntities(world.entities, track, {
        left,
        yOffset,
        snap,
        time,
        still,
      });
      const runnerX = snap(shown.x + hitbox - left);
      const runnerY = snap(shown.y + GAME_VIEW.hitboxHeight + yOffset);
      this.drawRunner(
        world,
        playing,
        shown.x + anchor,
        runnerX,
        runnerY,
        time,
        still,
      );
      this.dust?.update(time);
      this.sparkle?.update(time);
      this.lastWorld = world;
    }

    // Extrapolates within the current tick, then hides reconciliation jumps by
    // easing the difference out instead of moving the runner backwards.
    private follow(
      world: WorldState,
      track: Surface[],
      playing: boolean,
      delta: number,
    ) {
      const r = world.frame.runner;
      const sample = options.sample();
      const t = playing ? Math.min(1, Math.max(0, sample.lead)) : 0;
      const x = px(r.xSubpixels + r.vxSubpixelsPerTick * t);
      let y = px(r.ySubpixels);
      if (r.grounded) {
        const center = GAME_VIEW.hitboxWidth / 2;
        const from = surfacePixels(track, px(r.xSubpixels) + center);
        const to = surfacePixels(track, x + center);
        if (from !== null && to !== null) y += to - from;
      } else {
        // The next tick adds gravity before moving, so this lands exactly on it.
        const gravity = RULES_V1.physics.gravitySubpixelsPerTickSquared;
        y = px(r.ySubpixels + (r.vySubpixelsPerTick + gravity) * t);
      }
      const T = Number(world.frame.activeTicks) + t;
      const last = this.motion;
      const shift = this.lastWorld
        ? Number(world.worldOriginPixels - this.lastWorld.worldOriginPixels)
        : 0;
      if (!playing || !last || T < last.t) this.error = { x: 0, y: 0 };
      else if (sample.revision !== last.revision) {
        const dt = T - last.t;
        const ex = last.x - shift + px(r.vxSubpixelsPerTick) * dt - x;
        const vy =
          r.vySubpixelsPerTick +
          RULES_V1.physics.gravitySubpixelsPerTickSquared;
        const ey = r.grounded ? 0 : last.y + px(vy) * dt - y;
        const far = Math.hypot(ex + this.error.x, ey + this.error.y) > 64;
        this.error = far
          ? { x: 0, y: 0 }
          : { x: this.error.x + ex, y: this.error.y + ey };
      }
      const decay = Math.exp(-delta / correctionMs);
      this.error = { x: this.error.x * decay, y: this.error.y * decay };
      this.motion = { x, y, t: T, revision: sample.revision };
      return { x: x + this.error.x, y: y + this.error.y };
    }

    private drawEntities(
      entities: readonly WorldEntity[],
      track: Surface[],
      at: {
        left: number;
        yOffset: number;
        snap: (v: number) => number;
        time: number;
        still: boolean;
      },
    ) {
      const { left, yOffset, snap, time, still } = at;
      let used = 0;
      let shadowed = 0;
      const present = new Set<bigint>();
      for (const entity of entities) {
        if (
          entity.consumed ||
          entity.kind === "ramp" ||
          entity.kind === "terrain"
        )
          continue;
        const cx = px(entity.xSubpixels + entity.widthSubpixels / 2);
        const x = snap(cx - left);
        if (x < -40 || x > view.width + 40) continue;
        const sprite = this.pickups[used++];
        if (!sprite) break;
        const cy = px(entity.ySubpixels + entity.heightSubpixels / 2) + yOffset;
        if (entity.kind !== "hazard") {
          present.add(entity.id);
          this.seen.set(entity.id, { x, y: cy });
        }
        if (entity.kind === "hazard") {
          sprite
            .setTexture("hazard-obstacle")
            .setOrigin(0.5, 1)
            .setPosition(
              x,
              snap(px(entity.ySubpixels + entity.heightSubpixels) + yOffset),
            );
        } else if (entity.kind === "coin") {
          const phase = Number(entity.id % 16n) * 62.5;
          sprite
            .setTexture("coin-spin", coinFrame(time + phase, still))
            .setOrigin(0.5, 15 / 32)
            .setPosition(x, snap(cy));
          const ground = surfacePixels(track, cx);
          const shadow = this.shadows[shadowed++];
          if (shadow && ground !== null)
            shadow.setPosition(x, snap(ground + yOffset)).setVisible(true);
        } else {
          const bob = still
            ? 0
            : Math.round(Math.sin(time / 320 + Number(entity.id % 7n)) * 2);
          const star = entity.kind === "star";
          const clip = starSheet.clips[0];
          const frame =
            star && clip && !still
              ? clip.start + (Math.floor((time * clip.fps) / 1000) % clip.count)
              : 0;
          if (star) sprite.setTexture("star", frame);
          else sprite.setTexture(boosters[entity.power]);
          sprite.setOrigin(0.5).setPosition(x, snap(cy + bob));
        }
        sprite.setVisible(true);
      }
      for (let i = used; i < this.pickups.length; i++)
        this.pickups[i]?.setVisible(false);
      for (let i = shadowed; i < this.shadows.length; i++)
        this.shadows[i]?.setVisible(false);
      for (const [id, spot] of this.seen) {
        if (present.has(id)) continue;
        this.seen.delete(id);
        // Collected pickups vanish next to the runner; scrolled-off ones do not.
        if (!still && Math.abs(spot.x - RUN_VIEW.runnerScreenX) < 72)
          this.sparkle?.spawn("pickup", spot.x, spot.y, time);
      }
    }

    private drawRunner(
      world: WorldState,
      playing: boolean,
      distance: number,
      x: number,
      y: number,
      time: number,
      still: boolean,
    ) {
      const runner = this.runner;
      if (!runner) return;
      const { frame } = world;
      const r = frame.runner;
      const ticks = frame.activeTicks;
      let pose = "idle";
      let index = 0;
      const loop = (name: string) => {
        const clip = catClips.get(name);
        return clip ? Math.floor((time * clip.fps) / 1000) % clip.count : 0;
      };
      if (frame.terminalReason === "crash") {
        if (this.defeatedAt < 0) {
          this.defeatedAt = time;
          if (!still) this.sparkle?.spawn("hit", x, y - 14, time);
        }
        const clip = catClips.get("defeat");
        pose = "defeat";
        index = clip
          ? Math.min(
              clip.count - 1,
              Math.floor(((time - this.defeatedAt) * clip.fps) / 1000),
            )
          : 0;
      } else if (!playing) {
        index = loop("idle");
      } else if (r.shieldContactEndsAtTick > ticks) {
        pose = "hit";
        index = loop("hit");
      } else if (r.dashEndsAtTick > ticks) {
        pose = "dash";
        index = loop("dash");
        if (!this.dashing && !still)
          this.dust?.spawn("dash", x - 18, y - 12, time);
      } else if (r.grounded) {
        if (!this.grounded) {
          this.landedAt = time;
          if (!still) this.dust?.spawn("landing", x, y - 16, time);
        }
        const landing = time - this.landedAt < LAND_MS;
        pose = landing ? "land" : "run";
        index = landing
          ? Math.min(1, Math.floor((time - this.landedAt) / (LAND_MS / 2)))
          : Math.floor(((distance % 8192) + 8192) / RUN_STRIDE_PX) % 8;
      } else {
        pose = r.vySubpixelsPerTick < 0 ? "jump" : "fall";
        index = loop(pose);
      }
      this.grounded = !playing || r.grounded;
      this.dashing = playing && r.dashEndsAtTick > ticks;
      const clip = catClips.get(pose);
      runner
        .setFrame((clip?.start ?? 0) + (still ? 0 : index))
        .setPosition(x, y);
      const centerY = y - GAME_VIEW.hitboxHeight / 2;
      for (const [power, aura] of this.auras) {
        const state = frame.powers[power];
        aura.show(
          playing && state.charges > 0 && ticks < state.endsAtTick,
          x,
          centerY,
          time,
          still,
        );
      }
      this.contact?.show(
        playing && r.shieldContactEndsAtTick > ticks,
        x,
        centerY,
        time,
        still,
      );
    }
  }

  const game = new engine.Game({
    type: engine.AUTO,
    parent,
    width: view.width * view.zoom,
    height: view.height * view.zoom,
    render: { pixelArt: true, antialias: false },
    scale: { mode: engine.Scale.FIT, autoCenter: engine.Scale.CENTER_BOTH },
    backgroundColor: "#3e95e6",
    scene: [RunScene],
  });
  const resize = new ResizeObserver(() => {
    const next = measure();
    if (
      next.width === view.width &&
      next.height === view.height &&
      next.zoom === view.zoom
    )
      return;
    view = next;
    game.scale.setGameSize(view.width * view.zoom, view.height * view.zoom);
  });
  resize.observe(parent);
  game.events.once("destroy", () => resize.disconnect());
  return game;
}
