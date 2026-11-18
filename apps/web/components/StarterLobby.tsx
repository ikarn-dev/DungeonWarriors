"use client";
import { useWallet } from "@solana/wallet-adapter-react";
import { VersionedTransaction } from "@solana/web3.js";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { verifyManifestBinding } from "../lib/game/assets";
import { decodeLobbyState, type LobbyState } from "../lib/game/lobby-state";
import {
  type LobbyIntent,
  validatePreparedTransaction,
} from "../lib/game/transaction-intents";
import {
  decodeBase64,
  encodeBase64,
  readWebJson,
  WebApiError,
  webApi,
  webErrorMessage,
} from "../lib/game/web-api";
import CatCollection from "./CatCollection";

const button =
  "min-h-11 rounded-md border border-current px-4 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50";
const challengeSchema = z
  .object({
    challengeId: z.string().regex(/^[0-9a-f]{64}$/),
    message: z.string().max(2048),
    expiresAt: z.iso.datetime(),
  })
  .strict();
const preparedSchema = z
  .object({
    transaction: z.string().max(1800),
    blockhash: z.string(),
    lastValidBlockHeight: z.number().int(),
    operationId: z.string(),
  })
  .strict();
const submittedSchema = z
  .object({
    status: z.literal("requested"),
    signature: z.string().min(64).max(88),
    unknownResponse: z.boolean(),
  })
  .strict();
export default function StarterPanel() {
  const wallet = useWallet();
  const address = wallet.publicKey?.toBase58() ?? null;
  const [authenticated, setAuthenticated] = useState(false);
  const [state, setState] = useState<LobbyState | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Connect a wallet to begin.");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const work = useRef<AbortController | null>(null);
  useEffect(() => {
    work.current?.abort();
    setBusy(false);
    setAuthenticated(false);
    setState(null);
    setPending(null);
    setError(null);
    setMessage(
      address === null
        ? "Connect a wallet to begin."
        : "Sign in with this wallet to continue.",
    );
    return () => work.current?.abort();
  }, [address]);
  async function reload(signal?: AbortSignal) {
    if (address === null) return;
    const value = await webApi<unknown>(
      "/api/chain/state",
      { kind: "wallet" },
      signal,
    );
    if (!signal?.aborted) setState(decodeLobbyState(value, address));
  }
  async function perform(action: (signal: AbortSignal) => Promise<void>) {
    work.current?.abort();
    const controller = new AbortController();
    work.current = controller;
    setBusy(true);
    setError(null);
    try {
      await action(controller.signal);
    } catch (failure) {
      if (failure instanceof WebApiError && failure.code === "AUTH_REQUIRED")
        setAuthenticated(false);
      if (!controller.signal.aborted)
        setError(
          failure instanceof WebApiError
            ? failure.code
            : "WALLET_OR_ACCOUNT_REQUEST_FAILED",
        );
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  async function signIn(signal: AbortSignal) {
    if (address === null || wallet.signMessage === undefined)
      throw new WebApiError("MESSAGE_SIGNING_REQUIRED");
    const challenge = challengeSchema.parse(
      await webApi("/api/auth/challenge", { wallet: address }, signal),
    );
    const prefix = `${window.location.host} wants you to sign in with your Solana account:\n${address}\n\nSign in to PURRPS. This does not authorize transactions.\n\nURI: ${window.location.origin}\nVersion: 1\nChain ID: solana:devnet\nNonce: ${challenge.challengeId}\nIssued At: `;
    if (
      !challenge.message.startsWith(prefix) ||
      !challenge.message.endsWith(`\nExpiration Time: ${challenge.expiresAt}`)
    )
      throw new WebApiError("UNEXPECTED_SIGN_IN_MESSAGE");
    const suffix = `\nExpiration Time: ${challenge.expiresAt}`;
    const issuedAt = challenge.message.slice(prefix.length, -suffix.length);
    if (
      !z.iso.datetime().safeParse(issuedAt).success ||
      Date.parse(challenge.expiresAt) - Date.parse(issuedAt) !== 300000
    )
      throw new WebApiError("UNEXPECTED_SIGN_IN_MESSAGE");
    const signature = await wallet.signMessage(
      new TextEncoder().encode(challenge.message),
    );
    if (signal.aborted) return;
    await webApi(
      "/api/auth/verify",
      {
        challengeId: challenge.challengeId,
        signature: encodeBase64(signature),
      },
      signal,
    );
    setAuthenticated(true);
    await reload(signal);
    setMessage("Signed in. Account reads use finalized Devnet state.");
  }
  async function reconcile(signature: string, signal: AbortSignal) {
    for (let attempt = 0; attempt < 20 && !signal.aborted; attempt++) {
      const result = await webApi<{
        status: { confirmationStatus: string; err: unknown } | null;
      }>("/api/tx/status", { signature }, signal);
      if (result.status?.confirmationStatus === "finalized") {
        setPending(null);
        await reload(signal);
        if (result.status.err !== null)
          throw new WebApiError("TRANSACTION_FAILED");
        setMessage(
          "Transaction finalized. Ownership is shown only after its onchain grant.",
        );
        return;
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          signal.removeEventListener("abort", cancel);
          resolve();
        }, 3000);
        function cancel() {
          clearTimeout(timer);
          resolve();
        }
        signal.addEventListener("abort", cancel, { once: true });
      });
    }
    if (!signal.aborted) {
      await reload(signal);
      setMessage(
        "Transaction remains pending. Check this same signature before retrying.",
      );
    }
  }
  async function transact(intent: LobbyIntent, signal: AbortSignal) {
    if (address === null || wallet.signTransaction === undefined)
      throw new WebApiError("TRANSACTION_SIGNING_REQUIRED");
    if (intent.operation === "claimStarter") {
      if (state?.assetBinding == null)
        throw new WebApiError("ASSETS_NOT_READY");
      const response = await fetch(
        `/game-assets/v${state.assetBinding.version}/manifest.json`,
        { cache: "no-store", signal },
      );
      if (
        !response.ok ||
        Number(response.headers.get("content-length") ?? 0) > 262144
      )
        throw new WebApiError("ASSETS_NOT_READY");
      await verifyManifestBinding(
        await readWebJson(response),
        state.assetBinding,
      );
    }
    const prepared = preparedSchema.parse(
      await webApi("/api/tx/prepare", intent, signal),
    );
    const tx = VersionedTransaction.deserialize(
      decodeBase64(prepared.transaction),
    );
    validatePreparedTransaction(tx, address, intent);
    const signed = await wallet.signTransaction(tx);
    if (signal.aborted) return;
    const result = submittedSchema.parse(
      await webApi(
        "/api/tx/submit",
        { intent, transaction: encodeBase64(signed.serialize()) },
        signal,
      ),
    );
    setPending(result.signature);
    setMessage("Transaction requested; waiting for base-chain finality.");
    await reconcile(result.signature, signal);
  }
  useEffect(() => {
    if (!authenticated || address === null || state?.starter !== "pending")
      return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let attempts = 0;
    const poll = async () => {
      try {
        const value = await webApi<unknown>(
          "/api/chain/state",
          { kind: "wallet" },
          controller.signal,
        );
        if (controller.signal.aborted) return;
        const next = decodeLobbyState(value, address);
        setState(next);
        attempts++;
        if (next.starter === "pending" && attempts < 20)
          timer = setTimeout(() => void poll(), 3000);
        else
          setMessage(
            next.starter === "fulfilled"
              ? "Your starter cat is finalized."
              : "Draw remains pending. Refresh to recover this same request.",
          );
      } catch {
        if (!controller.signal.aborted) setError("DRAW_STATUS_UNAVAILABLE");
      }
    };
    timer = setTimeout(() => void poll(), 3000);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [authenticated, address, state?.starter]);
  const blocked = busy || pending !== null;
  return (
    <section
      aria-label="Wallet and starter cat"
      aria-busy={busy}
      className="mx-auto flex w-full max-w-xl flex-col gap-6 rounded-md border border-current/30 p-6"
    >
      <div className="flex flex-col gap-3">
        <label htmlFor="wallet-choice" className="text-sm font-medium">
          Solana wallet
        </label>
        <select
          id="wallet-choice"
          className="min-h-11 rounded-md border border-current bg-background px-3"
          value={wallet.wallet?.adapter.name ?? ""}
          disabled={busy || wallet.connected}
          onChange={(event) => {
            const selected = wallet.wallets.find(
              (value) => value.adapter.name === event.target.value,
            );
            if (selected !== undefined) wallet.select(selected.adapter.name);
          }}
        >
          <option value="" disabled>
            Select a wallet
          </option>
          {wallet.wallets.map((value) => (
            <option key={value.adapter.name} value={value.adapter.name}>
              {value.adapter.name}
            </option>
          ))}
        </select>
        {wallet.wallets.length === 0 && (
          <p className="text-sm">
            No compatible wallet detected in this browser.
          </p>
        )}
        {!wallet.connected ? (
          <button
            type="button"
            className={button}
            disabled={wallet.wallet === null || wallet.connecting || busy}
            onClick={() =>
              void perform(async () => {
                await wallet.connect();
              })
            }
          >
            {wallet.connecting ? "Connecting…" : "Connect wallet"}
          </button>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-sm tabular-nums">
              {address?.slice(0, 4)}…{address?.slice(-4)}
            </span>
            <button
              type="button"
              className={button}
              onClick={() =>
                void perform(async () => {
                  if (address !== null)
                    await navigator.clipboard.writeText(address);
                  setMessage("Wallet address copied.");
                })
              }
            >
              Copy address
            </button>
            <button
              type="button"
              className={button}
              disabled={busy}
              onClick={() =>
                void perform(async (signal) => {
                  if (authenticated)
                    await webApi("/api/auth/logout", {}, signal);
                  await wallet.disconnect();
                })
              }
            >
              Disconnect
            </button>
          </div>
        )}
        {wallet.connected && !authenticated && (
          <button
            type="button"
            className={button}
            disabled={busy || wallet.signMessage === undefined}
            onClick={() => void perform(signIn)}
          >
            Sign in to PURRPS
          </button>
        )}
      </div>
      <output aria-live="polite" className="text-sm">
        {busy ? "Waiting for wallet or chain response…" : message}
      </output>
      {error !== null && (
        <p role="alert" className="break-words text-sm">
          {webErrorMessage(error)}
        </p>
      )}
      {authenticated && (
        <>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className={button}
              disabled={busy}
              onClick={() => void perform((signal) => reload(signal))}
            >
              Refresh account
            </button>
            {pending !== null && (
              <button
                type="button"
                className={button}
                disabled={busy}
                onClick={() =>
                  void perform((signal) => reconcile(pending, signal))
                }
              >
                Check pending transaction
              </button>
            )}
          </div>
          {state === null ? (
            <p>Loading your finalized collection…</p>
          ) : !state.configured ? (
            <p>Devnet configuration has not been published yet.</p>
          ) : !state.hasPlayer ? (
            <button
              type="button"
              className={button}
              disabled={blocked}
              onClick={() =>
                void perform((signal) =>
                  transact(
                    { operation: "createPlayer", sponsored: true },
                    signal,
                  ),
                )
              }
            >
              Create player · sponsored Devnet fees
            </button>
          ) : (
            <>
              {state.starter === "unclaimed" && (
                <div className="flex flex-col gap-3">
                  <p>
                    One starter cat per wallet. The item is free; the app
                    sponsors bounded Devnet fees.
                  </p>
                  <button
                    type="button"
                    className={button}
                    disabled={
                      blocked ||
                      !state.allowStarter ||
                      state.catalogVersion === null
                    }
                    onClick={() =>
                      void perform(async (signal) => {
                        if (
                          state.nonce === null ||
                          state.inventoryVersion === null ||
                          state.catalogVersion === null
                        )
                          return;
                        await transact(
                          {
                            operation: "claimStarter",
                            nonce: state.nonce.toString(),
                            inventoryVersion: state.inventoryVersion.toString(),
                            catalogVersion: state.catalogVersion,
                            sponsored: true,
                          },
                          signal,
                        );
                      })
                    }
                  >
                    Request starter cat
                  </button>
                  {!state.allowStarter && (
                    <p className="text-sm">
                      Starter draws are currently paused.
                    </p>
                  )}
                </div>
              )}
              {state.starter === "pending" && (
                <div>
                  <p>
                    Your original starter draw is pending. Refreshing will not
                    reroll it.
                  </p>
                  {state.pendingDraw !== null && (
                    <a
                      className="inline-flex min-h-11 items-center underline focus-visible:outline-2"
                      href={`https://explorer.solana.com/address/${state.pendingDraw}?cluster=devnet`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View pending draw
                    </a>
                  )}
                </div>
              )}
              <CatCollection
                state={state}
                blocked={blocked}
                onSelect={(cat) =>
                  void perform(async (signal) => {
                    if (state.inventoryVersion === null) return;
                    await transact(
                      {
                        operation: "selectCat",
                        inventoryVersion: state.inventoryVersion.toString(),
                        cat,
                        sponsored: false,
                      },
                      signal,
                    );
                  })
                }
              />
            </>
          )}
        </>
      )}
    </section>
  );
}
