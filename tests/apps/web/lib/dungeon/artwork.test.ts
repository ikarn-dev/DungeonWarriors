import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CatId } from "../../../../../apps/web/lib/game/catalog";

const phaser = "../../../../../apps/web/node_modules/phaser/dist/phaser.esm.js";
function availableEngine() {
  vi.doMock(phaser, () => ({
    default: { Game: class {}, Scene: class {} },
  }));
}
vi.mock("../../../../../apps/web/lib/dungeon/render-dungeon", () => ({
  renderDungeon: vi.fn(),
}));
const fetch = vi.fn(() => {
  throw new Error("Standalone artwork requests must not gate gameplay");
});
beforeEach(() => {
  vi.resetModules();
  availableEngine();
  fetch.mockClear();
  vi.stubGlobal("fetch", fetch);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("bundled dungeon startup", () => {
  it.each<CatId>([
    "collector",
    "acrobat",
    "guardian",
    "sprinter",
  ])("%s starts with bundled artwork even when standalone SVG requests fail", async (cat) => {
    const { loadDungeonArtwork } = await import(
      "../../../../../apps/web/lib/dungeon/artwork"
    );
    const first = loadDungeonArtwork(cat);
    expect(loadDungeonArtwork(cat)).toBe(first);
    const loaded = await first;
    expect(loaded.cat).toBe(cat);
    expect(loaded.images.size).toBe(6);
    expect(await loaded.images.get(`body-${cat}`)?.text()).toContain("<svg");
    for (const enemy of ["bat", "skeleton", "slime", "warden"])
      expect(loaded.images.has(`enemy-${enemy}`)).toBe(true);
    expect(loaded.engine.Game).toBeTypeOf("function");
    expect(loadDungeonArtwork(cat)).toBe(first);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not retain a failed engine import", async () => {
    vi.doMock(phaser, () => {
      throw new Error("Engine chunk unavailable");
    });
    const { loadDungeonArtwork } = await import(
      "../../../../../apps/web/lib/dungeon/artwork"
    );
    await expect(loadDungeonArtwork("collector")).rejects.toThrow();
    availableEngine();
    await expect(loadDungeonArtwork("collector")).resolves.toMatchObject({
      cat: "collector",
    });
  });

  it("bounds a stalled module import and allows Play again", async () => {
    vi.useFakeTimers();
    vi.doMock(phaser, () => new Promise(() => {}));
    const { loadDungeonArtwork } = await import(
      "../../../../../apps/web/lib/dungeon/artwork"
    );
    const stalled = loadDungeonArtwork("collector");
    const failed = expect(stalled).rejects.toThrow("ASSETS_NOT_READY");
    await vi.advanceTimersByTimeAsync(15000);
    await failed;
    vi.useRealTimers();
    availableEngine();
    const retry = loadDungeonArtwork("collector");
    expect(retry).not.toBe(stalled);
    await expect(retry).resolves.toMatchObject({ cat: "collector" });
    expect(fetch).not.toHaveBeenCalled();
  });
});
