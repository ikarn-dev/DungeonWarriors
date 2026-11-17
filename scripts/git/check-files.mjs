import { readFileSync } from "node:fs";
import process from "node:process";
import {
  assertPublishable,
  git,
  maxFileBytes,
  pathsFrom,
} from "./repository.mjs";

function indexEntries() {
  return pathsFrom(git(["ls-files", "--stage", "-z"])).map((record) => {
    const tab = record.indexOf("\t");
    if (tab < 0) throw new Error("Invalid index record.");
    const [mode, object, stage] = record.slice(0, tab).split(" ");
    if (stage !== "0")
      throw new Error("Resolve index conflicts before committing.");
    return { mode, object, path: record.slice(tab + 1) };
  });
}

function treeEntries(object) {
  return pathsFrom(git(["ls-tree", "-r", "-z", `${object}^{tree}`])).map(
    (record) => {
      const tab = record.indexOf("\t");
      if (tab < 0) throw new Error("Invalid tree record.");
      const [mode, , entryObject] = record.slice(0, tab).split(" ");
      return { mode, object: entryObject, path: record.slice(tab + 1) };
    },
  );
}

function validateEntries(entries) {
  assertPublishable(entries.map((entry) => entry.path));
  if (entries.length === 0) return;
  const result = git(
    ["cat-file", "--batch-check=%(objecttype) %(objectsize)"],
    {
      input: `${entries.map((entry) => entry.object).join("\n")}\n`,
    },
  )
    .trimEnd()
    .split("\n");
  if (result.length !== entries.length)
    throw new Error("Incomplete Git object metadata.");
  for (const [index, entry] of entries.entries()) {
    const row = result[index];
    if (row === undefined) throw new Error("Missing Git object metadata.");
    const [type, bytes] = row.split(" ");
    if (
      !["100644", "100755", "120000"].includes(entry.mode) ||
      type !== "blob"
    ) {
      throw new Error(
        "Submodules and unsupported Git entries require explicit review.",
      );
    }
    if (!bytes || !/^\d+$/.test(bytes) || Number(bytes) > maxFileBytes) {
      throw new Error(
        "File exceeds the 50 MiB source-file limit: " +
          JSON.stringify(entry.path),
      );
    }
  }
}

function checkPush() {
  const input = readFileSync(0, "utf8");
  if (input.length > 1024 * 1024) throw new Error("Too many push references.");
  for (const line of input.split(/\r?\n/).filter(Boolean)) {
    const parts = line.split(" ");
    const object = parts[1];
    if (
      parts.length !== 4 ||
      !object ||
      !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(object)
    ) {
      throw new Error("Invalid pre-push reference.");
    }
    if (!/^0+$/.test(object)) validateEntries(treeEntries(object));
  }
}

try {
  if (process.argv.includes("--push")) {
    // Validate each outgoing tip; this deliberately does not rewrite old history.
    checkPush();
  } else {
    validateEntries(indexEntries());
    git(["diff", "--cached", "--check"]);
  }
} catch (error) {
  process.stderr.write(
    (error instanceof Error ? error.message : "Git policy check failed.") +
      "\n",
  );
  process.exitCode = 1;
}
