import type Phaser from "phaser";
import { noise, TORCH_Y, torchSpots } from "./render-walls";
import type { DungeonRoom } from "./rooms";

// Torch flames (2026-11-26): each flame is a column of 3 px pixels whose
// width tapers to a tip, coloured white-hot at the base through yellow and
// orange to a red tip. Every frame the height breathes, the rows sway in a
// travelling wave and the odd spark breaks off the top. The light on the
// wall is a soft additive falloff with no edge, flickering with the flame.
// Under reduced motion each flame holds one still frame.
const GLOW = "torch-glow";
const CELL = 3;
const ROWS = 11;
const COLORS = [0xd9431f, 0xff8a3d, 0xffc04d, 0xffe48a, 0xfff6d6] as const;

function glowTexture(scene: Phaser.Scene) {
  if (scene.textures.exists(GLOW)) return;
  const texture = scene.textures.createCanvas(GLOW, 128, 128);
  if (!texture) return;
  const context = texture.getContext();
  const fill = context.createRadialGradient(64, 64, 0, 64, 64, 64);
  fill.addColorStop(0, "rgba(255,190,110,0.55)");
  fill.addColorStop(0.35, "rgba(255,150,70,0.22)");
  fill.addColorStop(0.7, "rgba(255,120,50,0.06)");
  fill.addColorStop(1, "rgba(255,120,50,0)");
  context.fillStyle = fill;
  context.fillRect(0, 0, 128, 128);
  texture.refresh();
}

export class Torches {
  private readonly g: Phaser.GameObjects.Graphics;
  private glows: Phaser.GameObjects.Image[] = [];
  private spots: number[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly engine: typeof Phaser,
    private readonly depth: number,
  ) {
    glowTexture(scene);
    this.g = scene.add.graphics().setDepth(depth + 1);
  }

  build(room: DungeonRoom) {
    for (const glow of this.glows) glow.destroy();
    this.spots = torchSpots(room);
    this.glows = this.spots.map((x) =>
      this.scene.add
        .image(x, TORCH_Y - 14, GLOW)
        .setBlendMode(this.engine.BlendModes.ADD)
        .setDepth(this.depth),
    );
  }

  update(time: number, still: boolean, view: Phaser.Geom.Rectangle) {
    const g = this.g;
    g.clear();
    this.spots.forEach((x, i) => {
      const glow = this.glows[i];
      if (x < view.x - 160 || x > view.right + 160) {
        glow?.setVisible(false);
        return;
      }
      const t = still ? 0 : time + i * 311;
      const flicker = still
        ? 0.5
        : 0.5 + 0.3 * Math.sin(t / 73) + 0.2 * Math.sin(t / 37 + 1.3);
      glow
        ?.setVisible(true)
        .setDisplaySize(220 + 24 * flicker, 250 + 30 * flicker)
        .setAlpha(0.7 + 0.3 * flicker);
      drawFlame(g, x, TORCH_Y - 3, t, flicker, i);
    });
  }
}

function drawFlame(
  g: Phaser.GameObjects.Graphics,
  x: number,
  base: number,
  t: number,
  flicker: number,
  seed: number,
) {
  const rows = ROWS - 1 + Math.round(flicker * 2);
  for (let r = 0; r < rows; r++) {
    const up = r / (rows - 1);
    // Wider at the base, a narrow tip; the wave grows toward the top.
    const half = 0.6 + 2.2 * (1 - up) ** 0.85;
    const sway =
      (Math.sin(t / 95 - r * 0.75) * 0.9 + Math.sin(t / 210 + seed) * 0.5) * up;
    for (let c = -3; c <= 3; c++) {
      const d = Math.abs(c - sway) / half;
      if (d > 1) continue;
      const heat = (1 - up) * 0.75 + (1 - d) * 0.45;
      const color =
        COLORS[Math.max(0, Math.min(4, Math.floor(heat * 4.4 - 0.4)))] ??
        0xd9431f;
      g.fillStyle(color, up > 0.85 ? 0.7 : 1);
      g.fillRect(x + c * CELL - CELL / 2, base - (r + 1) * CELL, CELL, CELL);
    }
  }
  // A spark breaks off the tip now and then and rises as it fades.
  const bucket = Math.floor(t / 420);
  const age = (t % 420) / 420;
  if (noise(seed, bucket, 5) > 0.55) {
    const sx = x + Math.round((noise(seed, bucket, 7) - 0.5) * 4) * CELL;
    g.fillStyle(0xffc04d, 1 - age);
    g.fillRect(sx - 1, base - (rows + 1 + age * 6) * CELL, 2, 2);
  }
}
