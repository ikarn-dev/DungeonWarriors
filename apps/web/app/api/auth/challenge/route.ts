import { challengeInput, createChallenge } from "../../../../lib/server/auth";
import {
  assertOrigin,
  body,
  clientIp,
  json,
  route,
} from "../../../../lib/server/http";
import { rateLimit } from "../../../../lib/server/runtime";
export async function POST(request: Request) {
  return route(async () => {
    assertOrigin(request);
    await rateLimit("challenge", clientIp(request));
    const input = await body(request, challengeInput);
    await rateLimit("challenge-wallet", clientIp(request), input.wallet);
    return json(await createChallenge(input.wallet));
  });
}
