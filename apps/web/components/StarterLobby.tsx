"use client";
import { useWallet } from "@solana/wallet-adapter-react";
import { VersionedTransaction } from "@solana/web3.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { verifyManifestBinding } from "../lib/game/assets";
import {
  type PlayerIntent,
  validatePreparedPlayerAction,
} from "../lib/game/custody-client";
import {
  type CapsuleKind,
  decodeLobbyState,
  type LobbyState,
} from "../lib/game/lobby-state";
import { RULES_V1 } from "../lib/game/rules";
import {
  type LobbyIntent,
  lobbyPreparedSchema,
  lobbySubmittedSchema,
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
import { useCapsuleReceipt } from "./account-data";
import CapsuleReveal from "./CapsuleReveal";
import LobbyBackdrop from "./LobbyBackdrop";
import type { LobbyTab } from "./LobbyMenu";
import LobbySections from "./LobbySections";
import LobbyStart from "./LobbyStart";
import LobbyToaster from "./LobbyToaster";
import { WalletChip } from "./LobbyWallet";
import { signInWallet } from "./wallet-sign-in";

const drawPollMs = 6_000;
// One toast per transaction: loading, then confirmed or still pending.
const TX_TOAST = "transaction";
const notifyError = (code: string) =>
  toast.error(webErrorMessage(code), { id: code });
type DrawView = { owner: string; nonce: bigint; kind: CapsuleKind };

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
  const [pending, setPending] = useState<{
    signature: string;
    lastValidBlockHeight: number;
    starter: boolean;
  } | null>(null);
  const work = useRef<AbortController | null>(null);
  const [drawView, setDrawView] = useState<DrawView | null>(null);
  const visibleDraw =
    authenticated && drawView?.owner === address ? drawView : null;
  const drawCount = state?.nonce ?? 0n;
  const latestPaid = drawCount > 1n ? drawCount - 1n : null;
  const requestedNonce = visibleDraw?.nonce ?? latestPaid;
  const readNonce =
    requestedNonce !== null && requestedNonce < drawCount
      ? requestedNonce
      : null;
  const { receipt, retryDraw } = useCapsuleReceipt(
    authenticated ? address : null,
    readNonce,
    state?.slot,
  );
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
    setDrawView(null);
    if (address === null) return;
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
        if (session.wallet !== walletAddress) return;
        setSessionWallet(walletAddress);
        await reload(signal).catch((failure: unknown) => {
          if (
            failure instanceof WebApiError &&
            failure.code === "AUTH_REQUIRED"
          )
            throw failure;
          if (!controller.signal.aborted)
            notifyError("ACCOUNT_STATE_UNAVAILABLE");
        });
      } catch (failure) {
        if (controller.signal.aborted) return;
        if (
          failure instanceof WebApiError &&
          failure.code === "AUTH_REQUIRED"
        ) {
          setSessionWallet(null);
        } else {
          setRestoreFailed(true);
          toast.error("Couldn't reconnect to PURRPS.", {
            id: "restore",
            action: {
              label: "Retry",
              onClick: () => setRestoreAttempt((attempt) => attempt + 1),
            },
          });
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
    try {
      await action(controller.signal);
    } catch (failure) {
      if (controller.signal.aborted) return;
      if (failure instanceof WebApiError && failure.code === "AUTH_REQUIRED")
        setSessionWallet(null);
      notifyError(
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
    toast.success("Signed in", { id: "restore" });
  }
  async function reconcile(
    signature: string,
    lastValidBlockHeight: number,
    signal: AbortSignal,
  ) {
    for (let attempt = 0; attempt < 20 && !signal.aborted; attempt++) {
      const result = await webApi<{
        status: { confirmationStatus: string; err: unknown } | null;
        resolution: string;
      }>("/api/tx/status", { signature, lastValidBlockHeight }, signal);
      if (
        result.resolution === "expired" ||
        result.status?.confirmationStatus === "finalized"
      ) {
        try {
          await reload(signal);
        } finally {
          if (!signal.aborted) setPending(null);
        }
        if (result.resolution === "expired" || result.status?.err !== null) {
          setDrawView(null);
          toast.dismiss(TX_TOAST);
          throw new WebApiError(
            result.resolution === "expired"
              ? "BLOCKHASH_EXPIRED"
              : "TRANSACTION_FAILED",
          );
        }
        toast.success("Transaction confirmed", { id: TX_TOAST });
        return;
      }
      await pause(3000, signal);
    }
    if (!signal.aborted) {
      await reload(signal);
      toast("Still confirming on Solana", {
        id: TX_TOAST,
        duration: Number.POSITIVE_INFINITY,
        action: {
          label: "Check again",
          onClick: () =>
            void perform((next) =>
              reconcile(signature, lastValidBlockHeight, next),
            ),
        },
      });
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
    const prepared = lobbyPreparedSchema.parse(
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
    const result = lobbySubmittedSchema.parse(
      await webApi(
        "/api/tx/submit",
        { intent, transaction: encodeBase64(signed.serialize()) },
        signal,
      ),
    );
    if (signal.aborted) return;
    if (intent.operation === "claimStarter") {
      setDrawView({
        owner: address,
        nonce: BigInt(intent.nonce),
        kind: "starterCat",
      });
    } else if (
      intent.operation === "game" &&
      intent.action.kind === "purchaseCapsule"
    ) {
      setDrawView({
        owner: address,
        nonce: BigInt(intent.action.nonce),
        kind: intent.action.capsule,
      });
    }
    setPending({
      signature: result.signature,
      lastValidBlockHeight: prepared.lastValidBlockHeight,
      starter: intent.operation === "claimStarter",
    });
    toast.loading("Confirming…", { id: TX_TOAST });
    await reconcile(result.signature, prepared.lastValidBlockHeight, signal);
  }
  const paidDraw = state?.starter === "fulfilled";
  useEffect(() => {
    if (!authenticated || address === null || state?.pendingDraw == null)
      return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let attempts = 0;
    const maxAttempts = paidDraw
      ? Math.ceil((RULES_V1.paidDrawTimeoutSeconds * 1000) / drawPollMs) + 1
      : 12;
    const poll = async () => {
      attempts++;
      try {
        const value = await webApi<unknown>(
          "/api/chain/state",
          { kind: "wallet" },
          AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
        );
        if (controller.signal.aborted) return;
        const next = decodeLobbyState(value, address);
        setState(next);
        if (next.pendingDraw === null) {
          if (!paidDraw) toast.success("Capsule draw complete");
          return;
        }
      } catch (failure) {
        if (controller.signal.aborted) return;
        if (
          attempts >= maxAttempts ||
          (failure instanceof WebApiError && failure.code === "AUTH_REQUIRED")
        ) {
          notifyError("DRAW_STATUS_UNAVAILABLE");
          return;
        }
      }
      if (attempts < maxAttempts)
        timer = setTimeout(() => void poll(), drawPollMs);
      else if (!paidDraw)
        toast("Your cat is still on its way. It appears once it's ready.", {
          id: "draw",
        });
    };
    timer = setTimeout(() => void poll(), drawPollMs);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [authenticated, address, paidDraw, state?.pendingDraw]);
  const blocked = busy || pending !== null;
  const copy = () =>
    void perform(async () => {
      if (address === null) return;
      await navigator.clipboard.writeText(address);
      toast.success("Address copied");
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
  return (
    <>
      <LobbyBackdrop />
      <LobbyToaster />
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
            shopDraw={{
              receipt: readNonce === latestPaid ? receipt : null,
              retryDraw,
              onViewDraw: (nonce, kind) =>
                setDrawView({ owner: address, nonce, kind }),
            }}
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
      {visibleDraw && (
        <CapsuleReveal
          key={visibleDraw.nonce.toString()}
          kind={visibleDraw.kind}
          receipt={receipt?.kind === visibleDraw.kind ? receipt : null}
          cats={state?.cats ?? []}
          retry={retryDraw}
          onClose={() => setDrawView(null)}
          onViewCats={() => {
            setDrawView(null);
            setTab("cats");
          }}
        />
      )}
    </>
  );
}
