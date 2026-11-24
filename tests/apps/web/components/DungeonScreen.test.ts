import { createRequire } from "node:module";
import { beforeEach, expect, it, vi } from "vitest";
import DungeonScreen from "../../../../apps/web/components/DungeonScreen";
import { dungeonView } from "../../../../apps/web/lib/server/dungeon-view";
import { record } from "../lib/dungeon/fixtures";

const stage = vi.hoisted(() => ({ mounts: 0 }));
vi.mock("../../../../apps/web/components/DungeonStage", () => ({
  default: () => {
    stage.mounts++;
    return null;
  },
}));
const requireWeb = createRequire(
  new URL("../../../../apps/web/package.json", import.meta.url),
);
const { createElement } = requireWeb("react");
const { renderToStaticMarkup } = requireWeb("react-dom/server");
const ready = dungeonView(record());
function screen(overrides: Partial<Parameters<typeof DungeonScreen>[0]>) {
  const props: Parameters<typeof DungeonScreen>[0] = {
    view: ready,
    artwork: { cat: ready.cat } as Parameters<
      typeof DungeonScreen
    >[0]["artwork"],
    client: "fixture",
    busy: false,
    notice: null,
    send: async () => null,
    onPlay: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  return renderToStaticMarkup(createElement(DungeonScreen, props));
}
beforeEach(() => {
  stage.mounts = 0;
});
it("does not mount a game renderer while wallet approval is pending", () => {
  const html = screen({
    busy: true,
    view: {
      ...ready,
      phase: "preparing",
      preparation: {
        transaction: "unsigned",
        lastValidBlockHeight: 100,
        sponsor: ready.owner,
        maxPayerDebit: "1",
      },
    },
  });
  expect(stage.mounts).toBe(0);
  expect(html).toContain("Approve the wager in your wallet.");
  expect(html).toContain("disabled");
});
it("waits for reservation confirmation without creating renderer side effects", () => {
  const html = screen({
    view: { ...ready, phase: "preparing", preparation: null },
  });
  expect(stage.mounts).toBe(0);
  expect(html).toContain("Confirming your wager");
});
it("does not present an unsigned cancellation as a finalized zero payout", () => {
  const html = screen({
    view: { ...ready, phase: "cancelled", settled: true },
    notice: "Your expedition is saving.",
  });
  expect(stage.mounts).toBe(0);
  expect(html).toContain("Wager not placed");
  expect(html).toContain("Your expedition is saving.");
  expect(html).not.toContain("0 USDC");
  expect(html).not.toContain("finalized");
});
it("mounts gameplay only after a confirmed ready expedition", () => {
  screen({});
  expect(stage.mounts).toBe(1);
});
