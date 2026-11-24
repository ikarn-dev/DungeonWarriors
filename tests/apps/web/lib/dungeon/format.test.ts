import { expect, it } from "vitest";
import { displayMultiplier } from "../../../../../apps/web/lib/dungeon/format";

it.each([
  ["1425000", "1000000", "1.43×"],
  ["0", "1", "0×"],
  ["1", "1000000", "<0.01×"],
  ["18446744073709551615", "1", "18,446,744,073,709,551,615×"],
  ["1", "0", "--"],
  ["NaN", "1", "--"],
  [null, "1", "--"],
])("formats exact integer return %s / %s without unsafe floats", (value, stake, expected) => {
  expect(displayMultiplier(value, stake)).toBe(expected);
});
