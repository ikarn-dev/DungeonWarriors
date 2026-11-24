import { verifyManifestBinding } from "./assets";
import type { CatId } from "./catalog";
import { runImages } from "./render-assets";
import { readWebJson } from "./web-api";

type Binding = { version: number; contentHash: string };

export async function loadRunArtwork(
  binding: Binding,
  signal: AbortSignal,
  cat?: CatId,
) {
  const [manifest, { default: engine }, { renderRun }] = await Promise.all([
    fetch(`/game-assets/v${binding.version}/manifest.json`, { signal }).then(
      async (response) => {
        if (!response.ok) throw new Error("ASSETS_NOT_READY");
        return verifyManifestBinding(await readWebJson(response), binding);
      },
    ),
    import("phaser"),
    import("./render-run"),
  ]);
  const assets = cat
    ? new Map(
        await Promise.all(
          runImages(manifest, cat).map(async (art) => {
            const response = await fetch(art.path, {
              signal,
              cache: "force-cache",
            });
            if (!response.ok) throw new Error("ASSETS_NOT_READY");
            const blob = await response.blob();
            if (blob.size !== art.bytes) throw new Error("ASSETS_NOT_READY");
            return [art.id, blob] as const;
          }),
        ),
      )
    : undefined;
  signal.throwIfAborted();
  return { binding, manifest, engine, renderRun, assets, cat };
}

export type RunArtwork = Awaited<ReturnType<typeof loadRunArtwork>>;
