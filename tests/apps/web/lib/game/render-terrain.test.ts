import { expect, it, vi } from "vitest";
import {
  type Surface,
  surfacePixels,
  TerrainColumns,
} from "../../../../../apps/web/lib/game/render-terrain";

it("draws v3 platform edges and undersides without filling the gap", () => {
  const draw = vi.fn();
  const shade = {
    clear: vi.fn(),
    fillStyle: vi.fn(),
    fillRect: draw,
    setDepth: () => shade,
  };
  const image = {
    setOrigin: () => image,
    setDepth: () => image,
    setCrop: () => image,
    setPosition: () => image,
    setVisible: () => image,
  };
  class ImageSource {}
  const scene = {
    add: { image: () => image, graphics: () => shade },
    textures: {
      get: () => ({ getSourceImage: () => new ImageSource() }),
      createCanvas: () => ({
        height: 32,
        getContext: () => ({ drawImage: vi.fn() }),
        refresh: vi.fn(),
      }),
    },
  } as unknown as ConstructorParameters<typeof TerrainColumns>[0];
  const ramp: Surface = {
    id: 1n,
    kind: "ramp",
    xSubpixels: 0,
    ySubpixels: 100 * 256,
    widthSubpixels: 88 * 256,
    heightSubpixels: 28 * 256,
    riseSubpixels: -12 * 256,
    designatedCoin: null,
    designatedCheckpoint: 0n,
    consumed: false,
  };
  const track: Surface[] = [
    ramp,
    {
      ...ramp,
      id: 2n,
      xSubpixels: 128 * 256,
      ySubpixels: 88 * 256,
      riseSubpixels: 12 * 256,
    },
  ];
  vi.stubGlobal("HTMLImageElement", ImageSource);
  try {
    new TerrainColumns(scene, 240, "platforms").draw(track, {
      left: 0,
      anchor: 0,
      width: 260,
      height: 240,
      yOffset: 0,
      snap: Math.round,
      time: 0,
      still: true,
    });
  } finally {
    vi.unstubAllGlobals();
  }
  expect(surfacePixels(track, 100)).toBeNull();
  expect(draw).toHaveBeenCalledWith(84, 88, 4, 40);
  expect(draw).toHaveBeenCalledWith(128, 88, 4, 40);
  expect(
    draw.mock.calls.every(([x, , width]) => x + width <= 88 || x >= 128),
  ).toBe(true);
});

it("fills v4 slopes to the screen bottom, leaves pits open and animates their water", () => {
  class Column {
    x = 0;
    y = 0;
    visible = false;
    crop = { x: 0, y: 0, width: 0, height: 0 };
    setOrigin() {
      return this;
    }
    setDepth() {
      return this;
    }
    setCrop(x: number, y: number, width: number, height: number) {
      this.crop = { x, y, width, height };
      return this;
    }
    setPosition(x: number, y: number) {
      this.x = x;
      this.y = y;
      return this;
    }
    setVisible(visible: boolean) {
      this.visible = visible;
      return this;
    }
  }
  const columns: Column[] = [];
  const shade = {
    clear: vi.fn(),
    fillStyle: vi.fn(),
    fillRect: vi.fn(),
    setDepth: () => shade,
  };
  const water = {
    tilePositionX: 0,
    setOrigin: () => water,
    setDepth: () => water,
    setFrame: vi.fn(),
    setSize: vi.fn(),
    setY: vi.fn(),
  };
  class ImageSource {}
  const scene = {
    add: {
      image: (_x: number, _y: number, key: string) => {
        const column = new Column();
        if (key === "terrain-body") columns.push(column);
        return column;
      },
      graphics: () => shade,
      tileSprite: () => water,
    },
    textures: {
      get: () => ({ getSourceImage: () => new ImageSource() }),
      createCanvas: () => ({
        height: 304,
        getContext: () => ({ drawImage: vi.fn() }),
        refresh: vi.fn(),
      }),
    },
  } as unknown as ConstructorParameters<typeof TerrainColumns>[0];
  const track: Surface[] = [
    {
      id: 1n,
      kind: "ramp",
      xSubpixels: 0,
      ySubpixels: 100 * 256,
      widthSubpixels: 88 * 256,
      heightSubpixels: 28 * 256,
      riseSubpixels: -12 * 256,
      designatedCoin: null,
      designatedCheckpoint: 0n,
      consumed: false,
    },
    {
      id: 2n,
      kind: "ramp",
      xSubpixels: 128 * 256,
      ySubpixels: 88 * 256,
      widthSubpixels: 128 * 256,
      heightSubpixels: 28 * 256,
      riseSubpixels: 12 * 256,
      designatedCoin: null,
      designatedCheckpoint: 0n,
      consumed: false,
    },
  ];
  vi.stubGlobal("HTMLImageElement", ImageSource);
  try {
    const terrain = new TerrainColumns(scene, 240, "course", {
      name: "wave",
      start: 0,
      count: 4,
      fps: 4,
      loop: true,
    });
    const view = {
      left: 0,
      anchor: 0,
      width: 256,
      height: 240,
      yOffset: 0,
      snap: Math.round,
      time: 750,
      still: false,
    };
    terrain.draw(track, view);
    const visible = columns.filter((column) => column.visible);
    expect(visible.length).toBeGreaterThan(0);
    for (const column of visible) {
      const x = column.x + column.crop.x;
      expect(x + column.crop.width <= 88 || x >= 128).toBe(true);
      expect(column.y + column.crop.y + column.crop.height).toBe(241);
    }
    const tops = new Set(visible.map((column) => column.y + column.crop.y));
    expect(tops.size).toBeGreaterThan(1);
    expect(shade.fillRect).toHaveBeenCalledWith(84, 88, 4, 152);
    expect(shade.fillRect).toHaveBeenCalledWith(128, 88, 4, 152);
    expect(water.setY).toHaveBeenCalledWith(216);
    expect(water.setFrame).toHaveBeenLastCalledWith(3);
    terrain.draw(track, { ...view, still: true });
    expect(water.setFrame).toHaveBeenLastCalledWith(0);
  } finally {
    vi.unstubAllGlobals();
  }
});
