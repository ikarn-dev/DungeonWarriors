import "server-only";
import { randomUUID } from "node:crypto";
import { browserGraceMs, finishBrowserReplay } from "../game/browser-replay";
import type { GameIntent } from "../game/run-transactions";
import { MARKETS } from "../solana/addresses";
import { startSession } from "./browser-run";
import { browserPendingKey, withBrowserSession } from "./browser-store";
import { readLiveRun } from "./live-run";
import { runtime, sponsorshipConfig } from "./runtime";
import { prepare, submit, validateTransaction } from "./transactions";

// Registered before broadcasting a rules-v4 reservation. Survives a page crash
// between reserving the wager, activation and starting the browser session.
export async function registerBrowserLaunch(owner: string, nonce: string) {
  const r = runtime();
  const member = `launch:${owner}:${nonce}`;
  await r.redis.set(`${r.prefix}:browser:${member}`, Date.now(), { nx: true });
  await r.redis.zadd(browserPendingKey(owner), {
    score: Date.now() + browserGraceMs,
    member,
  });
}
export async function recoverBrowserLaunch(owner: string, nonce: string) {
  const live = await readLiveRun(owner, nonce);
  if (live.run.status === "settled" || live.run.status === "refunded")
    return true;
  if (live.run.status === "absent") {
    const r = runtime();
    const issued = await r.redis.get<number>(
      `${r.prefix}:browser:launch:${owner}:${nonce}`,
    );
    return typeof issued === "number" && Date.now() - issued > 300_000;
  }
  if (live.er) {
    try {
      await withBrowserSession(owner, nonce, async (existing) => {
        const session =
          existing ??
          (await startSession(owner, nonce, randomUUID(), Date.now()));
        if (!existing)
          session.replay = finishBrowserReplay(session.replay, "unstarted");
        return { session, value: true };
      });
      return true;
    } catch {
      if (!live.er.activationExpired) return false;
    }
  }
  const market = MARKETS.find(
    ({ market: name }) => name === live.run.market,
  )?.market;
  const action: GameIntent["action"] | null =
    live.run.status === "refundReady"
      ? { kind: "abortUndelegatedReservation", nonce }
      : live.er?.activationExpired
        ? { kind: "expireDelegatedActivation", nonce }
        : live.run.status === "settlementReady" && market
          ? { kind: "settleReturnedRun", nonce, market }
          : null;
  if (!action) return false;
  const policy = sponsorshipConfig();
  const intent = {
    operation: "game",
    sponsored: false,
    playSponsor: {
      sponsor: policy.SPONSOR_PUBLIC_KEY,
      floor: policy.SPONSOR_MIN_BALANCE_LAMPORTS.toString(),
    },
    action,
  } satisfies GameIntent;
  const ready = await prepare(owner, intent);
  // These recovery actions use the sponsor as their only signer.
  validateTransaction(owner, intent, ready.transaction);
  await submit(owner, intent, ready.transaction);
  return false;
}
