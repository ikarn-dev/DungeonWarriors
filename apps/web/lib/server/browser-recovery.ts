import "server-only";
import { decodeBrowser } from "../game/browser-replay";
import { recoverBrowserLaunch } from "./browser-launch";
import { deliverBrowserRun } from "./browser-settlement";
import { browserPendingKey, browserSessionSchema } from "./browser-store";
import { runtime } from "./runtime";
import { observeDuration } from "./telemetry";

const BATCH = 3;
// Finishes this wallet's due work: an unstarted launch, or a run whose tab
// closed. Called after the wallet's own requests, so a returning player always
// settles; nothing runs on a schedule. Failures stay queued for the next call.
export async function recoverWallet(owner: string): Promise<void> {
  const r = runtime();
  const pending = browserPendingKey(owner);
  const due = await r.redis.zrange<string[]>(pending, 0, Date.now(), {
    byScore: true,
    offset: 0,
    count: BATCH,
  });
  for (const member of due) {
    const started = performance.now();
    try {
      await recoverMember(owner, pending, member);
      observeDuration("run.settle", started, "ok");
    } catch {
      // The member stays queued; the wallet's next request retries it.
      observeDuration("run.settle", started, "pending");
    }
  }
}

async function recoverMember(owner: string, pending: string, member: string) {
  const r = runtime();
  const launch = /^launch:[1-9A-HJ-NP-Za-km-z]{32,44}:([0-9]{1,20})$/.exec(
    member,
  );
  if (launch?.[1]) {
    if (await recoverBrowserLaunch(owner, launch[1])) {
      await r.redis.zrem(pending, member);
      await r.redis.del(`${r.prefix}:browser:${member}`);
    }
    return;
  }
  const stored = await r.redis.get<string>(member);
  if (!stored) {
    await r.redis.zrem(pending, member);
    return;
  }
  const session = browserSessionSchema.parse(decodeBrowser(stored.slice(1)));
  if (session.owner === owner) await deliverBrowserRun(owner, session.nonce);
}
