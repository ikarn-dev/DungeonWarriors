import type Phaser from "phaser";

// The gas (2026-11-25): nothing shows while the timer runs (the HUD counts
// down). When it ends, luminous toxic-green gas rolls in from behind the warrior
// and fills the room. Soft puff particles grow, drift, turn slowly and fade
// over a darkening haze. World-space emitters, so the smoke stays where it
// forms. Under reduced motion only the haze appears, at once.
const PUFF = "gas-puff";
const HAZE = "gas-haze";
// Luminous toxic greens, not murky olive: the room stays visible through it.
const TINTS = [0x4f9a3a, 0x67b848, 0x86d05a, 0xa6e472, 0xc2f08e];
const HAZE_ALPHA = 0.38;
const HAZE_RISE_MS = 2400;

type View = { x: number; y: number; width: number; height: number };
// The haze is a screen layer; it is drawn larger than the screen so its
// edges never show while the camera zooms or moves (2026-11-26).
const HAZE_OVERSCAN = 1.4;

// A random-point zone over a world band that follows the camera: each new
// puff is placed around the current view plus a margin, while puffs already
// in the air stay where they formed. So the smog has no edge however the
// camera moves.
const MARGIN = 220;
function band(view: () => View, top: number, height: number) {
  return {
    type: "random",
    source: {
      getRandomPoint: (point: Phaser.Types.Math.Vector2Like) => {
        const v = view();
        point.x = v.x - MARGIN + Math.random() * (v.width + MARGIN * 2);
        point.y = top + Math.random() * height;
      },
    },
  };
}

// A lumpy white puff from overlapping soft blobs; tints give it colour.
function puffTexture(scene: Phaser.Scene) {
  if (scene.textures.exists(PUFF)) return;
  const texture = scene.textures.createCanvas(PUFF, 128, 128);
  if (!texture) return;
  const context = texture.getContext();
  const blobs: ReadonlyArray<readonly [number, number, number, number]> = [
    [64, 66, 50, 0.5],
    [42, 74, 30, 0.45],
    [86, 72, 32, 0.45],
    [56, 46, 28, 0.4],
    [80, 50, 26, 0.38],
    [64, 86, 34, 0.42],
    [34, 56, 20, 0.3],
    [96, 58, 20, 0.3],
  ];
  for (const [x, y, radius, alpha] of blobs) {
    const fill = context.createRadialGradient(x, y, 0, x, y, radius);
    fill.addColorStop(0, `rgba(255,255,255,${alpha})`);
    fill.addColorStop(0.6, `rgba(255,255,255,${alpha * 0.45})`);
    fill.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = fill;
    context.fillRect(0, 0, 128, 128);
  }
  texture.refresh();
}

// A vertical fade, clear at the top and dense at the floor.
function hazeTexture(scene: Phaser.Scene) {
  if (scene.textures.exists(HAZE)) return;
  const texture = scene.textures.createCanvas(HAZE, 4, 256);
  if (!texture) return;
  const context = texture.getContext();
  const fill = context.createLinearGradient(0, 0, 0, 256);
  fill.addColorStop(0, "rgba(255,255,255,0.2)");
  fill.addColorStop(0.55, "rgba(255,255,255,0.6)");
  fill.addColorStop(1, "rgba(255,255,255,1)");
  context.fillStyle = fill;
  context.fillRect(0, 0, 4, 256);
  texture.refresh();
}

const drift = {
  onEmit: () => Math.random() * 360,
  onUpdate: (
    _particle: Phaser.GameObjects.Particles.Particle,
    _key: string,
    _t: number,
    value: number,
  ) => value + 0.06,
};

export class GasSmog {
  private readonly haze: Phaser.GameObjects.Image;
  private emitters: Phaser.GameObjects.Particles.ParticleEmitter[] = [];
  private startedAt: number | null = null;
  private still = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly engine: typeof Phaser,
    private readonly depth: number,
  ) {
    puffTexture(scene);
    hazeTexture(scene);
    this.haze = scene.add
      .image(0, 0, HAZE)
      .setOrigin(0.5)
      .setTint(0x5ea83a)
      .setScrollFactor(0)
      .setDepth(depth)
      .setAlpha(0)
      .setVisible(false);
  }

  start(time: number, view: () => View, still: boolean) {
    if (this.startedAt !== null) return;
    this.startedAt = time;
    this.still = still;
    this.haze.setVisible(true);
    if (still) return;
    const floor = band(view, 600 * 0.6, 600 * 0.42);
    const air = band(view, 0, 600);
    // The first wave rolls in from just off the left of the view.
    const start = view();
    const behind = {
      type: "random",
      source: {
        getRandomPoint: (point: Phaser.Types.Math.Vector2Like) => {
          point.x = start.x - 160 + Math.random() * 100;
          point.y = 90 + Math.random() * 510;
        },
      },
    };
    const common = {
      tint: TINTS,
      rotate: drift,
      blendMode: this.engine.BlendModes.NORMAL,
    };
    this.emitters = [
      // The wave rolling in from behind, for the first seconds.
      this.scene.add.particles(0, 0, PUFF, {
        ...common,
        emitZone: behind,
        duration: 2600,
        frequency: 30,
        quantity: 2,
        lifespan: { min: 3200, max: 4600 },
        speedX: { min: 90, max: 170 },
        speedY: { min: -18, max: 10 },
        scale: { start: 1.4, end: 4.2, ease: "Sine.easeOut" },
        alpha: { values: [0, 0.42, 0.32, 0] },
      }),
      // Heavy smog that keeps welling up along the floor.
      this.scene.add.particles(0, 0, PUFF, {
        ...common,
        emitZone: floor,
        frequency: 55,
        quantity: 2,
        maxAliveParticles: 170,
        lifespan: { min: 2800, max: 4400 },
        speedX: { min: -24, max: 32 },
        speedY: { min: -26, max: -6 },
        scale: { start: 0.9, end: 3.4, ease: "Sine.easeOut" },
        alpha: { values: [0, 0.38, 0.3, 0] },
      }),
      // Slow billows that hang across the whole room.
      this.scene.add.particles(0, 0, PUFF, {
        ...common,
        emitZone: air,
        frequency: 140,
        maxAliveParticles: 45,
        lifespan: { min: 4200, max: 6000 },
        speedX: { min: -12, max: 14 },
        speedY: { min: -10, max: 4 },
        scale: { start: 2.2, end: 4.8 },
        alpha: { values: [0, 0.2, 0] },
      }),
      // Pale swirls that brighten what lies under them, so the gas glows.
      this.scene.add.particles(0, 0, PUFF, {
        emitZone: air,
        frequency: 220,
        maxAliveParticles: 24,
        lifespan: { min: 3000, max: 4600 },
        speedX: { min: -18, max: 18 },
        speedY: { min: -14, max: -2 },
        scale: { start: 1.4, end: 3.2 },
        alpha: { values: [0, 0.22, 0] },
        rotate: drift,
        tint: [0xd8ffa0, 0xeaffc0],
        blendMode: this.engine.BlendModes.SCREEN,
      }),
    ];
    this.emitters.forEach((emitter, i) => {
      emitter.setDepth(this.depth + 1 + i);
    });
  }

  // Keeps the haze centred on the screen. Screen layers (scroll factor 0)
  // still zoom about the camera centre, so the haze sits there and is sized
  // in world units with an overscan margin.
  update(time: number, camera: Phaser.Cameras.Scene2D.Camera) {
    if (this.startedAt === null) return;
    const rise = this.still
      ? 1
      : Math.min(1, (time - this.startedAt) / HAZE_RISE_MS);
    this.haze
      .setPosition(camera.width / 2, camera.height / 2)
      .setDisplaySize(
        (camera.width / camera.zoom) * HAZE_OVERSCAN,
        (camera.height / camera.zoom) * HAZE_OVERSCAN,
      )
      .setAlpha(HAZE_ALPHA * rise * (2 - rise));
  }
  reset() {
    this.startedAt = null;
    for (const emitter of this.emitters) emitter.destroy();
    this.emitters = [];
    this.haze.setAlpha(0).setVisible(false);
  }
}
