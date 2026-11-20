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
import { intentSchema, prepare } from "../../../../lib/server/transactions";
export async function POST(request: Request) {
  return route("tx.prepare", async () => {
    assertOrigin(request);
    await rateLimit("prepare", clientIp(request));
    const session = await authenticate(sessionToken(request));
    await rateLimit("prepare-wallet", clientIp(request), session.wallet);
    return json(
      await prepare(session.wallet, await body(request, intentSchema)),
    );
  });
}
