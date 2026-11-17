import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readlinkSync, realpathSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const root = realpathSync(
  fileURLToPath(new URL("../../", import.meta.url)),
);
export const maxFileBytes = 50 * 1024 * 1024;

const roots = [
  "apps/web/",
  "apps/purrps-game-program/",
  "packages/",
  "scripts/",
  "tests/",
  ".githooks/",
  ".github/",
  "docs/",
];
const rootFiles = new Set([
  ".gitignore",
  ".gitattributes",
  ".node-version",
  ".nvmrc",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "biome.json",
  "README.md",
  "LICENSE",
  "LICENSE.md",
  "LICENSE.txt",
  "tsconfig.json",
  "vercel.json",
]);

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    timeout: 60_000,
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, PURRPS_NODE: process.execPath },
    ...options,
  });
  if (result.error) throw result.error;
  return result;
}

export function checked(command, args, options = {}) {
  const result = run(command, args, options);
  if (result.status !== 0) {
    throw new Error(
      command +
        " failed (exit " +
        result.status +
        "). Run the command directly for diagnostics.",
    );
  }
  return result.stdout;
}

export function git(args, { input, statuses = [0] } = {}) {
  // check-ignore takes literal filenames and rejects pathspec-magic options.
  const commandArgs =
    args[0] === "check-ignore"
      ? ["--no-literal-pathspecs", ...args]
      : ["--literal-pathspecs", ...args];
  const result = run("git", commandArgs, { input });
  if (!statuses.includes(result.status)) {
    throw new Error(`git ${args[0]} failed (exit ${result.status}).`);
  }
  return result.stdout;
}

export function pathsFrom(output) {
  return output.split("\0").filter(Boolean);
}

export function ignoredPaths(paths) {
  if (paths.length === 0) return [];
  return pathsFrom(
    git(["check-ignore", "--no-index", "--stdin", "-z"], {
      input: `${paths.join("\0")}\0`,
      statuses: [0, 1],
    }),
  );
}

export function isProjectPath(path) {
  return rootFiles.has(path) || roots.some((prefix) => path.startsWith(prefix));
}

export function assertPublishable(paths) {
  const ignored = new Set(ignoredPaths(paths));
  const denied = paths.filter(
    (path) => ignored.has(path) || !isProjectPath(path),
  );
  if (denied.length > 0) {
    throw new Error(
      `Local-only or unrelated paths are blocked: ${JSON.stringify(denied)}`,
    );
  }
}

export function fileInfo(path) {
  try {
    return lstatSync(join(root, path));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return null;
    throw error;
  }
}

export function candidates() {
  const changed = new Set(
    pathsFrom(
      git([
        "ls-files",
        "-z",
        "--modified",
        "--deleted",
        "--others",
        "--exclude-standard",
      ]),
    ),
  );
  const ignored = new Set(ignoredPaths([...changed]));
  return [...changed]
    .filter(
      (path) =>
        fileInfo(path) === null || (isProjectPath(path) && !ignored.has(path)),
    )
    .sort();
}

export function fingerprint(paths) {
  const hash = createHash("sha256");
  let totalBytes = 0;
  for (const path of paths) {
    hash.update(`${path}\0`);
    const info = fileInfo(path);
    if (info === null) {
      hash.update("deleted");
    } else if (info.isSymbolicLink()) {
      hash.update(`link:${readlinkSync(join(root, path))}`);
    } else if (info.isFile()) {
      if (info.size > maxFileBytes)
        throw new Error(`File exceeds 50 MiB: ${JSON.stringify(path)}`);
      totalBytes += info.size;
      if (totalBytes > 200 * 1024 * 1024)
        throw new Error("Changed files exceed the 200 MiB task limit.");
      hash.update(String(info.mode));
      hash.update(readFileSync(join(root, path)));
    } else {
      throw new Error(`Unsupported file type: ${JSON.stringify(path)}`);
    }
  }
  return hash.digest("hex");
}

export function gitPath(name) {
  return git([
    "rev-parse",
    "--path-format=absolute",
    "--git-path",
    name,
  ]).trim();
}

export function assertIdle() {
  const branch = run("git", ["symbolic-ref", "--quiet", "HEAD"]);
  if (branch.status !== 0)
    throw new Error("Automatic commits require a checked-out branch.");
  for (const name of [
    "MERGE_HEAD",
    "CHERRY_PICK_HEAD",
    "REVERT_HEAD",
    "rebase-merge",
    "rebase-apply",
    "index.lock",
  ]) {
    if (fileInfoFromAbsolute(gitPath(name))) {
      throw new Error(
        `Git operation in progress: ${name}. No automatic commit made.`,
      );
    }
  }
  const staged = git(["diff", "--cached", "--name-only", "-z"]);
  if (staged.length > 0) {
    throw new Error(
      "Existing staged changes are preserved. Finish or unstage them before automatic commits.",
    );
  }
}

function fileInfoFromAbsolute(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return null;
    throw error;
  }
}
