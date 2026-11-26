import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assetManifestBytes,
  catalogManifestPath,
  MEDIA_VERSION,
  missingSceneAssets,
  parseAssetManifest,
  requiredSceneAssets,
} from "../../apps/web/lib/game/assets.ts";

const webRequire = createRequire(
  new URL("../../apps/web/package.json", import.meta.url),
);
// Reuse Next's installed image decoder; no extra package or local server.
const sharp = createRequire(webRequire.resolve("next"))("sharp");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const insideOf = (root) => (path) => {
  const actual = realpathSync(path);
  if (!actual.startsWith(root + sep)) throw new Error("ASSET_PATH_ESCAPE");
  return actual;
};
function readManifest(file) {
  if (statSync(file).size > 256 * 1024) throw new Error("MANIFEST_TOO_LARGE");
  return parseAssetManifest(JSON.parse(readFileSync(file, "utf8")));
}
// The manifest the onchain catalog binds for a media version. Only the
// manifest document is kept (2026-11-26); its retired runner art files are
// not checked.
export function catalogManifestBinding(publicDirectory, version) {
  const root = realpathSync(publicDirectory);
  const manifest = readManifest(
    insideOf(root)(join(root, catalogManifestPath(version).slice(1))),
  );
  if (manifest.version !== version) throw new Error("ASSET_VERSION_MISMATCH");
  return { version, contentHash: hash(assetManifestBytes(manifest)) };
}
// Every file in the single game-assets folder's manifest: size, hash, safe
// SVG content and decoded dimensions.
export async function checkGameAssets(publicDirectory) {
  const root = realpathSync(publicDirectory);
  const candidate = join(root, "game-assets/manifest.json");
  if (!existsSync(candidate))
    return {
      ready: false,
      reason: "USER_ASSETS_PENDING",
      missing: [...requiredSceneAssets(MEDIA_VERSION)],
    };
  const inside = insideOf(root);
  const manifest = readManifest(inside(candidate));
  for (const asset of manifest.assets) {
    const path = inside(join(root, asset.path.slice(1)));
    const stat = statSync(path);
    if (!stat.isFile() || stat.size !== asset.bytes)
      throw new Error(`ASSET_SIZE_MISMATCH:${asset.id}`);
    const data = readFileSync(path);
    if (hash(data) !== asset.sha256)
      throw new Error(`ASSET_HASH_MISMATCH:${asset.id}`);
    const vector = path.endsWith(".svg");
    if (vector) {
      const svg = data.toString("utf8").trim();
      const shape =
        /<\/?(?:svg|g|path|rect|ellipse|circle|polygon|linearGradient|stop|defs)\b(?:\s+(?:[a-zA-Z][a-zA-Z-]*="[^"&<>]*"))*\s*\/?>/g;
      const disallowed =
        /\b(?:on[a-z]+|style|href)\s*=|url\((?!#[a-z][a-z0-9-]*\))|[&]/i;
      if (
        !svg.startsWith("<svg ") ||
        !svg.endsWith("</svg>") ||
        svg.replace(shape, "").trim() !== "" ||
        disallowed.test(svg) ||
        /\bxmlns="[^"]+"/.exec(svg)?.[0] !==
          'xmlns="http://www.w3.org/2000/svg"'
      )
        throw new Error(`UNSAFE_ASSET_SVG:${asset.id}`);
    }
    const image = sharp(data, {
      limitInputPixels: 4096 * 4096,
      failOn: "warning",
    });
    const metadata = await image.metadata();
    if (
      metadata.format !== (vector ? "svg" : "png") ||
      metadata.width !== asset.width ||
      metadata.height !== asset.height ||
      (!vector && metadata.isPalette) ||
      metadata.depth !== "uchar" ||
      (metadata.pages ?? 1) !== 1 ||
      (!vector &&
        metadata.channels !== 4 &&
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
