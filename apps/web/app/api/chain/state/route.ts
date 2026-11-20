import { z } from "zod";
import { authenticate } from "../../../../lib/server/auth";
import { readState, stateInput, u64Input } from "../../../../lib/server/chain";
import {
  assertOrigin,
  body,
  clientIp,
  json,
  route,
  sessionToken,
} from "../../../../lib/server/http";
import { readLiveRun } from "../../../../lib/server/live-run";
import { rateLimit } from "../../../../lib/server/runtime";

const input = z.union([
  stateInput,
  z.strictObject({ kind: z.literal("liveRun"), nonce: u64Input }),
]);
export async function POST(request: Request) {
  return route("chain.state", async () => {
    assertOrigin(request);
    await rateLimit("state", clientIp(request));
    const session = await authenticate(sessionToken(request));
    await rateLimit("state-wallet", clientIp(request), session.wallet);
    const requestState = await body(request, input);
    return json(
      requestState.kind === "liveRun"
        ? await readLiveRun(session.wallet, requestState.nonce)
        : await readState(session.wallet, requestState),
    );
  });
}
