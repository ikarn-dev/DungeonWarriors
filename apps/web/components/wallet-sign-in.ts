import { z } from "zod";
import { gameDeviceKey, signDeviceMessage } from "../lib/game/device-key";
import { encodeBase64, WebApiError, webApi } from "../lib/game/web-api";

const challengeSchema = z
  .object({
    challengeId: z.string().regex(/^[0-9a-f]{64}$/),
    message: z.string().max(2048),
    expiresAt: z.iso.datetime(),
  })
  .strict();

// Signs the server's domain-bound challenge after checking every field the
// wallet will display. Returns false when the request was aborted.
export async function signInWallet(
  address: string,
  signMessage: (message: Uint8Array) => Promise<Uint8Array>,
  signal: AbortSignal,
  device?: string,
): Promise<boolean> {
  const challenge = challengeSchema.parse(
    await webApi("/api/auth/challenge", { wallet: address }, signal),
  );
  const prefix = `${window.location.host} wants you to sign in with your Solana account:\n${address}\n\nSign in to Dungeon Warriors. This does not authorize transactions.\n\nURI: ${window.location.origin}\nVersion: 1\nChain ID: solana:devnet\nNonce: ${challenge.challengeId}\nIssued At: `;
  const suffix = `\nExpiration Time: ${challenge.expiresAt}`;
  if (
    !challenge.message.startsWith(prefix) ||
    !challenge.message.endsWith(suffix)
  )
    throw new WebApiError("UNEXPECTED_SIGN_IN_MESSAGE");
  const issuedAt = challenge.message.slice(prefix.length, -suffix.length);
  if (
    !z.iso.datetime().safeParse(issuedAt).success ||
    Date.parse(challenge.expiresAt) - Date.parse(issuedAt) !== 300000
  )
    throw new WebApiError("UNEXPECTED_SIGN_IN_MESSAGE");
  const signature = await signMessage(
    new TextEncoder().encode(challenge.message),
  );
  if (signal.aborted) return false;
  await webApi(
    "/api/auth/verify",
    {
      challengeId: challenge.challengeId,
      signature: encodeBase64(signature),
      ...(device ? { device } : {}),
    },
    signal,
  );
  return !signal.aborted;
}

export async function signInGameDevice(wallet: string, signal: AbortSignal) {
  const key = await gameDeviceKey(wallet);
  if (!key || signal.aborted) return false;
  return signInWallet(
    wallet,
    (message) => signDeviceMessage(key, message),
    signal,
    key.address,
  ).catch((error: unknown) => {
    if (error instanceof WebApiError && error.code === "INVALID_GAME_DEVICE")
      return false;
    throw error;
  });
}
