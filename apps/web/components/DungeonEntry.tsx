"use client";
import type { VersionedTransaction } from "@solana/web3.js";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type DungeonArtwork,
  loadDungeonArtwork,
} from "../lib/dungeon/artwork";
import {
  type DungeonRequest,
  type DungeonView,
  dungeonViewSchema,
} from "../lib/dungeon/protocol";
import { type DungeonPrepare, requestDungeon } from "../lib/dungeon/request";
import {
  approveDungeonReservation,
  type DungeonApproval,
} from "../lib/dungeon/transactions";
import { mergeDungeonView } from "../lib/dungeon/view-state";
import type { CatId } from "../lib/game/catalog";
import { displayUsdc, parseUsdc } from "../lib/game/custody-client";
import type { LobbyState } from "../lib/game/lobby-state";
import { WebApiError, webErrorMessage } from "../lib/game/web-api";
import DungeonScreen from "./DungeonScreen";

export default function DungeonEntry({
  state,
  cat,
  wallet,
  blocked,
  sign,
  refresh,
}: {
  readonly state: LobbyState;
  readonly cat: CatId;
  readonly wallet: string;
  readonly blocked: boolean;
  readonly sign:
    | ((tx: VersionedTransaction) => Promise<VersionedTransaction>)
    | undefined;
  readonly refresh: (signal: AbortSignal) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    client = useRef(crypto.randomUUID());
  const latest = useRef<DungeonView | null>(null),
    finalized = useRef<string | null>(null);
  const approved = useRef<DungeonApproval | null>(null);
  const starting = useRef<AbortController | null>(null);
  const [view, setView] = useState<DungeonView | null>(null);
  const [art, setArt] = useState<DungeonArtwork | null>(null);
  const [amount, setAmount] = useState("");
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [launch, setLaunch] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  let stake: bigint | null = null;
  try {
    stake = parseUsdc(amount);
  } catch {
    stake = null;
  }
  const rawStake = stake?.toString();
  const active = view !== null && !view.settled;
  const open =
    launch && view !== null && !["preparing", "cancelled"].includes(view.phase);
  const confirming = view?.phase === "preparing" && !view.preparation;
  const waiting = launch && confirming;
  const accept = useCallback(
    (incoming: DungeonView | null, newApproval = false) => {
      const next = mergeDungeonView(latest.current, incoming, newApproval);
      if (next && next.owner !== wallet)
        throw new Error("INVALID_DUNGEON_RESPONSE");
      if (newApproval && next?.phase === "preparing") finalized.current = null;
      latest.current = next;
      setView(next);
      if (
        next?.settled &&
        next.phase !== "cancelled" &&
        finalized.current !== next.nonce
      ) {
        finalized.current = next.nonce;
        void refresh(AbortSignal.timeout(10000)).catch(() =>
          setNotice("Refresh your balance to see the finalized result."),
        );
      }
      return next;
    },
    [wallet, refresh],
  );
  const send = useCallback(
    async (input: DungeonRequest | DungeonPrepare, signal?: AbortSignal) => {
      const result = await requestDungeon(input, signal);
      signal?.throwIfAborted();
      return accept(
        dungeonViewSchema.nullable().parse(result),
        input.kind === "prepare",
      );
    },
    [accept],
  );
  useEffect(() => {
    const controller = new AbortController();
    void send({ kind: "status", client: client.current }, controller.signal)
      .catch(() => {
        if (!controller.signal.aborted)
          setNotice("Could not check your previous expedition.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setChecking(false);
      });
    return () => {
      controller.abort();
      starting.current?.abort();
    };
  }, [send]);
  const nonce = view?.nonce;
  const pendingSettlement =
    active && view !== null && ["won", "lost", "refunded"].includes(view.phase);
  useEffect(() => {
    if (busy || !nonce || (!waiting && !pendingSettlement)) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const next = await send(
          { kind: "status", nonce, client: client.current },
          controller.signal,
        );
        if (next?.phase === "cancelled") {
          setLaunch(false);
          setNotice("The wager was not placed. Press Play to start again.");
        } else if (next && next.phase !== "preparing") setNotice(null);
        if (next?.settled || (waiting && next?.phase === "ready")) return;
      } catch {
        if (!controller.signal.aborted)
          setNotice("Checking your saved expedition…");
      }
      if (!controller.signal.aborted)
        timer = setTimeout(() => void poll(), 2500);
    }
    timer = setTimeout(() => void poll(), 2500);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [nonce, waiting, pendingSettlement, busy, send]);
  useEffect(() => {
    const modal = dialog.current;
    if (open && !modal?.open) modal?.showModal();
    else if (!open && modal?.open) modal.close();
  }, [open]);
  const close = useCallback(() => {
    const current = latest.current;
    if (current && !current.settled)
      void send({
        kind: "exit",
        nonce: current.nonce,
        client: client.current,
      }).catch(() =>
        setNotice(
          "Your saved expedition will resolve when your wallet next checks it.",
        ),
      );
    setLaunch(false);
  }, [send]);
  async function begin() {
    if (starting.current || checking || waiting || blocked) return;
    const current = latest.current;
    let expedition = current && !current.settled ? current : null;
    if (
      !expedition &&
      (!sign || !rawStake || !stake || stake > BigInt(state.available))
    )
      return;
    const artCat = expedition?.cat ?? cat;
    const controller = new AbortController();
    const { signal } = controller;
    starting.current = controller;
    setBusy(true);
    setNotice("Preparing your expedition…");
    let loaded = false;
    try {
      const artwork = await loadDungeonArtwork(artCat);
      signal.throwIfAborted();
      setArt(artwork);
      loaded = true;
      if (expedition?.phase === "preparing" && expedition.preparation) {
        expedition = await send(
          { kind: "status", nonce: expedition.nonce, client: client.current },
          signal,
        );
        if (!expedition || expedition.settled) {
          setNotice("The previous wager expired. Press Play to start again.");
          return;
        }
      }
      if (!expedition && rawStake) {
        expedition = await send(
          { kind: "prepare", stake: rawStake, cat },
          signal,
        );
        if (
          !expedition?.preparation ||
          expedition.stake !== rawStake ||
          expedition.cat !== cat
        )
          throw new Error("INVALID_DUNGEON_QUOTE");
      }
      if (!expedition) return;
      if (expedition.preparation) {
        if (!sign) {
          setNotice("Reconnect your wallet to approve this wager.");
          return;
        }
        if (approved.current?.source !== expedition.preparation.transaction)
          setNotice("Approve the wager in your wallet.");
        approved.current = await approveDungeonReservation(
          wallet,
          expedition,
          sign,
          approved.current,
        );
        signal.throwIfAborted();
        setNotice("Confirming your wager…");
        expedition = await send(
          {
            kind: "submit",
            nonce: expedition.nonce,
            transaction: approved.current.transaction,
          },
          signal,
        );
      }
      if (expedition?.phase === "cancelled") {
        setNotice("The wager was not placed. Press Play to start again.");
        return;
      }
      setLaunch(true);
      setNotice(null);
    } catch (error) {
      if (signal.aborted) return;
      setNotice(
        !loaded
          ? "The game could not load. Press Play to try again."
          : error instanceof WebApiError
            ? webErrorMessage(error.code)
            : error instanceof Error &&
                error.message === "WALLET_CHANGED_DUNGEON_TRANSACTION"
              ? "The wallet changed the transaction. The wager was not sent."
              : "The expedition could not start. Press Play to continue.",
      );
      if (!loaded) return;
      const saved = await send(
        { kind: "status", nonce: expedition?.nonce, client: client.current },
        signal,
      ).catch(() => null);
      if (
        saved &&
        !saved.settled &&
        !saved.preparation &&
        saved.cat === artCat
      ) {
        setLaunch(true);
        setNotice(null);
      }
    } finally {
      if (starting.current === controller) {
        starting.current = null;
        if (!signal.aborted) setBusy(false);
      }
    }
  }
  return (
    <>
      {active ? (
        <div className="lobby-banner">
          <p>
            {view.phase === "preparing"
              ? `Wager ${displayUsdc(view.stake)} USDC · Up to ${displayUsdc(view.maxGross)} USDC across ${view.maxRooms} rooms`
              : `Expedition #${view.nonce}`}
          </p>
          <button
            className="pixel-button"
            data-tone="gold"
            type="button"
            aria-busy={busy || waiting}
            disabled={
              blocked || busy || waiting || (view.preparation !== null && !sign)
            }
            onClick={() => void begin()}
          >
            Play
          </button>
        </div>
      ) : (
        <div className="bet-card dungeon-bet">
          <h2>Catacomb Quest</h2>
          <p>Beat the gas. Choose a gate. Bank your treasure.</p>
          <label htmlFor={`dungeon-bet-${wallet}`}>Wager (Devnet USDC)</label>
          <div className="bet-amount">
            <input
              id={`dungeon-bet-${wallet}`}
              inputMode="decimal"
              autoComplete="off"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              disabled={busy}
              aria-invalid={
                amount !== "" && (!stake || stake > BigInt(state.available))
              }
            />
            <span>USDC</span>
          </div>
          <p className="bet-available">
            Available {displayUsdc(state.available)} USDC
          </p>
          <button
            className="pixel-button lobby-play"
            aria-busy={busy}
            data-tone="gold"
            type="button"
            disabled={
              blocked ||
              busy ||
              !sign ||
              checking ||
              !stake ||
              stake > BigInt(state.available)
            }
            onClick={() => void begin()}
          >
            Play
          </button>
          {!sign && (
            <output className="lobby-section-note">
              Reconnect your wallet to approve this wager.
            </output>
          )}
          {blocked && (
            <output className="lobby-section-note">
              Finish the pending wallet request before starting an expedition.
            </output>
          )}
          <p className="dungeon-odds-note">
            Each gate: 2 in 3 treasure. Reach it before time runs out. PURRPS
            covers Devnet fees.
          </p>
        </div>
      )}
      {!open && (notice || waiting || checking) && (
        <output className="lobby-section-note">
          {notice ??
            (waiting ? "Confirming your wager…" : "Checking your expedition…")}
        </output>
      )}
      <dialog
        ref={dialog}
        className="run-dialog dungeon-dialog"
        aria-label="Catacomb Quest"
        onCancel={(event) => {
          event.preventDefault();
          if (!busy) close();
        }}
      >
        {open && view && (
          <div className="dungeon-dialog-content">
            <button
              className="pixel-button dungeon-lobby"
              type="button"
              disabled={busy}
              onClick={close}
              title={
                view.phase === "playing"
                  ? "Leaving an active room ends the expedition"
                  : "Back to lobby"
              }
            >
              ← Lobby
            </button>
            <DungeonScreen
              view={view}
              artwork={art}
              notice={notice}
              client={client.current}
              send={send}
              onClose={close}
            />
          </div>
        )}
      </dialog>
    </>
  );
}
