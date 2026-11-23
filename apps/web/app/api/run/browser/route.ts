import { after } from "next/server";
import { browserConfigured } from "../../../../lib/server/browser-config";
import { authenticate } from "../../../../lib/server/auth";
import { browserRequestSchema, updateBrowserRun } from "../../../../lib/server/browser-run";
import { deliverBrowserRun } from "../../../../lib/server/browser-settlement";
import { assertOrigin, body, json, route, sessionToken } from "../../../../lib/server/http";
import { assertAdmission, digest, runtime } from "../../../../lib/server/runtime";

export function GET() {
  return json({ version: 4, ready: browserConfigured() });
}
export async function POST(request: Request) {
  return route("run.browser", async () => {
    assertOrigin(request);
    const { wallet } = await authenticate(sessionToken(request));
    assertAdmission([await runtime().browser.limit(digest(wallet))]);
    const input = await body(request, browserRequestSchema, 16384);
    const result = await updateBrowserRun(wallet, input);
    // The durable pending set also allows cron to pick this up after a killed tab.
    if (result.finished) after(async () => {
      try { await deliverBrowserRun(wallet, input.nonce); }
      catch (error) { if (error instanceof Error) console.error("Browser settlement pending", error.name); }
    });
    return json(result);
  });
}
