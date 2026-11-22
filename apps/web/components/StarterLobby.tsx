"use client";
import { useWallet } from "@solana/wallet-adapter-react";
import { VersionedTransaction } from "@solana/web3.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { verifyManifestBinding } from "../lib/game/assets";
import { CATALOG_V1 } from "../lib/game/catalog";
import {
  type PlayerIntent,
  validatePreparedPlayerAction,
} from "../lib/game/custody-client";
import { decodeLobbyState, type LobbyState } from "../lib/game/lobby-state";
import {
  type LobbyIntent,
  validatePreparedTransaction,
} from "../lib/game/transaction-intents";
import {
  decodeBase64,
  encodeBase64,
  pause,
  readWebJson,
  WebApiError,
  webApi,
  webErrorMessage,
} from "../lib/game/web-api";
import type { LobbyTab } from "./LobbyMenu";
import LobbyScene from "./LobbyScene";
import LobbySections from "./LobbySections";
import LobbyStart from "./LobbyStart";
import { WalletChip } from "./LobbyWallet";
import { signInWallet } from "./wallet-sign-in";

const preparedSchema = z
  .object({
    transaction: z.string().max(1800),
    blockhash: z.string(),
    lastValidBlockHeight: z.number().int(),
    operationId: z.string(),
    network: z.literal("base").default("base"),
  })
  .strict();
const submittedSchema = z
  .object({
    status: z.literal("requested"),
    signature: z.string().min(64).max(88),
    unknownResponse: z.boolean(),
    network: z.literal("base").default("base"),
  })
  .strict();
export default function StarterPanel() {
  const wallet = useWallet();
  const address = wallet.publicKey?.toBase58() ?? null;
  const [sessionWallet, setSessionWallet] = useState<string | null>(null);
  const [checkedWallet, setCheckedWallet] = useState<string | null>(null);
  const [restoreFailed, setRestoreFailed] = useState(false);
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const authenticated = address !== null && sessionWallet === address;
  const restoring = address !== null && checkedWallet !== address;
  const [state, setState] = useState<LobbyState | null>(null);
  const [accountRevision, setAccountRevision] = useState<number>();
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<LobbyTab>("play");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{
    signature: string;
    starter: boolean;
  } | null>(null);
  const work = useRef<AbortController | null>(null);
  const reload = useCallback(
    async (signal?: AbortSignal) => {
      if (address === null) return;
      try {
        const value = await webApi<unknown>(
          "/api/chain/state",
          { kind: "wallet" },
          signal,
        );
        if (!signal?.aborted) setState(decodeLobbyState(value, address));
      } finally {
        if (!signal?.aborted)
          setAccountRevision((previous) => (previous ?? 0) + 1);
      }
    },
    [address],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: Retry explicitly rechecks the same wallet's cookie.
  useEffect(() => {
    work.current?.abort();
    setBusy(false);
    setSessionWallet(null);
    setCheckedWallet(null);
    setRestoreFailed(false);
    setState(null);
    setAccountRevision(undefined);
    setPending(null);
    setError(null);
    if (address === null) {
      setMessage(null);
      return;
    }
    const controller = new AbortController();
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(8000),
    ]);
    async function restore(walletAddress: string) {
      try {
        const session = await webApi<{ wallet: string }>(
          "/api/auth/session",
          undefined,
          signal,
        );
        if (controller.signal.aborted) return;
        if (session.wallet !== walletAddress) {
          setMessage(null);
          return;
        }
        setSessionWallet(walletAddress);
        setMessage(null);
        await reload(signal).catch((failure: unknown) => {
          if (
            failure instanceof WebApiError &&
            failure.code === "AUTH_REQUIRED"
          )
            throw failure;
          if (!controller.signal.aborted) setError("ACCOUNT_STATE_UNAVAILABLE");
        });
      } catch (failure) {
        if (controller.signal.aborted) return;
        if (
          failure instanceof WebApiError &&
          failure.code === "AUTH_REQUIRED"
        ) {
          setSessionWallet(null);
          setMessage(null);
        } else {
          setRestoreFailed(true);
          setMessage("Couldn't restore your session. Try again.");
        }
      } finally {
        if (!controller.signal.aborted) setCheckedWallet(walletAddress);
      }
    }
    void restore(address);
    return () => {
      controller.abort();
      work.current?.abort();
    };
  }, [address, reload, restoreAttempt]);
  async function perform(action: (signal: AbortSignal) => Promise<void>) {
    if (work.current !== null && !work.current.signal.aborted) return;
    const controller = new AbortController();
    work.current = controller;
    setBusy(true);
    setError(null);
    try {
      await action(controller.signal);
    } catch (failure) {
      if (controller.signal.aborted) return;
      if (failure instanceof WebApiError && failure.code === "AUTH_REQUIRED") {
        setSessionWallet(null);
        setMessage(null);
      }
      setError(
        failure instanceof WebApiError
          ? failure.code
          : "WALLET_OR_ACCOUNT_REQUEST_FAILED",
      );
    } finally {
      if (work.current === controller) {
        work.current = null;
        if (!controller.signal.aborted) setBusy(false);
      }
    }
  }
  async function signIn(signal: AbortSignal) {
    if (address === null || wallet.signMessage === undefined)
      throw new WebApiError("MESSAGE_SIGNING_REQUIRED");
    if (!(await signInWallet(address, wallet.signMessage, signal))) return;
    setSessionWallet(address);
    await reload(signal);
    setMessage(null);
  }
  async function reconcile(signature: string, signal: AbortSignal) {
    for (let attempt = 0; attempt < 20 && !signal.aborted; attempt++) {
      const result = await webApi<{
        status: { confirmationStatus: string; err: unknown } | null;
      }>("/api/tx/status", { signature }, signal);
      if (result.status?.confirmationStatus === "finalized") {
        try {
          await reload(signal);
        } finally {
          if (!signal.aborted) setPending(null);
        }
        if (result.status.err !== null)
          throw new WebApiError("TRANSACTION_FAILED");
        setMessage("Transaction confirmed.");
        return;
      }
      await pause(3000, signal);
    }
    if (!signal.aborted) {
      await reload(signal);
      setMessage(
        "Transaction remains pending. Check this same signature before retrying.",
      );
    }
  }
  async function transact(
    intent: LobbyIntent | PlayerIntent,
    signal: AbortSignal,
  ) {
    if (address === null || wallet.signTransaction === undefined)
      throw new WebApiError("TRANSACTION_SIGNING_REQUIRED");
    if (
      intent.operation === "claimStarter" ||
      (intent.operation === "game" && intent.action.kind === "purchaseCapsule")
    ) {
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
    if (intent.operation === "game")
      validatePreparedPlayerAction(tx, address, intent);
    else validatePreparedTransaction(tx, address, intent);
    const signed = await wallet.signTransaction(tx);
    if (signal.aborted) return;
    const result = submittedSchema.parse(
      await webApi(
        "/api/tx/submit",
        { intent, transaction: encodeBase64(signed.serialize()) },
        signal,
      ),
    );
    setPending({
      signature: result.signature,
      starter: intent.operation === "claimStarter",
    });
    setMessage("Waiting for Solana Devnet confirmation.");
    await reconcile(result.signature, signal);
  }
  useEffect(() => {
    if (!authenticated || address === null || state?.pendingDraw == null)
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
        if (next.pendingDraw !== null && attempts < 12)
          timer = setTimeout(() => void poll(), 6000);
        else
          setMessage(
            next.pendingDraw === null
              ? "Your capsule draw is complete."
              : "Draw remains pending. Refresh to recover this same request.",
          );
      } catch {
        if (!controller.signal.aborted) setError("DRAW_STATUS_UNAVAILABLE");
      }
    };
    timer = setTimeout(() => void poll(), 6000);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [authenticated, address, state?.pendingDraw]);
  // Confirmations are transient; pending and error states stay until resolved.
  useEffect(() => {
    if (message === null || pending !== null) return;
    const timer = setTimeout(() => setMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [message, pending]);
  const blocked = busy || pending !== null;
  const copy = () =>
    void perform(async () => {
      if (address !== null) await navigator.clipboard.writeText(address);
      setMessage("Wallet address copied.");
    });
  const disconnect = () =>
    void perform(async (signal) => {
      if (authenticated) await webApi("/api/auth/logout", {}, signal);
      await wallet.disconnect();
    });
  const ready =
    authenticated &&
    state?.configured === true &&
    state.hasPlayer &&
    state.starter === "fulfilled";
  // Owned cats wander the lobby, selected first; before any draw the catalog cats do.
  const first = (id: string) => Number(id !== state?.selected);
  const owned = authenticated ? (state?.cats.map(({ id }) => id) ?? []) : [];
  const scene = owned.length
    ? [...owned].sort((a, b) => first(a) - first(b))
    : CATALOG_V1.cats.map(({ id }) => id);
  return (
    <>
      <LobbyScene cats={scene} />
      {wallet.connected && address !== null && (
        <WalletChip
          address={address}
          busy={busy || restoring}
          onCopy={copy}
          onDisconnect={disconnect}
        />
      )}
      <div className="lobby-body" aria-busy={busy}>
        {ready && address !== null && state !== null ? (
          <LobbySections
            state={state}
            address={address}
            sign={wallet.signTransaction}
            blocked={blocked}
            accountRevision={accountRevision}
            tab={tab}
            setTab={setTab}
            perform={perform}
            transact={transact}
            reload={reload}
          />
        ) : (
          <LobbyStart
            wallet={wallet}
            busy={busy}
            blocked={blocked}
            restoring={restoring}
            authenticated={authenticated}
            restoreFailed={restoreFailed}
            state={state}
            gettingCat={pending?.starter === true}
            onConnect={() =>
              void perform(async () => {
                await wallet.connect();
              })
            }
            onSignIn={() => {
              if (restoreFailed) setRestoreAttempt((attempt) => attempt + 1);
              else void perform(signIn);
            }}
            onCreatePlayer={() =>
              void perform((signal) =>
                transact(
                  { operation: "createPlayer", sponsored: true },
                  signal,
                ),
              )
            }
            onClaimStarter={() =>
              void perform(async (signal) => {
                if (
                  state === null ||
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
          />
        )}
      </div>
      {(message || error !== null || pending !== null) && (
        <footer className="lobby-status">
          {message && <output aria-live="polite">{message}</output>}
          {error !== null && <p role="alert">{webErrorMessage(error)}</p>}
          {pending !== null && (
            <button
              type="button"
              className="pixel-button"
              disabled={busy}
              onClick={() =>
                void perform((signal) => reconcile(pending.signature, signal))
              }
            >
              Check transaction
            </button>
          )}
        </footer>
      )}
    </>
  );
}
