import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  assetManifestBytes,
  FIRST_SCENE_ASSETS,
  type ImageAsset,
  missingSceneAssets,
  parseAssetManifest,
  verifyManifestBinding,
} from "../../../../../apps/web/lib/game/assets.ts";

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
