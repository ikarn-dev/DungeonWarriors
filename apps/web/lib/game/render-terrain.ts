import type Phaser from "phaser";
import { surfaceAt } from "./simulation-collision";
import type { WorldEntity } from "./simulation-state";

// Ground renders as 4 px columns, two art cells wide, so slopes step on the
// same pixel grid as the sprites. Stone is anchored to the world; the grass
// lip follows the walkable surface.
const COLUMN = 4;
const TILE = 32;
const BODY_KEY = "terrain-body";
const BODY_WIDTH = TILE * 2;
const GRASS_RISE = 2;
const mod = (value: number, size: number) => ((value % size) + size) % size;

export type Surface = Extract<WorldEntity, { kind: "ramp" | "terrain" }>;

export function surfaces(entities: readonly WorldEntity[]): Surface[] {
  return entities
    .filter(
      (entity): entity is Surface =>
        entity.kind === "ramp" || entity.kind === "terrain",
    )
    .sort((a, b) => a.xSubpixels - b.xSubpixels);
}

export function surfacePixels(track: readonly Surface[], xPixels: number) {
  const point = Math.round(xPixels * 256);
  const tile = track.find(
    (e) => point >= e.xSubpixels && point < e.xSubpixels + e.widthSubpixels,
  );
  const surface = tile ? surfaceAt(tile, point) : null;
  return surface === null ? null : surface / 256;
}

export class TerrainColumns {
  private body: Phaser.GameObjects.Image[] = [];
  private grass: Phaser.GameObjects.Image[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    maxHeight: number,
    private readonly floatingPlatforms: boolean,
  ) {
    const source = scene.textures.get("terrain-fill").getSourceImage();
    const canvas = scene.textures.createCanvas(
      BODY_KEY,
      BODY_WIDTH,
      maxHeight + TILE * 2,
    );
    if (
      !canvas ||
      !(
        source instanceof HTMLImageElement ||
        source instanceof HTMLCanvasElement
      )
    )
      throw new Error("ASSETS_NOT_READY");
    const context = canvas.getContext();
    context.imageSmoothingEnabled = false;
    for (let y = 0; y < canvas.height; y += TILE)
      for (let x = 0; x < BODY_WIDTH; x += TILE)
        context.drawImage(source, x, y, TILE, TILE);
    canvas.refresh();
  }

  private ensure(count: number) {
    while (this.body.length < count) {
      this.body.push(
        this.scene.add.image(0, 0, BODY_KEY).setOrigin(0).setDepth(2),
      );
      this.grass.push(
        this.scene.add.image(0, 0, "terrain-grass").setOrigin(0).setDepth(3),
      );
    }
  }

  draw(
    track: readonly Surface[],
    view: {
      left: number;
      anchor: number;
      width: number;
      height: number;
      yOffset: number;
      snap: (value: number) => number;
    },
  ) {
    const { left, anchor, width, height, yOffset, snap } = view;
    this.ensure(Math.ceil(width / COLUMN) + 2);
    let index = 0;
    let used = 0;
    const first = Math.floor((left + anchor) / COLUMN) * COLUMN - anchor;
    for (let x = first; x - left < width; x += COLUMN) {
      const body = this.body[used];
      const grass = this.grass[used];
      if (!body || !grass) break;
      const point = Math.round((x + COLUMN / 2) * 256);
      let tile = track[index];
      while (tile && tile.xSubpixels + tile.widthSubpixels <= point)
        tile = track[++index];
      const surface =
        tile && point >= tile.xSubpixels ? surfaceAt(tile, point) : null;
      if (!tile || surface === null) continue;
      used++;
      const worldY = Math.round(surface / 512) * 2;
      const y = worldY + yOffset;
      const screenX = snap(x - left);
      const absolute = Math.round(x + anchor);
      const bodyX = mod(absolute, BODY_WIDTH);
      const bodyY = mod(worldY, TILE);
      const underside = this.floatingPlatforms
        ? (tile.ySubpixels +
            tile.heightSubpixels +
            (tile.kind === "ramp" ? Math.max(0, tile.riseSubpixels) : 0)) /
            256 +
          yOffset
        : height + 1;
      body
        .setCrop(
          bodyX,
          bodyY,
          COLUMN,
          Math.max(0, Math.min(height + 1, underside) - y),
        )
        .setPosition(screenX - bodyX, y - bodyY)
        .setVisible(y < height);
      const grassX = mod(absolute, TILE);
      grass
        .setCrop(grassX, 0, COLUMN, 16)
        .setPosition(screenX - grassX, y - GRASS_RISE)
        .setVisible(y - GRASS_RISE < height);
    }
    for (let i = used; i < this.body.length; i++) {
      this.body[i]?.setVisible(false);
      this.grass[i]?.setVisible(false);
    }
  }
}
