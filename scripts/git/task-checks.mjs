import { existsSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { checked, fileInfo, git, root } from "./repository.mjs";

export function checkChangedFiles(paths) {
  git(["diff", "--check", "--", ...paths]);
  const existing = paths.filter((path) => fileInfo(path)?.isFile());
  const biomeFiles = existing.filter((path) =>
    /\.(?:[cm]?js|jsx|tsx?|jsonc?|css)$/.test(path),
  );
  if (biomeFiles.length > 0) {
    checked(process.execPath, [
      join(root, "node_modules/@biomejs/biome/bin/biome"),
      "check",
      ...biomeFiles,
    ]);
  }
  for (const path of existing.filter((name) => /\.mjs$/.test(name))) {
    checked(process.execPath, ["--check", join(root, path)]);
  }
  if (
    paths.some((path) =>
      /(?:\.[cm]?[jt]sx?|(?:^|\/)(?:package|tsconfig[^/]*)\.json)$/.test(path),
    )
  ) {
    const compiler = join(root, "apps/web/node_modules/typescript/bin/tsc");
    if (!existsSync(compiler))
      throw new Error(
        "TypeScript is unavailable. Install the approved dependencies first.",
      );
    checked(process.execPath, [
      compiler,
      "--noEmit",
      "--incremental",
      "false",
      "--project",
      join(root, "apps/web/tsconfig.json"),
    ]);
  }
  if (
    paths.some(
      (path) =>
        path.startsWith("apps/purrps-game-program/") &&
        /\.(?:rs|toml)$/.test(path),
    )
  ) {
    checked("rustup", [
      "run",
      "1.89.0",
      "cargo",
      "fmt",
      "--manifest-path",
      join(root, "apps/purrps-game-program/Cargo.toml"),
      "--all",
      "--",
      "--check",
    ]);
  }
}
