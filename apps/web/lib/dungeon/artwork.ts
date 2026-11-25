import { ENEMY_PART_IDS, parseAssetManifest, RIG_PARTS } from "../game/assets";
import type { CatId } from "../game/catalog";
import { WARRIORS } from "./warriors";

const pending = new Map<CatId, Promise<DungeonArtwork>>();
const ENEMY_ART = [
  "enemy-bat",
  "enemy-skeleton",
  "enemy-slime",
  "enemy-warden",
] as const;
export type DungeonArtwork = {
  cat: CatId;
  engine: typeof import("phaser");
  manifest: ReturnType<typeof parseAssetManifest>;
  render: typeof import("./render-dungeon").renderDungeon;
  // The production build checks these bundled SVG bytes against the manifest.
  images: ReadonlyMap<string, Blob>;
};
export function loadDungeonArtwork(cat: CatId): Promise<DungeonArtwork> {
  const cached = pending.get(cat);
  if (cached) return cached;
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("ASSETS_NOT_READY")), 15000);
  });
  const loading = (async () => {
    const [{ default: bundle }, { default: engine }, { renderDungeon }] =
      await Promise.all([
        import("./artwork-data.json"),
        import("phaser"),
        import("./render-dungeon"),
      ]);
    const manifest = parseAssetManifest(bundle.manifest);
    const source: Readonly<Record<string, string>> = bundle.images;
    const images = new Map<string, Blob>();
    for (const id of [
      ...RIG_PARTS.map((part) => `rig-${cat}-${part}`),
      `weapon-${WARRIORS[cat].weapon}`,
      ...ENEMY_ART,
      ...ENEMY_PART_IDS,
    ]) {
      const svg = source[id];
      if (!svg) throw new Error("ASSETS_NOT_READY");
      images.set(id, new Blob([svg], { type: "image/svg+xml" }));
    }
    return { cat, engine, manifest, render: renderDungeon, images };
  })();
  const task = Promise.race([loading, deadline]).finally(() =>
    clearTimeout(timer),
  );
  pending.set(cat, task);
  void task.catch(() => {
    if (pending.get(cat) === task) pending.delete(cat);
  });
  return task;
}
