import { expect, it } from "vitest";
import { assertAdmission } from "../../../../../apps/web/lib/server/runtime";

it("fails closed when the SDK timeout response is marked successful", () => {
  expect(() => assertAdmission([{ success: true, reason: "timeout" }])).toThrow(
    "LIMITER_UNAVAILABLE",
  );
});
it("rejects any exceeded distributed quota", () => {
  expect(() =>
    assertAdmission([{ success: true }, { success: false }]),
  ).toThrow("RATE_LIMITED");
});
it("admits only successful quota responses", () => {
  expect(() =>
    assertAdmission([{ success: true }, { success: true }]),
  ).not.toThrow();
});
