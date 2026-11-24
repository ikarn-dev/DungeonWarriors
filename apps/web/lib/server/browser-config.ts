import "server-only";
import { Keypair } from "@solana/web3.js";
import { ApiError } from "./runtime";

export function browserVerifierKey() {
  const { BROWSER_VERIFIER_SECRET_KEY: value, SPONSOR_PUBLIC_KEY: sponsor } =
    process.env;
  if (!value) throw new ApiError("VERIFIER_NOT_CONFIGURED", 503);
  const bytes = Buffer.from(value, "base64");
  if (bytes.length !== 64 || bytes.toString("base64") !== value)
    throw new ApiError("VERIFIER_NOT_CONFIGURED", 503);
  const key = Keypair.fromSecretKey(bytes);
  if (key.publicKey.toBase58() === sponsor)
    throw new ApiError("VERIFIER_MISMATCH", 503);
  return key;
}
export function browserVerifierAddress(): string | null {
  try {
    return browserVerifierKey().publicKey.toBase58();
  } catch {
    return null;
  }
}
export function browserConfigured() {
  return browserVerifierAddress() !== null;
}
