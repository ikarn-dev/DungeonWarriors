import { z } from "zod";

export const FIRST_SCENE_ASSETS = [
  "background-forest-far",
  "background-forest-near",
  "background-sky",
  "booster-double-jump",
  "booster-extra-dash",
  "booster-magnet",
  "booster-shield",
  "bridge-deck",
  "bridge-left",
  "bridge-right",
  "bridge-support",
  "cat-acrobat",
  "cat-collector",
  "cat-guardian",
  "cat-sprinter",
  "coin-shadow",
  "coin-spin",
  "effects-actions",
  "effects-powers",
  "hazard-obstacle",
  "hazard-pit-edge",
  "hud-controls",
  "star",
  "terrain-fill",
  "terrain-grass",
  "terrain-left",
  "terrain-right",
  "terrain-underside",
  "water-fill",
  "water-surface",
] as const;

const positive = z.number().int().min(1);
const index = z.number().int().min(0);
const identifier = z
  .string()
  .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/)
  .max(64);
const clip = z
  .object({
    name: identifier,
    start: index,
    count: positive.max(256),
    fps: positive.max(60),
    loop: z.boolean(),
  })
  .strict();
export const imageAssetSchema = z
  .object({
    id: identifier,
    path: z
      .string()
      .max(200)
      .regex(
        /^\/game-assets\/v[1-9][0-9]*\/(?:[a-z0-9]+(?:-[a-z0-9]+)*\/)*[a-z0-9]+(?:-[a-z0-9]+)*\.png$/,
      ),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    bytes: positive.max(8 * 1024 * 1024),
    width: positive.max(4096),
    height: positive.max(4096),
    frameWidth: positive.max(960),
    frameHeight: positive.max(540),
    frames: positive.max(256),
    anchor: z.object({ x: index, y: index }).strict(),
    repeat: z.enum(["none", "x", "xy"]),
    reducedMotionFrame: index.max(255),
    clips: z.array(clip).max(32),
  })
  .strict();
export type ImageAsset = z.infer<typeof imageAssetSchema>;
const manifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    version: positive.max(0xffffffff),
    assets: z.array(imageAssetSchema).min(1).max(128),
  })
  .strict();
export type AssetManifest = z.infer<typeof manifestSchema>;

export function parseAssetManifest(input: unknown): AssetManifest {
  const manifest = manifestSchema.parse(input);
  let previous = "";
  const paths = new Set<string>();
  for (const a of manifest.assets) {
    if (
      a.id <= previous ||
      paths.has(a.path) ||
      !a.path.startsWith(`/game-assets/v${manifest.version}/`) ||
      a.width % a.frameWidth !== 0 ||
      a.height % a.frameHeight !== 0 ||
      a.frames > (a.width / a.frameWidth) * (a.height / a.frameHeight) ||
      a.anchor.x > a.frameWidth ||
      a.anchor.y > a.frameHeight ||
      a.reducedMotionFrame >= a.frames
    )
      throw new Error("INVALID_ASSET_MANIFEST");
    previous = a.id;
    paths.add(a.path);
    const requiredClips =
      a.id === "effects-actions"
        ? ["dash", "hit", "landing", "pickup"]
        : a.id === "effects-powers"
          ? [
              "double-jump",
              "extra-dash",
              "magnet",
              "shield-active",
              "shield-contact",
            ]
          : a.id === "hud-controls"
            ? [
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
              ]
            : [];
    if (requiredClips.some((name) => !a.clips.some((c) => c.name === name)))
      throw new Error("MISSING_ASSET_CLIP");
    let last = "";
    for (const c of a.clips) {
      if (c.name <= last || c.start + c.count > a.frames)
        throw new Error("INVALID_ASSET_CLIP");
      last = c.name;
    }
    if (
      a.id.startsWith("cat-") &&
      (a.frameWidth !== 48 ||
        a.frameHeight !== 48 ||
        a.anchor.x !== 24 ||
        a.anchor.y !== 40 ||
        ["idle", "run", "jump", "fall", "dash", "hit", "defeat"].some(
          (name) => !a.clips.some((c) => c.name === name),
        ))
    )
      throw new Error("INVALID_CAT_SHEET");
    if (
      a.id === "coin-spin" &&
      (a.width !== 512 ||
        a.height !== 32 ||
        a.frameWidth !== 32 ||
        a.frameHeight !== 32 ||
        a.frames !== 16 ||
        a.anchor.x !== 16 ||
        a.anchor.y !== 28 ||
        a.reducedMotionFrame !== 0 ||
        a.clips.length !== 1 ||
        a.clips[0]?.name !== "spin" ||
        a.clips[0].start !== 0 ||
        a.clips[0].count !== 16 ||
        a.clips[0].fps !== 16 ||
        !a.clips[0].loop)
    )
      throw new Error("INVALID_COIN_SHEET");
    if (
      a.id === "coin-shadow" &&
      (a.width !== 16 || a.height !== 6 || a.frames !== 1)
    )
      throw new Error("INVALID_COIN_SHADOW");
    if (
      a.id.startsWith("background-") &&
      (a.width !== 960 ||
        a.height !== 540 ||
        a.frames !== 1 ||
        a.repeat !== "x")
    )
      throw new Error("INVALID_BACKGROUND");
  }
  return manifest;
}
export function missingSceneAssets(manifest: AssetManifest): string[] {
  const ids = new Set(manifest.assets.map((a) => a.id));
  return FIRST_SCENE_ASSETS.filter((id) => !ids.has(id));
}
// Zod fixes field order; asset IDs and clip names must be sorted. The hash binds
// these canonical UTF-8 bytes, never whitespace or a self-referential hash field.
export function assetManifestBytes(input: unknown): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(JSON.stringify(parseAssetManifest(input)));
}
export async function verifyManifestBinding(
  input: unknown,
  binding: { version: number; contentHash: string },
) {
  const manifest = parseAssetManifest(input);
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", assetManifestBytes(manifest)),
  );
  const hash = Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  if (
    binding.version !== manifest.version ||
    binding.contentHash !== hash ||
    missingSceneAssets(manifest).length > 0
  )
    throw new Error("ASSETS_NOT_READY");
  return manifest;
}
