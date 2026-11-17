import {
  closeSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { relative, resolve } from "node:path";
import process from "node:process";
import {
  assertIdle,
  assertPublishable,
  candidates,
  checked,
  fileInfo,
  fingerprint,
  git,
  gitPath,
  pathsFrom,
  root,
} from "./repository.mjs";
import { checkChangedFiles } from "./task-checks.mjs";

const hookMode = process.argv.includes("--hook");

function validHook() {
  const raw = readFileSync(0, "utf8");
  if (raw.length > 1024 * 1024)
    throw new Error("Hook input exceeds its size limit.");
  const event = JSON.parse(raw);
  if (
    typeof event !== "object" ||
    event === null ||
    event.hook_event_name !== "Stop" ||
    typeof event.cwd !== "string"
  ) {
    throw new Error("Expected a Codex Stop hook.");
  }
  const path = relative(root, resolve(event.cwd));
  return (
    path !== ".." && !path.startsWith("../") && event.permission_mode !== "plan"
  );
}

function commitMessage() {
  const args = process.argv
    .slice(2)
    .filter((arg) => !["--", "--hook", "--dry-run"].includes(arg));
  if (args.length > 1)
    throw new Error("Provide one Conventional Commit subject.");
  const message = args[0] ?? "chore: save completed coding task";
  if (
    message.length > 100 ||
    !/^(feat|fix|refactor|perf|test|build|ci|docs|style|chore|revert)(\([a-z0-9/-]+\))?!?: [^\r\n]+$/.test(
      message,
    )
  ) {
    throw new Error(
      "Use a Conventional Commit subject, for example: feat(game): add checkpoints",
    );
  }
  return message;
}

function assertStable(paths, before, head, branch) {
  assertIdle();
  if (
    git(["rev-parse", "HEAD"]).trim() !== head ||
    git(["symbolic-ref", "--quiet", "HEAD"]).trim() !== branch ||
    JSON.stringify(candidates()) !== JSON.stringify(paths) ||
    fingerprint(paths) !== before
  ) {
    throw new Error(
      "The branch or files changed during checks. No commit made; finish concurrent work first.",
    );
  }
}

function stageAndCommit(paths, message, before) {
  git(["add", "--all", "--pathspec-from-file=-", "--pathspec-file-nul"], {
    input: `${paths.join("\0")}\0`,
  });
  const staged = pathsFrom(
    git(["diff", "--cached", "--name-only", "--no-renames", "-z"]),
  ).sort();
  if (
    JSON.stringify(staged) !== JSON.stringify(paths) ||
    fingerprint(paths) !== before
  ) {
    throw new Error(
      "Staged changes differ from the checked snapshot. They remain staged for review.",
    );
  }
  checked(process.execPath, [resolve(root, "scripts/git/check-files.mjs")]);
  git(["commit", "-m", message]);
  return git(["rev-parse", "--short", "HEAD"]).trim();
}

function createCommit(paths, message) {
  const lock = gitPath("purrps-task-commit.lock");
  const handle = openSync(lock, "wx", 0o600);
  try {
    writeFileSync(handle, `${String(process.pid)}\n`);
    assertIdle();
    const head = git(["rev-parse", "HEAD"]).trim();
    const branch = git(["symbolic-ref", "--quiet", "HEAD"]).trim();
    const before = fingerprint(paths);
    checkChangedFiles(paths);
    assertStable(paths, before, head, branch);
    return stageAndCommit(paths, message, before);
  } finally {
    closeSync(handle);
    unlinkSync(lock);
  }
}

function completeTask() {
  if (hookMode && !validHook()) return null;
  assertIdle();
  const paths = candidates();
  if (paths.length === 0) return null;
  if (paths.length > 500)
    throw new Error(
      "More than 500 paths changed. Split the work into logical commits.",
    );
  const existing = paths.filter((path) => fileInfo(path) !== null);
  assertPublishable(existing);
  if (process.argv.includes("--dry-run")) {
    return { dryRun: true, paths, message: commitMessage() };
  }
  return { commit: createCommit(paths, commitMessage()), files: paths.length };
}

try {
  const result = completeTask();
  if (hookMode) {
    const output = result?.commit
      ? {
          systemMessage:
            "PURRPS task committed locally: " +
            result.commit +
            ". Nothing was pushed.",
        }
      : {};
    process.stdout.write(`${JSON.stringify(output)}\n`);
  } else {
    process.stdout.write(
      `${JSON.stringify(
        result ?? { message: "No eligible project changes." },
        null,
        2,
      )}\n`,
    );
  }
} catch (error) {
  const message =
    error instanceof Error ? error.message : "Automatic commit failed.";
  if (hookMode) {
    process.stdout.write(
      `${JSON.stringify({
        systemMessage: `PURRPS task was not committed: ${message}`,
      })}\n`,
    );
  } else {
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
