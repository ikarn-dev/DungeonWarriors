import "server-only";
import { createPublicKey, randomBytes, verify } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { z } from "zod";
import { publicKeySchema } from "../solana/addresses.ts";
import { ApiError, digest, runtime } from "./runtime";

export const challengeInput = z.object({ wallet: publicKeySchema }).strict();
export const verifyInput = z
  .object({
    challengeId: z.string().regex(/^[0-9a-f]{64}$/),
    signature: z.string().length(88),
  })
  .strict();
const challengeSchema = z
  .object({
    wallet: publicKeySchema,
    message: z.string().max(2048),
    expiresAt: z.number().int(),
  })
  .strict();
const sessionSchema = z
  .object({
    wallet: publicKeySchema,
    createdAt: z.number().int(),
    absoluteExpiresAt: z.number().int(),
  })
  .strict();
export function verifyWalletSignature(
  wallet: string,
  message: Uint8Array,
  signature: Uint8Array,
): boolean {
  if (signature.length !== 64) return false;
  try {
    const key = new PublicKey(wallet);
    if (!PublicKey.isOnCurve(key.toBytes())) return false;
    const publicKey = createPublicKey({
      key: Buffer.concat([
        Buffer.from("302a300506032b6570032100", "hex"),
        key.toBuffer(),
      ]),
      format: "der",
      type: "spki",
    });
    return verify(null, message, publicKey, signature);
  } catch {
    return false;
  }
}
export async function createChallenge(wallet: string) {
  const r = runtime();
  const now = Date.now();
  const expiresAt = now + 300000;
  const challengeId = randomBytes(32).toString("hex");
  const message = `${new URL(r.config.APP_ORIGIN).host} wants you to sign in with your Solana account:\n${wallet}\n\nSign in to PURRPS. This does not authorize transactions.\n\nURI: ${r.config.APP_ORIGIN}\nVersion: 1\nChain ID: solana:devnet\nNonce: ${challengeId}\nIssued At: ${new Date(now).toISOString()}\nExpiration Time: ${new Date(expiresAt).toISOString()}`;
  if (!PublicKey.isOnCurve(new PublicKey(wallet).toBytes()))
    throw new ApiError("INVALID_WALLET", 400);
  const stored = await r.redis.set(
    `${r.prefix}:challenge:${challengeId}`,
    { wallet, message, expiresAt },
    { ex: 300, nx: true },
  );
  if (stored !== "OK") throw new ApiError("CHALLENGE_STORAGE_FAILED", 503);
  return { challengeId, message, expiresAt: new Date(expiresAt).toISOString() };
}
export async function verifyChallenge(challengeId: string, encoded: string) {
  const r = runtime();
  const key = `${r.prefix}:challenge:${challengeId}`;
  const parsed = challengeSchema.safeParse(await r.redis.get(key));
  if (!parsed.success || parsed.data.expiresAt <= Date.now())
    throw new ApiError("CHALLENGE_EXPIRED", 401);
  const signature = Buffer.from(encoded, "base64");
  if (
    signature.toString("base64") !== encoded ||
    !verifyWalletSignature(
      parsed.data.wallet,
      new TextEncoder().encode(parsed.data.message),
      signature,
    )
  )
    throw new ApiError("INVALID_SIGNATURE", 401);
  const consumed = challengeSchema.safeParse(await r.redis.getdel(key));
  if (
    !consumed.success ||
    consumed.data.message !== parsed.data.message ||
    consumed.data.expiresAt <= Date.now()
  )
    throw new ApiError("CHALLENGE_USED", 401);
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  const session = {
    wallet: parsed.data.wallet,
    createdAt: now,
    absoluteExpiresAt: now + 43200000,
  };
  const stored = await r.redis.set(
    `${r.prefix}:session:${digest(token)}`,
    session,
    {
      ex: 1800,
      nx: true,
    },
  );
  if (stored !== "OK") throw new ApiError("SESSION_STORAGE_FAILED", 503);
  return { token, session };
}
const touchSession = `local value=redis.call('GET',KEYS[1]); if not value then return false end; local record=cjson.decode(value); local ttl=math.min(1800,math.floor((record.absoluteExpiresAt-tonumber(ARGV[1]))/1000)); if ttl<=0 then redis.call('DEL',KEYS[1]); return false end; redis.call('EXPIRE',KEYS[1],ttl); return value`;
export async function authenticate(token: string) {
  const r = runtime();
  const record = await r.redis.eval(
    touchSession,
    [`${r.prefix}:session:${digest(token)}`],
    [Date.now()],
  );
  const parsed = sessionSchema.safeParse(record);
  if (
    !parsed.success ||
    parsed.data.absoluteExpiresAt <= Date.now() ||
    parsed.data.createdAt > Date.now() ||
    parsed.data.absoluteExpiresAt > parsed.data.createdAt + 43200000
  )
    throw new ApiError("AUTH_REQUIRED", 401);
  return parsed.data;
}
export async function logout(token: string) {
  const r = runtime();
  await r.redis.del(`${r.prefix}:session:${digest(token)}`);
}
