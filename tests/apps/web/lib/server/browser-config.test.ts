import { Keypair } from "@solana/web3.js";
import { afterEach, expect, it, vi } from "vitest";
import {
  browserConfigured,
  browserVerifierAddress,
} from "../../../../../apps/web/lib/server/browser-config";

afterEach(() => vi.unstubAllEnvs());

it("exposes the exact dedicated public authority needed for publication", () => {
  const verifier = Keypair.generate();
  vi.stubEnv(
    "BROWSER_VERIFIER_SECRET_KEY",
    Buffer.from(verifier.secretKey).toString("base64"),
  );
  vi.stubEnv("SPONSOR_PUBLIC_KEY", Keypair.generate().publicKey.toBase58());
  expect(browserConfigured()).toBe(true);
  expect(browserVerifierAddress()).toBe(verifier.publicKey.toBase58());
});

it("reports unready for missing, malformed or sponsor-reused verifier keys", () => {
  vi.stubEnv("BROWSER_VERIFIER_SECRET_KEY", "");
  expect(browserConfigured()).toBe(false);
  expect(browserVerifierAddress()).toBeNull();
  vi.stubEnv("BROWSER_VERIFIER_SECRET_KEY", "not a key");
  expect(browserVerifierAddress()).toBeNull();
  const sponsor = Keypair.generate();
  vi.stubEnv("SPONSOR_PUBLIC_KEY", sponsor.publicKey.toBase58());
  vi.stubEnv(
    "BROWSER_VERIFIER_SECRET_KEY",
    Buffer.from(sponsor.secretKey).toString("base64"),
  );
  expect(browserVerifierAddress()).toBeNull();
});
