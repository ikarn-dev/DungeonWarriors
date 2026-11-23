import { timingSafeEqual } from "node:crypto";
import { recoverBrowserLaunch } from "../../../../lib/server/browser-launch";
import { publicKeySchema } from "../../../../lib/solana/addresses";
import { deliverBrowserRun } from "../../../../lib/server/browser-settlement";
import { browserPendingKey, browserSessionSchema } from "../../../../lib/server/browser-store";
import { decodeBrowser } from "../../../../lib/game/browser-replay";
import { ApiError, digest, runtime } from "../../../../lib/server/runtime";
import { json, route } from "../../../../lib/server/http";

export const maxDuration = 60;
export async function GET(request: Request) {
  return route("run.settle", async () => {
    const { CRON_SECRET: secret } = process.env;
    if (!secret || secret.length < 32) throw new ApiError("CRON_NOT_CONFIGURED", 503);
    if (!timingSafeEqual(Buffer.from(digest(request.headers.get("authorization") ?? "")),
      Buffer.from(digest(`Bearer ${secret}`)))) throw new ApiError("AUTH_REQUIRED", 401);
    const r = runtime();
    const keys = await r.redis.zrange<string[]>(browserPendingKey(), 0, Date.now(), { byScore: true, offset: 0, count: 5 });
    let pending = 0;
    for (const key of keys) {
      const launch = /^launch:([1-9A-HJ-NP-Za-km-z]{32,44}):([0-9]{1,20})$/.exec(key);
      if (launch?.[1] && launch[2]) {
        try {
          const owner = publicKeySchema.parse(launch[1]);
          if (await recoverBrowserLaunch(owner, launch[2])) {
            await r.redis.zrem(browserPendingKey(), key);
            await r.redis.del(`${r.prefix}:browser:${key}`);
          }
        } catch { pending++; }
        continue;
      }
      const value = await r.redis.get<string>(key);
      if (!value) { await r.redis.zrem(browserPendingKey(), key); continue; }
      const session = browserSessionSchema.parse(decodeBrowser(value.slice(1)));
      try { await deliverBrowserRun(session.owner, session.nonce); }
      catch { pending++; }
    }
    return json({ checked: keys.length, pending });
  });
}
