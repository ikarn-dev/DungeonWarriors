import { after } from "next/server";
import { authenticate } from "../../../../lib/server/auth";
import { browserVerifierAddress } from "../../../../lib/server/browser-config";
import { recoverWallet } from "../../../../lib/server/browser-recovery";
import {
  browserRequestSchema,
  updateBrowserRun,
} from "../../../../lib/server/browser-run";
import {
  assertOrigin,
  body,
  json,
  route,
  sessionToken,
} from "../../../../lib/server/http";
import {
  assertAdmission,
  digest,
  runtime,
} from "../../../../lib/server/runtime";

export function GET() {
  const verifier = browserVerifierAddress();
  return json({ version: 4, ready: verifier !== null, verifier });
}
export async function POST(request: Request) {
  return route("run.browser", async () => {
    assertOrigin(request);
    const { wallet } = await authenticate(sessionToken(request));
    assertAdmission([await runtime().browser.limit(digest(wallet))]);
    const input = await body(request, browserRequestSchema, 16384);
    const result = await updateBrowserRun(wallet, input);
    // A finished run is due at once in the wallet's pending set, so recovery
    // delivers it after the response; failures stay queued for the next call.
    // Per-second steps skip the check to save Redis commands.
    if (result.finished || input.kind !== "step")
      after(() => recoverWallet(wallet));
    return json(result);
  });
}
