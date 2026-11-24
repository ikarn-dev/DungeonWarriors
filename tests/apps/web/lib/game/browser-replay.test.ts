import { expect, it } from "vitest";
import {
  BrowserRunner,
  beginBrowserReplay,
  browserGraceMs,
  browserReplaySchema,
  decodeBrowser,
  encodeBrowser,
  finishBrowserReplay,
  scheduleBrowserPrice,
  verifyBrowserStep,
} from "../../../../../apps/web/lib/game/browser-replay";
import { catStats } from "../../../../../apps/web/lib/game/catalog";
import {
  type GameplayRules,
  RULES_V3,
  RULES_V4,
} from "../../../../../apps/web/lib/game/rules";
import { initializeWorld } from "../../../../../apps/web/lib/game/world";
import { initialWorld, sample } from "./world-fixtures";

function initial(rules: GameplayRules = RULES_V3) {
  const stats = catStats("collector", 1);
  return beginBrowserReplay(
    initializeWorld(initialWorld().frame, stats, sample(), rules),
    stats,
    sample(),
    rules,
    1000,
  );
}
it.each([
  RULES_V3,
  RULES_V4,
])("replays timed prices and commands identically under rules v$rulesVersion", (rules) => {
  const replay = initial(rules);
  scheduleBrowserPrice(replay, sample(1n), 1000);
  const runner = new BrowserRunner(structuredClone(replay));
  runner.advance(2000);
  runner.input({ kind: "jump" });
  runner.advance(2500);
  const verified = verifyBrowserStep(replay, 90, runner.inputs, 2500);
  expect(verified.world).toEqual(runner.world);
  expect(
    browserReplaySchema.parse(decodeBrowser(encodeBrowser(verified))),
  ).toEqual(verified);
});
it("rejects accelerated ticks, rewritten inputs and excessive controls across requests", () => {
  const replay = initial();
  expect(() => verifyBrowserStep(replay, 60, [], 1500)).toThrow(
    "INVALID_REPLAY_TIME",
  );
  expect(() =>
    verifyBrowserStep(
      replay,
      60,
      [{ tick: 0, action: { kind: "jump" } }],
      2000,
    ),
  ).toThrow("INVALID_REPLAY_ORDER");
  const actions = Array.from({ length: 20 }, () => ({
    tick: 1,
    action: { kind: "move", axis: "neutral" },
  }));
  const next = verifyBrowserStep(replay, 1, actions, 1100);
  expect(() =>
    verifyBrowserStep(next, 2, [{ tick: 2, action: { kind: "jump" } }], 1200),
  ).toThrow("CONTROL_RATE_EXCEEDED");
});
it("makes reload and timeout terminal at verified progress and never resumes", () => {
  const replay = verifyBrowserStep(initial(), 60, [], 2000);
  const closed = finishBrowserReplay(replay, "reload");
  expect(closed.world.frame.activeTicks).toBe(60n);
  expect(closed.world.frame.terminalReason).toBe("surrender");
  expect(verifyBrowserStep(closed, 120, [], 3000)).toEqual(closed);
  const timedOut = verifyBrowserStep(replay, 61, [], 2000 + browserGraceMs + 1);
  expect(timedOut.stop).toBe("pageClosed");
  expect(timedOut.world.frame.activeTicks).toBe(60n);
});
it("refunds an unstarted launch but rejects calling an active game unstarted", () => {
  const replay = initial();
  expect(
    finishBrowserReplay(replay, "unstarted").world.frame.terminalReason,
  ).toBe("technicalAbort");
  const played = verifyBrowserStep(replay, 1, [], 1100);
  expect(() => finishBrowserReplay(played, "unstarted")).toThrow(
    "RUN_ALREADY_STARTED",
  );
});

it("preserves a prior crash and qualified payout on interruption", () => {
  const crashed = initial();
  crashed.world.frame.phase = "terminalRecorded";
  crashed.world.frame.terminalReason = "crash";
  expect(
    finishBrowserReplay(crashed, "reload").world.frame.terminalReason,
  ).toBe("crash");
  const qualified = initial();
  qualified.world.frame.qualifiedCheckpoints = 1n;
  expect(
    finishBrowserReplay(qualified, "engineError").world.frame.terminalReason,
  ).toBe("autoCashOut");
});
