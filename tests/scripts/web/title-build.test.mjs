import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const output = new URL("../../../apps/web/.next/", import.meta.url);
const readPage = (name) =>
  readFileSync(new URL(`server/app/${name}.html`, output), "utf8");

test("the prerendered title has Start in the frame and no notification grid item", () => {
  const html = readPage("index");
  const main = html.match(
    /<main\b[^>]*data-screen="title"[^>]*>(.*?)<\/main>/s,
  )?.[1];
  assert.ok(main, "Missing the title screen");
  assert.match(
    main,
    /class="title-frame".*class="title-start"[^>]*>Start<\/button>/s,
  );
  assert.doesNotMatch(main, /wallet-picker|aria-label="Notifications/);
  assert.match(html, /aria-label="Notifications/);
});

test("prerendered entry routes reference assets emitted by their own build", () => {
  for (const page of ["index", "starter"]) {
    const html = readPage(page);
    const assets = [
      ...html.matchAll(
        /(?:href|src)="\/_next\/(static\/[^"?]+\.(?:css|js))(?:\?[^"]*)?"/g,
      ),
    ];
    assert.ok(assets.some(([, path]) => path.endsWith(".css")));
    assert.ok(assets.some(([, path]) => path.endsWith(".js")));
    for (const [, path] of assets)
      assert.ok(readFileSync(new URL(path, output)).length > 0, path);
  }
});
