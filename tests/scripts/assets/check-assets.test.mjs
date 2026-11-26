import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  catalogManifestBinding,
  checkGameAssets,
} from "../../../scripts/assets/check-assets.mjs";

const webRequire = createRequire(
  new URL("../../../apps/web/package.json", import.meta.url),
);
const sharp = createRequire(webRequire.resolve("next"))("sharp");
const parent = fileURLToPath(new URL("../../.artifacts/", import.meta.url));
mkdirSync(parent, { recursive: true });
async function fixture(work) {
  const root = mkdtempSync(join(parent, "asset-check-"));
  try {
    const folder = join(root, "game-assets");
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
      path: "/game-assets/sample.png",
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
        JSON.stringify({ schemaVersion: 1, version: 3, assets: [image] }),
      );
    };
    save();
    await work({ root, folder, data, image, save });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
test("a folder without a manifest leaves the scene pending", async () => {
  const root = mkdtempSync(join(parent, "asset-empty-"));
  try {
    const result = await checkGameAssets(root);
    assert.equal(result.ready, false);
    assert.equal(result.reason, "USER_ASSETS_PENDING");
    assert.ok(result.missing.includes("enemy-warden-axe"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("catalog manifests preserve the active v1 and staged v2 bindings", () => {
  const publicDirectory = fileURLToPath(
    new URL("../../../apps/web/public", import.meta.url),
  );
  assert.deepEqual(catalogManifestBinding(publicDirectory, 2), {
    version: 2,
    contentHash:
      "de6abd09a8057b1f768cc361aae2e7287f23f8026e00f56d1a4bf87e22f4fb9b",
  });
  assert.deepEqual(catalogManifestBinding(publicDirectory, 1), {
    version: 1,
    contentHash:
      "29d00d80ea5b0338943ead4345ab31b363243f83c863a600d0a960cab65c5786",
  });
});
test("active SVG content is rejected even when its digest matches", async () =>
  fixture(async ({ root, folder, image, save }) => {
    const vector =
      '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2" onload="alert(1)"><rect width="2" height="2"/></svg>';
    image.path = "/game-assets/sample.svg";
    image.bytes = Buffer.byteLength(vector);
    image.sha256 = createHash("sha256").update(vector).digest("hex");
    save();
    writeFileSync(join(folder, "sample.svg"), vector);
    await assert.rejects(checkGameAssets(root), /UNSAFE_ASSET_SVG/);
  }));
test("decodes real PNG bytes and returns a bound partial manifest without claiming ready", async () =>
  fixture(async ({ root }) => {
    const result = await checkGameAssets(root);
    assert.equal(result.ready, false);
    assert.equal(result.checkedFiles, 1);
    assert.match(result.binding.contentHash, /^[0-9a-f]{64}$/);
  }));
test("rejects changed bytes, wrong dimensions and corrupt PNG with a matching hash", async () =>
  fixture(async ({ root, folder, image, save }) => {
    image.width = 4;
    image.frameWidth = 4;
    save();
    await assert.rejects(checkGameAssets(root), /ASSET_IMAGE_MISMATCH/);
    image.width = 2;
    image.frameWidth = 2;
    writeFileSync(join(folder, "sample.png"), "broken");
    await assert.rejects(checkGameAssets(root), /ASSET_SIZE_MISMATCH/);
    save();
    image.sha256 = "0".repeat(64);
    save();
    await assert.rejects(checkGameAssets(root), /ASSET_HASH_MISMATCH/);
    image.bytes = 4;
    image.sha256 = createHash("sha256").update("oops").digest("hex");
    save();
    writeFileSync(join(folder, "sample.png"), "oops");
    await assert.rejects(checkGameAssets(root));
  }));
test("rejects files symlinked outside the public root", async () =>
  fixture(async ({ root, folder, data }) => {
    const outside = join(parent, "outside-asset.png");
    writeFileSync(outside, data);
    try {
      rmSync(join(folder, "sample.png"));
      symlinkSync(outside, join(folder, "sample.png"));
      await assert.rejects(checkGameAssets(root), /ASSET_PATH_ESCAPE/);
    } finally {
      rmSync(outside);
    }
  }));

test("the complete warrior pack is ready without legacy runner dependencies", async () => {
  const root = fileURLToPath(
    new URL("../../../apps/web/public/", import.meta.url),
  );
  const result = await checkGameAssets(root);
  assert.equal(result.ready, true);
  const manifest = JSON.parse(
    readFileSync(join(root, "game-assets/manifest.json"), "utf8"),
  );
  assert.equal(result.checkedFiles, manifest.assets.length);
  assert.deepEqual(result.missing, []);
});
