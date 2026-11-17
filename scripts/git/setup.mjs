import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { git, gitPath, root } from "./repository.mjs";

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function localHookConfig() {
  const directory = join(root, ".codex");
  const path = join(directory, "hooks.json");
  if (existsSync(directory) && lstatSync(directory).isSymbolicLink()) {
    throw new Error("Refusing to write through a linked .codex directory.");
  }
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) {
    throw new Error("Refusing to overwrite a linked hook definition.");
  }
  const current = existsSync(path)
    ? JSON.parse(readFileSync(path, "utf8"))
    : {};
  if (
    typeof current !== "object" ||
    current === null ||
    Array.isArray(current)
  ) {
    throw new Error("Existing hook configuration must be a JSON object.");
  }
  const hooks = current.hooks ?? {};
  if (typeof hooks !== "object" || hooks === null || Array.isArray(hooks)) {
    throw new Error("Existing hooks must be an object.");
  }
  const stop = hooks.Stop ?? [];
  if (!Array.isArray(stop))
    throw new Error("Existing Stop hooks must be an array.");
  const command =
    shellQuote(process.execPath) +
    " " +
    shellQuote(join(root, "scripts/git/task-commit.mjs")) +
    " --hook";
  const present = stop.some(
    (entry) =>
      Array.isArray(entry?.hooks) &&
      entry.hooks.some((handler) => handler?.command === command),
  );
  if (present) return { path, directory, content: null };
  const registration = {
    hooks: [
      {
        type: "command",
        command,
        timeout: 240,
        statusMessage: "Committing completed PURRPS task",
      },
    ],
  };
  return {
    path,
    directory,
    content: `${JSON.stringify(
      { ...current, hooks: { ...hooks, Stop: [...stop, registration] } },
      null,
      2,
    )}\n`,
  };
}

try {
  const previous = git(["config", "--get", "core.hooksPath"], {
    statuses: [0, 1],
  }).trim();
  if (previous && previous !== ".githooks") {
    throw new Error(`Existing core.hooksPath is preserved: ${previous}`);
  }
  if (
    !previous &&
    ["pre-commit", "pre-push"].some((name) =>
      existsSync(gitPath(`hooks/${name}`)),
    )
  ) {
    throw new Error(
      "Existing Git hooks are preserved. Integrate them before changing core.hooksPath.",
    );
  }
  const hook = localHookConfig();
  for (const name of ["pre-commit", "pre-push"]) {
    chmodSync(join(root, ".githooks", name), 0o755);
  }
  git(["config", "--local", "core.hooksPath", ".githooks"]);
  if (hook.content !== null) {
    mkdirSync(hook.directory, { recursive: true, mode: 0o700 });
    writeFileSync(hook.path, hook.content, { mode: 0o600 });
  }
  process.stdout.write(
    "Git guards installed. Local Codex Stop hook registered.\n" +
      "Review and trust the hook in Codex Settings > Hooks (or /hooks) before relying on automatic commits.\n" +
      'Manual completion: pnpm task:commit -- "feat(game): describe the completed change"\n' +
      "Automatic pushing is not configured.\n",
  );
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Git setup failed."}\n`,
  );
  process.exitCode = 1;
}
