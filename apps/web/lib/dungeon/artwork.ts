import { parseAssetManifest } from "../game/assets";
import type { CatId } from "../game/catalog";
import { readWebJson } from "../game/web-api";
import { WARRIOR_ART, WARRIORS } from "./warriors";

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
  // Hash-verified SVG bytes by asset ID.
  images: ReadonlyMap<string, Blob>;
};
async function readBounded(
  url: string,
  bytes: number,
  signal: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  const response = await fetch(url, {
    signal,
    cache: "force-cache",
  });
  if (!response.ok || !response.body) throw new Error("ASSETS_NOT_READY");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.length;
      if (length > bytes) {
        await reader.cancel();
        throw new Error("ASSETS_NOT_READY");
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const out = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
export function loadDungeonArtwork(cat: CatId): Promise<DungeonArtwork> {
  const cached = pending.get(cat);
  if (cached) return cached;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("ASSETS_NOT_READY"));
    }, 15000);
  });
  const loading = (async () => {
    const [response, { default: engine }, { renderDungeon }] =
      await Promise.all([
        fetch(`${WARRIOR_ART}/manifest.json`, {
          signal: controller.signal,
        }),
        import("phaser"),
        import("./render-dungeon"),
      ]);
    if (!response.ok) throw new Error("ASSETS_NOT_READY");
    const manifest = parseAssetManifest(await readWebJson(response));
    const wanted = [
      `body-${cat}`,
      `weapon-${WARRIORS[cat].weapon}`,
      ...ENEMY_ART,
    ];
    const images = new Map<string, Blob>();
    await Promise.all(
      wanted.map(async (id) => {
        const asset = manifest.assets.find((a) => a.id === id);
        if (!asset) throw new Error("ASSETS_NOT_READY");
        const bytes = await readBounded(
          asset.path,
          asset.bytes,
          controller.signal,
        );
        const hash = Array.from(
          new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
          (b) => b.toString(16).padStart(2, "0"),
        ).join("");
        if (bytes.byteLength !== asset.bytes || hash !== asset.sha256)
          throw new Error("ASSETS_NOT_READY");
        images.set(id, new Blob([bytes], { type: "image/svg+xml" }));
      }),
    );
    return { cat, engine, manifest, render: renderDungeon, images };
  })();
  // Bound imports as well as downloads, so a stalled preload can be retried.
  const task = Promise.race([loading, deadline]).finally(() =>
    clearTimeout(timer),
  );
  pending.set(cat, task);
  void task.catch(() => {
    controller.abort();
    if (pending.get(cat) === task) pending.delete(cat);
  });
  return task;
}
