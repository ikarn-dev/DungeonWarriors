import { authenticate } from "../../../../lib/server/auth";
import {
  assertOrigin,
  body,
  clientIp,
  json,
  route,
  sessionToken,
} from "../../../../lib/server/http";
import { rateLimit } from "../../../../lib/server/runtime";
import { submit, submitInput } from "../../../../lib/server/transactions";
export async function POST(request: Request) {
  return route("tx.submit", async () => {
    assertOrigin(request);
    await rateLimit("submit", clientIp(request));
    const session = await authenticate(sessionToken(request));
    await rateLimit("submit-wallet", clientIp(request), session.wallet);
    const input = await body(request, submitInput, 4096);
    return json(
      await submit(session.wallet, input.intent, input.transaction),
      202,
    );
  });
}
