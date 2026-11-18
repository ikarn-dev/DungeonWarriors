import { authenticate } from "../../../../lib/server/auth";
import {
  clientIp,
  json,
  route,
  sessionToken,
} from "../../../../lib/server/http";
import { rateLimit } from "../../../../lib/server/runtime";
export async function GET(request: Request) {
  return route(async () => {
    await rateLimit("session", clientIp(request));
    return json(await authenticate(sessionToken(request)));
  });
}
