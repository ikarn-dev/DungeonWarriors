import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock(
  "../../../../../apps/web/node_modules/phaser/dist/phaser.esm.js",
  () => ({
    default: { Game: class {}, Scene: class {} },
  }),
);
vi.mock("../../../../../apps/web/lib/dungeon/render-dungeon", () => ({
  renderDungeon: vi.fn(),
}));

const fetchAssets = vi.fn(async (input: string | URL | Request) => {
  const path = new URL(String(input), "https://purrps.test").pathname;
  const bytes = readFileSync(
    new URL(`../../../../../apps/web/public${path}`, import.meta.url),
  );
  return new Response(new Uint8Array(bytes));
});

beforeEach(() => {
  vi.resetModules();
  fetchAssets.mockClear();
  vi.stubGlobal("fetch", fetchAssets);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("dungeon startup preflight", () => {
  it("verifies every required image and shares a completed preload", async () => {
    const { loadDungeonArtwork } = await import(
      "../../../../../apps/web/lib/dungeon/artwork"
    );
    const first = loadDungeonArtwork("collector");
    expect(loadDungeonArtwork("collector")).toBe(first);
    const loaded = await first;
    expect(loaded.cat).toBe("collector");
    expect([...loaded.images.keys()].sort()).toEqual(
      [
        "body-collector",
        "weapon-spear",
        "enemy-bat",
        "enemy-skeleton",
        "enemy-slime",
        "enemy-warden",
      ].sort(),
    );
    expect(loaded.engine.Game).toBeTypeOf("function");
    expect(loadDungeonArtwork("collector")).toBe(first);
    expect(fetchAssets).toHaveBeenCalledTimes(7);
  });

  it("rejects altered art before approval and allows a clean retry", async () => {
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      const response = await fetchAssets(input);
      if (!String(input).includes("body-collector")) return response;
      const bytes = new Uint8Array(await response.arrayBuffer());
      bytes[0] = 0;
      return new Response(new Uint8Array(bytes));
    });
    const { loadDungeonArtwork } = await import(
      "../../../../../apps/web/lib/dungeon/artwork"
    );
    await expect(loadDungeonArtwork("collector")).rejects.toThrow(
      "ASSETS_NOT_READY",
    );
    vi.stubGlobal("fetch", fetchAssets);
    await expect(loadDungeonArtwork("collector")).resolves.toMatchObject({
      cat: "collector",
    });
  });

  it("expires a stalled startup instead of permanently locking entry", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", () => new Promise(() => {}));
    const { loadDungeonArtwork } = await import(
      "../../../../../apps/web/lib/dungeon/artwork"
    );
    const stalled = loadDungeonArtwork("collector");
    const failed = expect(stalled).rejects.toThrow("ASSETS_NOT_READY");
    await vi.advanceTimersByTimeAsync(15000);
    await failed;
    vi.useRealTimers();
    vi.stubGlobal("fetch", fetchAssets);
    const retry = loadDungeonArtwork("collector");
    expect(retry).not.toBe(stalled);
    await expect(retry).resolves.toMatchObject({ cat: "collector" });
  });
});
