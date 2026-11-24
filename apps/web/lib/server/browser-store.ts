import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  browserGraceMs,
  browserReplaySchema,
  decodeBrowser,
  encodeBrowser,
} from "../game/browser-replay";
import { publicKeySchema } from "../solana/addresses";
import { ApiError, runtime } from "./runtime";

const decimal = z.string().regex(/^[0-9]{1,20}$/);
export const witnessSchema = z.object({
  sequence: decimal,
  price: decimal,
  exponent: z.number().int().min(-18).max(18),
  publishedAtSeconds: decimal,
  postedSlot: decimal,
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export const browserSessionSchema = z
  .object({
    owner: publicKeySchema,
    nonce: decimal,
    client: z.uuid(),
    snapshotHash: z.string().regex(/^[a-f0-9]{64}$/),
    market: z.enum(["BTC", "ETH", "SOL"]),
    cat: z.enum(["collector", "acrobat", "guardian", "sprinter"]),
    catLevel: z.number().int().min(1).max(5),
    stake: decimal,
    maxGross: decimal,
    keyExpiresAt: z.number().int(),
    source: z.object({
      account: publicKeySchema,
      validator: publicKeySchema,
      writeAuthority: publicKeySchema,
      maxAgeSeconds: z.number().int().positive(),
      maxFutureSkewSeconds: z.number().int().nonnegative(),
      minExponent: z.number().int(),
      maxExponent: z.number().int(),
    }),
    witnesses: z.array(witnessSchema).min(1).max(16),
    replay: browserReplaySchema,
    delivery: z
      .object({
        transaction: z.string().max(2400),
        signature: z.string().min(64).max(88),
        network: z.enum(["base", "er"]),
        lastValidBlockHeight: z.number().int(),
        sentAt: z.number().int(),
      })
      .nullable()
      .default(null),
    settled: z.boolean(),
  })
  .strict();
export type BrowserSession = z.infer<typeof browserSessionSchema>;
// Unfinished work per wallet. The wallet's own next request drives recovery,
// so no scheduled worker is needed.
export const browserPendingKey = (owner: string) =>
  `${runtime().prefix}:browser:pending:${publicKeySchema.parse(owner)}`;
export const browserSessionKey = (owner: string, nonce: string) =>
  `${runtime().prefix}:browser:run:${publicKeySchema.parse(owner)}:${decimal.parse(nonce)}`;

export async function withBrowserSession<T>(
  owner: string,
  nonce: string,
  work: (
    session: BrowserSession | null,
  ) => Promise<{ session: BrowserSession; value: T }>,
): Promise<T> {
  const r = runtime();
  const key = browserSessionKey(owner, nonce);
  const token = randomUUID();
  const locked = await r.redis.set(`${key}:lock`, token, {
    nx: true,
    px: 30_000,
  });
  if (!locked) throw new ApiError("RUN_BUSY", 409);
  try {
    const stored = await r.redis.get<string>(key);
    const session =
      stored === null
        ? null
        : browserSessionSchema.parse(decodeBrowser(stored.slice(1)));
    const result = await work(session);
    if (result.session.owner !== owner || result.session.nonce !== nonce)
      throw new ApiError("RUN_SCOPE_MISMATCH", 409);
    // The lock value fences delayed requests after a lease expires. Save state
    // and scheduling together so a successful write cannot lose its recovery job.
    const saved = await r.redis.eval(
      "if redis.call('GET',KEYS[1])~=ARGV[1] then return 0 end; redis.call('SET',KEYS[2],ARGV[2]); if ARGV[3]=='1' then redis.call('ZREM',KEYS[3],KEYS[2]); redis.call('EXPIRE',KEYS[2],86400) else redis.call('ZADD',KEYS[3],ARGV[4],KEYS[2]) end; return 1",
      [`${key}:lock`, key, browserPendingKey(owner)],
      [
        token,
        `!${encodeBrowser(result.session)}`,
        result.session.settled ? "1" : "0",
        result.session.replay.stop
          ? Date.now()
          : result.session.replay.lastSeenAt + browserGraceMs,
      ],
    );
    if (saved !== 1) throw new ApiError("RUN_BUSY", 409);
    return result.value;
  } finally {
    await r.redis.eval(
      "if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) end; return 0",
      [`${key}:lock`],
      [token],
    );
  }
}
