import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const output = fileURLToPath(
  new URL("../../../apps/web/.next/", import.meta.url),
);
test("production CSS contains compiled layout utilities and no unresolved Tailwind directives", () => {
  const directory = join(output, "static/css");
  const files = readdirSync(directory).filter((name) => name.endsWith(".css"));
  assert.ok(files.length > 0);
  const css = files
    .map((name) => readFileSync(join(directory, name), "utf8"))
    .join("\n");
  assert.doesNotMatch(
    css,
    /@(?:theme|tailwind|apply|utility|custom-variant)\b/,
  );
  assert.match(css, /\.flex\s*\{/);
  assert.match(css, /\.flex-col\s*\{/);
  assert.match(css, /@font-face/);
});
test("the prerendered page references emitted local CSS", () => {
  const html = readFileSync(join(output, "server/app/index.html"), "utf8");
  const sheets = [
    ...html.matchAll(
      /href="(\/_next\/static\/css\/[^"?]+\.css)(?:\?[^"<>]*)?"/g,
    ),
  ];
  assert.ok(sheets.length > 0);
  for (const sheet of sheets)
    assert.ok(
      readFileSync(join(output, sheet[1].slice("/_next/".length))).length > 0,
    );
});
test("server credential configuration is absent from browser chunks", () => {
  const visit = (directory) =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? visit(join(directory, entry.name))
        : [join(directory, entry.name)],
    );
  for (const file of visit(join(output, "static")).filter((path) =>
    path.endsWith(".js"),
  )) {
    const value = readFileSync(file, "utf8");
    assert.equal(
      /HELIUS_DEVNET_RPC_URL|UPSTASH_REDIS_REST_TOKEN|SPONSOR_SECRET_KEY|SENTRY_DSN/.test(
        value,
      ),
      false,
      "Server credential code reached a browser chunk",
    );
  }
});
