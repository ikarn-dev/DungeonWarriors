import { authenticate } from "../../../../lib/server/auth";
import { readState, stateInput } from "../../../../lib/server/chain";
import {
  assertOrigin,
  body,
  clientIp,
  json,
  route,
  sessionToken,
} from "../../../../lib/server/http";
import { rateLimit } from "../../../../lib/server/runtime";
export async function POST(request: Request) {
  return route(async () => {
    assertOrigin(request);
    await rateLimit("state", clientIp(request));
    const session = await authenticate(sessionToken(request));
    await rateLimit("state-wallet", clientIp(request), session.wallet);
    return json(
      await readState(session.wallet, await body(request, stateInput)),
    );
  });
}
