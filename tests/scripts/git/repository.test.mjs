import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertPublishable,
  isProjectPath,
} from "../../../scripts/git/repository.mjs";

test("centralized tests and fixtures are publishable project source", () => {
  const paths = [
    "tests/apps/purrps-game-program/rule-contracts.rs",
    "tests/apps/web/lib/game/contracts.test.ts",
    "tests/fixtures/game-v1/physics.csv",
    "tests/tsconfig.json",
  ];
  assert.ok(paths.every(isProjectPath));
  assert.doesNotThrow(() => assertPublishable(paths));
});

test("allowing tests preserves ignored-secret and unrelated-file restrictions", () => {
  for (const path of [
    "tests/.env",
    "tests/wallet.json",
    "tests/test-keypair.json",
    "Local-only_Docs/PURRPS_PRD_v3.3.md",
    "unrelated/output.txt",
  ]) {
    assert.throws(() => assertPublishable([path]));
  }
});
