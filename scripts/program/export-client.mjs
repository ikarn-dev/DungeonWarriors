import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { validatedClientSource } from "../../apps/web/lib/solana/build-artifacts.mts";

// Build/generation are explicit user actions. This only validates/copies their
// existing public artifacts, and never reads a wallet/keypair or submits a tx.
export function exportClient() {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const target = join(root, "apps/purrps-game-program/target");
  const jsonPath = join(target, "idl/purrps_game.json");
  const typePath = join(target, "types/purrps_game.ts");
  for (const path of [jsonPath, typePath]) {
    const info = statSync(path);
    if (!info.isFile() || info.size > 2 * 1024 * 1024)
      throw new Error("INVALID_BUILD_ARTIFACT");
  }
  const source = validatedClientSource(
    JSON.parse(readFileSync(jsonPath, "utf8")),
    readFileSync(typePath, "utf8"),
  );
  const output = join(root, "apps/web/lib/generated/purrps_game.ts");
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, source);
}

if (import.meta.main) {
  try {
    exportClient();
    process.stdout.write("Exported the validated Anchor client artifact.\n");
  } catch {
    process.stderr.write(
      "Client export failed. Build the program first and verify its IDL, types and declared program ID.\n",
    );
    process.exitCode = 1;
  }
}
