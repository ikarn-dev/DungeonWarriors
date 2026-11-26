import { logout } from "../../../../lib/server/auth";
import {
  assertOrigin,
  clientIp,
  cookie,
  json,
  optionalSessionToken,
  route,
} from "../../../../lib/server/http";
import { rateLimit } from "../../../../lib/server/runtime";
export async function POST(request: Request) {
  return route("auth.logout", async () => {
    assertOrigin(request);
    const token = optionalSessionToken(request);
    if (token !== null) {
      await rateLimit("logout", clientIp(request));
      await logout(token);
    }
    return json({ loggedOut: true }, 200, { "Set-Cookie": cookie("", 0) });
  });
}
