import { verifyChallenge, verifyInput } from "../../../../lib/server/auth";
import {
  assertOrigin,
  body,
  clientIp,
  cookie,
  json,
  route,
} from "../../../../lib/server/http";
import { rateLimit } from "../../../../lib/server/runtime";
export async function POST(request: Request) {
  return route("auth.verify", async () => {
    assertOrigin(request);
    await rateLimit("verify", clientIp(request));
    const input = await body(request, verifyInput);
    const result = await verifyChallenge(
      input.challengeId,
      input.signature,
      input.device,
    );
    return json(result.session, 200, { "Set-Cookie": cookie(result.token) });
  });
}
