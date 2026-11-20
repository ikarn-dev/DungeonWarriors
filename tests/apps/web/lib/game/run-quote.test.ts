import { expect, it } from "vitest";
import {
  grossPayout,
  quotedGross,
} from "../../../../../apps/web/lib/game/economy";
import { RULES_V1 } from "../../../../../apps/web/lib/game/rules";

it("locks the exact available cap and applies it to the earned payout", () => {
  const stake = 5_000_000n;
  const cap = quotedGross(stake, 20_000_000n, RULES_V1.maxMultiplierBps);
  expect(cap).toBe(25_000_000n);
  expect(grossPayout(stake, 1n, cap)).toBe(5_500_000n);
  expect(grossPayout(stake, 100n, cap)).toBe(cap);
  expect(quotedGross(stake, 1n, RULES_V1.maxMultiplierBps)).toBe(stake + 1n);
  expect(quotedGross(stake, 0n, RULES_V1.maxMultiplierBps)).toBe(stake);
  expect(quotedGross(0n, 0n, RULES_V1.maxMultiplierBps)).toBe(0n);
  expect(grossPayout(0n, 10n, 0n)).toBe(0n);
});
