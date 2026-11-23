import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  assetManifestBytes,
  FIRST_SCENE_ASSETS,
  type ImageAsset,
  missingSceneAssets,
  parseAssetManifest,
  verifyManifestBinding,
} from "../../../../../apps/web/lib/game/assets.ts";
import {
  coinFrame,
  coinPlacement,
  fitGameViewport,
  GAME_VIEW,
  logicalPointer,
  UI_TOKENS,
} from "../../../../../apps/web/lib/game/presentation";
import { renderRun } from "../../../../../apps/web/lib/game/render-run";
import {
  type Surface,
  surfacePixels,
  TerrainColumns,
} from "../../../../../apps/web/lib/game/render-terrain";

it("registers all bound cat and coin frames under the keys loaded by the scene", () => {
  const bound = parseAssetManifest(
    JSON.parse(
      readFileSync(
        new URL(
          "../../../../../apps/web/public/game-assets/v2/manifest.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ),
  );
  const loaded = new Map<string, string>();
  const frames = new Map<string, number>();
  const drawing = new Error("textures ready for drawing");
  class Scene {
    load = {
      on: vi.fn(),
      svg: (key: string, path: string) => loaded.set(key, path),
    };
    textures = {
      get: (key: string) => {
        expect(loaded.has(key)).toBe(true);
        return key;
      },
      addSpriteSheet: (
        alias: string,
        key: string,
        { endFrame }: { endFrame: number },
      ) => {
        expect(alias).toBe("");
        frames.set(key, endFrame + 1);
        return { has: (frame: string) => Number(frame) <= endFrame };
      },
    };
    add = {
      tileSprite: () => {
        throw drawing;
      },
    };
  }
  const onError = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  class Game {
    events = { once: vi.fn() };
    scale = { setGameSize: vi.fn() };
    constructor({
      scene: [RunScene],
    }: {
      scene: [
        new () => Scene & {
          preload(): void;
          create(): void;
        },
      ];
    }) {
      const scene = new RunScene();
      scene.preload();
      expect(() => scene.create()).toThrow(drawing);
    }
  }
  renderRun(
    { Scene, Game, Scale: {} } as unknown as Parameters<typeof renderRun>[0],
    {
      getBoundingClientRect: () => ({ width: 1280, height: 720 }),
    } as unknown as HTMLElement,
    bound,
    "acrobat",
    {
      rulesVersion: 1,
      world: () => {
        throw new Error("No world requested during preload");
      },
      sample: () => ({ lead: 0, revision: 0 }),
      reduced: () => false,
      onError,
      onReady: vi.fn(),
    },
  );
  vi.unstubAllGlobals();
  expect([...frames]).toEqual([
    ["cat-acrobat", 26],
    ["coin-spin", 16],
    ["effects-actions", 24],
    ["effects-powers", 30],
    ["star", 4],
  ]);
  expect(onError).not.toHaveBeenCalled();
});

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
    new TerrainColumns(scene, 240, true).draw(track, {
      left: 0,
      anchor: 0,
      width: 260,
      height: 240,
      yOffset: 0,
      snap: Math.round,
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

function image(id = "coin-spin"): ImageAsset {
  return {
    id,
    path: `/game-assets/v1/${id}.png`,
    sha256: "a".repeat(64),
    bytes: 100,
    width: 512,
    height: 32,
    frameWidth: 32,
    frameHeight: 32,
    frames: 16,
    anchor: { x: 16, y: 28 },
    repeat: "none",
    reducedMotionFrame: 0,
    clips: [{ name: "spin", start: 0, count: 16, fps: 16, loop: true }],
  };
}
const manifest = () => ({ schemaVersion: 1, version: 1, assets: [image()] });
describe("versioned asset contract", () => {
  it("pins coin spin dimensions, pivots, complete loops and reduced motion frame", () => {
    expect(parseAssetManifest(manifest()).assets[0]?.frames).toBe(16);
    for (const change of [
      { width: 1024 },
      { frames: 15 },
      { anchor: { x: 16, y: 16 } },
      { reducedMotionFrame: 1 },
      { clips: [] },
    ])
      expect(() =>
        parseAssetManifest({
          ...manifest(),
          assets: [{ ...image(), ...change }],
        }),
      ).toThrow();
    for (const change of [{ fps: 12 }, { count: 15 }, { loop: false }])
      expect(() =>
        parseAssetManifest({
          ...manifest(),
          assets: [{ ...image(), clips: [{ ...image().clips[0], ...change }] }],
        }),
      ).toThrow();
  });
  it("rejects traversal, foreign versions, external URLs, unknown fields, duplicates and unsorted IDs", () => {
    for (const path of [
      "/game-assets/v2/coin.png",
      "/game-assets/v1/../secret.png",
      "https://example.com/coin.png",
      "/game-assets/v1/coin.png?q=1",
      "/game-assets/v1/%2e%2e/coin.png",
    ])
      expect(() =>
        parseAssetManifest({ ...manifest(), assets: [{ ...image(), path }] }),
      ).toThrow();
    expect(() =>
      parseAssetManifest({ ...manifest(), assets: [image(), image()] }),
    ).toThrow();
    expect(() =>
      parseAssetManifest({ ...manifest(), assets: [image("z"), image("a")] }),
    ).toThrow();
    expect(() =>
      parseAssetManifest({ ...manifest(), earnedCoins: 100 }),
    ).toThrow();
  });
  it("hashes canonical metadata and refuses to call partial media ready", async () => {
    const m = manifest();
    const reordered = { assets: m.assets, version: 1, schemaVersion: 1 };
    expect(assetManifestBytes(m)).toEqual(assetManifestBytes(reordered));
    const contentHash = createHash("sha256")
      .update(assetManifestBytes(m))
      .digest("hex");
    await expect(
      verifyManifestBinding(m, { version: 1, contentHash }),
    ).rejects.toThrow("ASSETS_NOT_READY");
    expect(missingSceneAssets(parseAssetManifest(m))).toHaveLength(
      FIRST_SCENE_ASSETS.length - 1,
    );
  });
  it("accepts a complete matching manifest binding and rejects a changed version or hash", async () => {
    const assets = FIRST_SCENE_ASSETS.map((id) => {
      const a = image(id);
      let names: string[] = [];
      if (id.startsWith("cat-")) {
        Object.assign(a, {
          width: 48,
          height: 48,
          frameWidth: 48,
          frameHeight: 48,
          frames: 1,
          anchor: { x: 24, y: 40 },
        });
        names = ["idle", "run", "jump", "fall", "dash", "hit", "defeat"];
      }
      if (id.startsWith("background-"))
        Object.assign(a, {
          width: 960,
          height: 540,
          frameWidth: 960,
          frameHeight: 540,
          frames: 1,
          repeat: "x",
        });
      if (id === "coin-shadow")
        Object.assign(a, {
          width: 16,
          height: 6,
          frameWidth: 16,
          frameHeight: 6,
          frames: 1,
          anchor: { x: 8, y: 3 },
        });
      if (id === "effects-actions")
        names = ["dash", "hit", "landing", "pickup"];
      if (id === "effects-powers")
        names = [
          "double-jump",
          "extra-dash",
          "magnet",
          "shield-active",
          "shield-contact",
        ];
      if (id === "hud-controls")
        names = [
          "boost",
          "cash-out",
          "dash",
          "double-jump",
          "extra-dash",
          "jump",
          "magnet",
          "mute",
          "pause",
          "rotate-device",
          "shield",
          "sound",
          "status",
        ];
      if (names.length > 0)
        a.clips = names
          .sort()
          .map((name) => ({ name, start: 0, count: 1, fps: 1, loop: false }));
      else if (id !== "coin-spin") a.clips = [];
      return a;
    });
    const m = { schemaVersion: 1, version: 1, assets };
    const contentHash = createHash("sha256")
      .update(assetManifestBytes(m))
      .digest("hex");
    expect(
      (await verifyManifestBinding(m, { version: 1, contentHash })).version,
    ).toBe(1);
    await expect(
      verifyManifestBinding(m, { version: 2, contentHash }),
    ).rejects.toThrow();
    await expect(
      verifyManifestBinding(m, { version: 1, contentHash: "0".repeat(64) }),
    ).rejects.toThrow();
  });
});
describe("presentation boundaries", () => {
  it("contains and centers the 960x540 canvas at integer device-pixel scales", () => {
    for (const [w, h, dpr] of [
      [1920, 1080, 1],
      [1280, 720, 2],
      [844, 390, 3],
      [768, 1024, 2],
      [375, 667, 3],
    ]) {
      if (w === undefined || h === undefined || dpr === undefined)
        throw new Error("fixture");
      const v = fitGameViewport(w, h, dpr);
      expect(v.width).toBeLessThanOrEqual(w);
      expect(v.height).toBeLessThanOrEqual(h);
      expect(v.width / v.height).toBeCloseTo(16 / 9);
      expect(v.scale * dpr).toBeCloseTo(Math.round(v.scale * dpr));
      expect(v.left * dpr).toBeCloseTo(Math.round(v.left * dpr));
      expect(v.top * dpr).toBeCloseTo(Math.round(v.top * dpr));
      const pointer = logicalPointer(
        v.left + v.width / 2,
        v.top + v.height / 2,
        v,
      );
      expect(pointer?.x).toBeCloseTo(480);
      expect(pointer?.y).toBeCloseTo(270);
    }
    expect(fitGameViewport(375, 667, 3).gameplayAllowed).toBe(false);
    expect(GAME_VIEW.emergencyCashOutDuringPortrait).toBe(true);
  });
  it("handles tiny viewports, letterboxes and malformed coordinates", () => {
    const v = fitGameViewport(200, 100, 1);
    expect(v.pixelAligned).toBe(false);
    expect(v.width).toBeLessThanOrEqual(200);
    expect(logicalPointer(-1, -1, v)).toBeNull();
    expect(logicalPointer(Number.NaN, 0, v)).toBeNull();
    for (const n of [0, -1, Infinity, NaN])
      expect(() => fitGameViewport(n, 540, 1)).toThrow();
    expect(UI_TOKENS.touchTargetCssPixels).toBeGreaterThanOrEqual(44);
    expect(GAME_VIEW.hitboxWidth).toBe(24);
    expect(GAME_VIEW.hitboxHeight).toBe(28);
  });
  it("keeps the coin upright, its shadow on the ramp and collision independent of spin", () => {
    expect(
      Array.from({ length: 16 }, (_, n) => coinFrame(n * 62.5, false)),
    ).toEqual(Array.from({ length: 16 }, (_, n) => n));
    expect(coinFrame(1000, false)).toBe(0);
    expect(coinFrame(555, true)).toBe(0);
    const placement = coinPlacement(300, -40, 160, 12);
    expect(placement.coinY).toBe(288);
    expect(placement.shadowY).toBe(300);
    expect(placement.coinRotation).toBe(0);
    expect(placement.shadowRotation).toBeCloseTo(Math.atan2(-40, 160));
    expect(() => coinPlacement(0, 0, 0, 0)).toThrow();
  });
});
