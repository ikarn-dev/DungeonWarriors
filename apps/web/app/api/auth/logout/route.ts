import { logout } from "../../../../lib/server/auth";
import {
  assertOrigin,
  clientIp,
  cookie,
  json,
  route,
  sessionToken,
} from "../../../../lib/server/http";
import { rateLimit } from "../../../../lib/server/runtime";
export async function POST(request: Request) {
  return route("auth.logout", async () => {
    assertOrigin(request);
    await rateLimit("logout", clientIp(request));
    await logout(sessionToken(request));
    return json({ loggedOut: true }, 200, { "Set-Cookie": cookie("", 0) });
  });
}
