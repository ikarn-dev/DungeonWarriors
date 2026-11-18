import assert from "node:assert/strict";
import { test } from "node:test";
import { commitSubject } from "../../../scripts/git/commit-message.mjs";

test("commits require an explicit change-specific subject", () => {
  for (const args of [
    [],
    ["chore: save completed coding task"],
    ["feat: first", "fix: second"],
    ["not conventional"],
    ["feat: newline\nbody"],
    [`feat: ${"x".repeat(100)}`],
  ])
    assert.throws(() => commitSubject(args));
  assert.equal(
    commitSubject(["feat(game): add bounded world prediction"]),
    "feat(game): add bounded world prediction",
  );
});
