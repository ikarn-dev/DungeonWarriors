import type { WalletContextState } from "@solana/wallet-adapter-react";
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

type WalletSigners = Partial<
  Pick<WalletContextState, "signIn" | "signMessage">
>;
const statement =
  "Sign in to Dungeon Warriors. This does not authorize transactions.";
const chainId = "solana:devnet";

export function canSignInWallet({ signIn, signMessage }: WalletSigners) {
  return signIn !== undefined || signMessage !== undefined;
}

// Signs the server's domain-bound challenge after checking every field the
// wallet will display. Returns false when the request was aborted.
export async function signInWallet(
  address: string,
  { signIn, signMessage }: WalletSigners,
  signal: AbortSignal,
  device?: string,
): Promise<boolean> {
  if (signIn === undefined && signMessage === undefined)
    throw new WebApiError("MESSAGE_SIGNING_REQUIRED");
  const challenge = challengeSchema.parse(
    await webApi("/api/auth/challenge", { wallet: address }, signal),
  );
  const { host: domain, origin: uri } = window.location;
  const prefix = `${domain} wants you to sign in with your Solana account:\n${address}\n\n${statement}\n\nURI: ${uri}\nVersion: 1\nChain ID: ${chainId}\nNonce: ${challenge.challengeId}\nIssued At: `;
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
  if (signal.aborted) return false;
  const message = new TextEncoder().encode(challenge.message);
  let signature: Uint8Array;
  try {
    if (signIn !== undefined) {
      const result = await signIn({
        domain,
        address,
        statement,
        uri,
        version: "1",
        chainId,
        nonce: challenge.challengeId,
        issuedAt,
        expirationTime: challenge.expiresAt,
      });
      if (result.account.address !== address)
        throw new WebApiError("SIGN_IN_ACCOUNT_CHANGED");
      if (
        result.signedMessage.length !== message.length ||
        result.signedMessage.some((byte, index) => byte !== message[index])
      )
        throw new WebApiError("UNEXPECTED_SIGN_IN_MESSAGE");
      signature = result.signature;
    } else if (signMessage !== undefined) {
      signature = await signMessage(message);
    } else {
      throw new WebApiError("MESSAGE_SIGNING_REQUIRED");
    }
  } catch (error) {
    // Wallet Adapter wraps the provider's RPC error in WalletError.error.
    const cause =
      typeof error === "object" && error !== null && "error" in error
        ? error.error
        : error;
    if (typeof cause === "object" && cause !== null && "code" in cause) {
      if (cause.code === 4100)
        throw new WebApiError("WALLET_SIGN_IN_UNAUTHORIZED");
      if (cause.code === 4001)
        throw new WebApiError("WALLET_SIGN_IN_CANCELLED");
    }
    throw error;
  }
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
    { signMessage: (message) => signDeviceMessage(key, message) },
    signal,
    key.address,
  ).catch((error: unknown) => {
    if (error instanceof WebApiError && error.code === "INVALID_GAME_DEVICE")
      return false;
    throw error;
  });
}
