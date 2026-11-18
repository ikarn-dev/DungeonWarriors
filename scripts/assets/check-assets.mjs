import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assetManifestBytes,
  FIRST_SCENE_ASSETS,
  missingSceneAssets,
  parseAssetManifest,
} from "../../apps/web/lib/game/assets.mts";

const webRequire = createRequire(
  new URL("../../apps/web/package.json", import.meta.url),
);
// Reuse Next's installed image decoder; no extra package or local server.
const sharp = createRequire(webRequire.resolve("next"))("sharp");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
export async function checkGameAssets(publicDirectory, version) {
  if (!Number.isInteger(version) || version < 1 || version > 0xffffffff)
    throw new Error("INVALID_ASSET_VERSION");
  const root = realpathSync(publicDirectory);
  const candidate = join(root, `game-assets/v${version}/manifest.json`);
  if (!existsSync(candidate))
    return {
      ready: false,
      reason: "USER_ASSETS_PENDING",
      missing: [...FIRST_SCENE_ASSETS],
    };
  const inside = (path) => {
    const actual = realpathSync(path);
    if (!actual.startsWith(root + sep)) throw new Error("ASSET_PATH_ESCAPE");
    return actual;
  };
  const file = inside(candidate);
  if (statSync(file).size > 256 * 1024) throw new Error("MANIFEST_TOO_LARGE");
  const manifest = parseAssetManifest(JSON.parse(readFileSync(file, "utf8")));
  if (manifest.version !== version) throw new Error("ASSET_VERSION_MISMATCH");
  for (const asset of manifest.assets) {
    const path = inside(join(root, asset.path.slice(1)));
    const stat = statSync(path);
    if (!stat.isFile() || stat.size !== asset.bytes)
      throw new Error(`ASSET_SIZE_MISMATCH:${asset.id}`);
    const data = readFileSync(path);
    if (hash(data) !== asset.sha256)
      throw new Error(`ASSET_HASH_MISMATCH:${asset.id}`);
    const image = sharp(data, {
      limitInputPixels: 4096 * 4096,
      failOn: "warning",
    });
    const metadata = await image.metadata();
    if (
      metadata.format !== "png" ||
      metadata.width !== asset.width ||
      metadata.height !== asset.height ||
      metadata.isPalette ||
      metadata.depth !== "uchar" ||
      (metadata.pages ?? 1) !== 1 ||
      (metadata.channels !== 4 &&
        !(asset.id === "background-sky" && metadata.channels === 3))
    )
      throw new Error(`ASSET_IMAGE_MISMATCH:${asset.id}`);
    await image.raw().toBuffer();
  }
  const missing = missingSceneAssets(manifest);
  return {
    ready: missing.length === 0,
    reason: missing.length === 0 ? "READY" : "MISSING_SCENE_ASSETS",
    missing,
    binding: {
      version: manifest.version,
      contentHash: hash(assetManifestBytes(manifest)),
    },
    checkedFiles: manifest.assets.length,
  };
}
if (import.meta.main) {
  try {
    const result = await checkGameAssets(
      fileURLToPath(new URL("../../apps/web/public", import.meta.url)),
      Number(process.argv[2] ?? 1),
    );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.ready) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "ASSET_CHECK_FAILED"}\n`,
    );
    process.exitCode = 1;
  }
}
