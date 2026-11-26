import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  checkEngine,
  ENGINE_SOURCES,
  engineHash,
} from "../../../scripts/program/dungeon-engine.mjs";

test("the retained Rust and web bindings match the exact combat, generation, timer and verification engine", () => {
  const expected = checkEngine();
  assert.match(expected, /^[a-f0-9]{64}$/);
  for (const changed of ENGINE_SOURCES) {
    const hash = engineHash(
      (path) =>
        readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8") +
        (path === changed ? "\n// changed behavior\n" : ""),
    );
    assert.notEqual(hash, expected, changed);
  }
});

test("the admin publication rules import directly in Node without a server or custom loader", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      'import {DUNGEON_V3} from "./apps/web/lib/dungeon/rules.ts"; if(DUNGEON_V3.version!==3 || DUNGEON_V3.engineHash.length!==32)process.exit(1);',
    ],
    { cwd: new URL("../../../", import.meta.url), encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
});
