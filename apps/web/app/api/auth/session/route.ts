import { authenticate } from "../../../../lib/server/auth";
import {
  clientIp,
  json,
  route,
  sessionToken,
} from "../../../../lib/server/http";
import { ApiError, rateLimit } from "../../../../lib/server/runtime";
export async function GET(request: Request) {
  return route("auth.session", async () => {
    await rateLimit("session", clientIp(request));
    try {
      return json(await authenticate(sessionToken(request)));
    } catch (error) {
      if (error instanceof ApiError && error.code === "AUTH_REQUIRED")
        return json(null);
      throw error;
    }
  });
}
