import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { checkGameAssets } from "../../../scripts/assets/check-assets.mjs";

const webRequire = createRequire(
  new URL("../../../apps/web/package.json", import.meta.url),
);
const sharp = createRequire(webRequire.resolve("next"))("sharp");
const parent = fileURLToPath(new URL("../../.artifacts/", import.meta.url));
mkdirSync(parent, { recursive: true });
async function fixture(work) {
  const root = mkdtempSync(join(parent, "asset-check-"));
  try {
    const folder = join(root, "game-assets/v1");
    mkdirSync(folder, { recursive: true });
    const data = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .png()
      .toBuffer();
    const image = {
      id: "sample",
      path: "/game-assets/v1/sample.png",
      sha256: createHash("sha256").update(data).digest("hex"),
      bytes: data.length,
      width: 2,
      height: 2,
      frameWidth: 2,
      frameHeight: 2,
      frames: 1,
      anchor: { x: 1, y: 1 },
      repeat: "none",
      reducedMotionFrame: 0,
      clips: [],
    };
    const save = () => {
      writeFileSync(join(folder, "sample.png"), data);
      writeFileSync(
        join(folder, "manifest.json"),
        JSON.stringify({ schemaVersion: 1, version: 1, assets: [image] }),
      );
    };
    save();
    await work({ root, folder, data, image, save });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
test("a version without a manifest leaves the scene pending", async () => {
  const result = await checkGameAssets(
    fileURLToPath(new URL("../../../apps/web/public", import.meta.url)),
    2,
  );
  assert.equal(result.ready, false);
  assert.equal(result.reason, "USER_ASSETS_PENDING");
  assert.ok(result.missing.includes("coin-spin"));
});
test("all first scene SVGs are valid and bound by the bundled manifest", async () => {
  const result = await checkGameAssets(
    fileURLToPath(new URL("../../../apps/web/public", import.meta.url)),
    1,
  );
  assert.equal(result.ready, true);
  assert.equal(result.checkedFiles, 37);
});
test("active SVG content is rejected even when its digest matches", async () =>
  fixture(async ({ root, folder, image, save }) => {
    const vector =
      '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2" onload="alert(1)"><rect width="2" height="2"/></svg>';
    image.path = "/game-assets/v1/sample.svg";
    image.bytes = Buffer.byteLength(vector);
    image.sha256 = createHash("sha256").update(vector).digest("hex");
    save();
    writeFileSync(join(folder, "sample.svg"), vector);
    await assert.rejects(checkGameAssets(root, 1), /UNSAFE_ASSET_SVG/);
  }));
test("decodes real PNG bytes and returns a bound partial manifest without claiming ready", async () =>
  fixture(async ({ root }) => {
    const result = await checkGameAssets(root, 1);
    assert.equal(result.ready, false);
    assert.equal(result.checkedFiles, 1);
    assert.match(result.binding.contentHash, /^[0-9a-f]{64}$/);
  }));
test("rejects changed bytes, wrong dimensions and corrupt PNG with a matching hash", async () =>
  fixture(async ({ root, folder, image, save }) => {
    image.width = 4;
    image.frameWidth = 4;
    save();
    await assert.rejects(checkGameAssets(root, 1), /ASSET_IMAGE_MISMATCH/);
    image.width = 2;
    image.frameWidth = 2;
    writeFileSync(join(folder, "sample.png"), "broken");
    await assert.rejects(checkGameAssets(root, 1), /ASSET_SIZE_MISMATCH/);
    save();
    image.sha256 = "0".repeat(64);
    save();
    await assert.rejects(checkGameAssets(root, 1), /ASSET_HASH_MISMATCH/);
    image.bytes = 4;
    image.sha256 = createHash("sha256").update("oops").digest("hex");
    save();
    writeFileSync(join(folder, "sample.png"), "oops");
    await assert.rejects(checkGameAssets(root, 1));
  }));
test("rejects files symlinked outside the public root", async () =>
  fixture(async ({ root, folder, data }) => {
    const outside = join(parent, "outside-asset.png");
    writeFileSync(outside, data);
    try {
      rmSync(join(folder, "sample.png"));
      symlinkSync(outside, join(folder, "sample.png"));
      await assert.rejects(checkGameAssets(root, 1), /ASSET_PATH_ESCAPE/);
    } finally {
      rmSync(outside);
    }
  }));
