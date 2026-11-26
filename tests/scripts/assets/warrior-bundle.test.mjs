import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../../../", import.meta.url);
test("all bundled gameplay SVGs match the generated manifest and public files", () => {
  const { manifest, images } = JSON.parse(
    readFileSync(new URL("apps/web/lib/dungeon/artwork-data.json", root)),
  );
  const expected = manifest.assets;
  // Eight rig parts per cat, four weapons, four foes and 15 foe rig parts.
  assert.equal(expected.length, 55);
  assert.deepEqual(
    Object.keys(images).sort(),
    expected.map((a) => a.id).sort(),
  );
  for (const asset of expected) {
    const svg = images[asset.id];
    assert.equal(Buffer.byteLength(svg), asset.bytes, asset.id);
    assert.equal(
      createHash("sha256").update(svg).digest("hex"),
      asset.sha256,
      asset.id,
    );
    assert.equal(
      svg,
      readFileSync(new URL(`apps/web/public${asset.path}`, root), "utf8"),
    );
  }
});
test("production artwork generation rejects stale files and bundled data", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/assets/build-warrior-art.mjs", "--check"],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
});
