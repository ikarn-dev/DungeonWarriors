"use client";
import type { VersionedTransaction } from "@solana/web3.js";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type DungeonArtwork,
  loadDungeonArtwork,
} from "../lib/dungeon/artwork";
import { logDungeon } from "../lib/dungeon/debug";
import {
  type DungeonRequest,
  type DungeonView,
  dungeonViewSchema,
} from "../lib/dungeon/protocol";
import { type DungeonPrepare, requestDungeon } from "../lib/dungeon/request";
import {
  approveDungeonReservation,
  type DungeonApproval,
  hasDungeonReservationFee,
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
  const [failure, setFailure] = useState<string | null>(null);
  let stake: bigint | null = null;
  try {
    stake = parseUsdc(amount);
  } catch {
    stake = null;
  }
  const rawStake = stake?.toString();
  const active = view !== null && !view.settled;
  const pendingWager = view?.preparation ? view : null;
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
        input.kind === "prepare" || input.kind === "quote",
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
          setNotice(null);
          setFailure("Devnet did not confirm this wager.");
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
    setFailure(null);
    setNotice("Preparing your expedition…");
    logDungeon("play.start", { network: "devnet", saved: expedition !== null });
    let step = "artwork";
    try {
      const artwork = await loadDungeonArtwork(artCat);
      signal.throwIfAborted();
      setArt(artwork);
      step = "prepare";
      let request:
        | DungeonPrepare
        | Extract<DungeonRequest, { kind: "quote" }>
        | null = null;
      if (expedition?.phase === "preparing" && expedition.preparation) {
        const previous = expedition;
        expedition = await send(
          { kind: "status", nonce: previous.nonce, client: client.current },
          signal,
        );
        if (
          (expedition?.phase === "cancelled" && expedition.settled) ||
          (expedition?.preparation &&
            !hasDungeonReservationFee(expedition.preparation.transaction))
        ) {
          request = {
            kind: "quote",
            stake: previous.stake,
            cat: previous.cat,
            maxRooms: previous.maxRooms,
            maxGross: previous.maxGross,
            rulesHash: previous.rulesHash,
          };
        }
      } else if (!expedition && rawStake) {
        request = { kind: "prepare", stake: rawStake, cat };
      }
      if (request) {
        expedition = await send(request, signal);
        if (
          !expedition?.preparation ||
          expedition.stake !== request.stake ||
          expedition.cat !== request.cat ||
          (request.kind === "quote" &&
            (expedition.maxRooms !== request.maxRooms ||
              expedition.maxGross !== request.maxGross ||
              expedition.rulesHash !== request.rulesHash))
        )
          throw new WebApiError("INVALID_DUNGEON_QUOTE");
        logDungeon("wager.prepared", { renewed: request.kind === "quote" });
      }
      if (!expedition) return;
      if (expedition.preparation) {
        if (!sign) throw new WebApiError("TRANSACTION_SIGNING_REQUIRED");
        step = "wallet";
        if (approved.current?.source !== expedition.preparation.transaction)
          setNotice("Approve the wager in your wallet.");
        approved.current = await approveDungeonReservation(
          wallet,
          expedition,
          sign,
          approved.current,
        );
        signal.throwIfAborted();
        step = "submit";
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
      if (expedition?.phase === "cancelled")
        throw new WebApiError("TRANSACTION_FAILED");
      logDungeon("play.accepted", { phase: expedition?.phase ?? "unknown" });
      setLaunch(true);
      setNotice(null);
    } catch (error) {
      if (signal.aborted) return;
      const code =
        error instanceof WebApiError
          ? error.code
          : step === "artwork"
            ? "DUNGEON_ART_LOAD_FAILED"
            : step === "submit"
              ? "DUNGEON_SUBMIT_UNCONFIRMED"
              : "DUNGEON_PREPARE_FAILED";
      logDungeon("play.failed", { step, code });
      setNotice(null);
      setFailure(webErrorMessage(code));
      if (step !== "submit" && step !== "prepare") return;
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
        setFailure(null);
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
      {active && !pendingWager ? (
        <div className="lobby-banner">
          <p>Expedition #{view.nonce}</p>
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
              value={pendingWager ? displayUsdc(pendingWager.stake) : amount}
              onChange={(event) => {
                setAmount(event.target.value);
                setFailure(null);
              }}
              disabled={busy || pendingWager !== null}
              aria-invalid={
                !pendingWager &&
                amount !== "" &&
                (!stake || stake > BigInt(state.available))
              }
            />
            <span>USDC</span>
          </div>
          <p className="bet-available">
            Available {displayUsdc(state.available)} USDC
          </p>
          {pendingWager && busy && (
            <p className="dungeon-offer">
              {pendingWager.maxRooms} rooms · Up to{" "}
              {displayUsdc(pendingWager.maxGross)} USDC
            </p>
          )}
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
              (!pendingWager && (!stake || stake > BigInt(state.available)))
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
      {!open && failure && (
        <p role="alert" className="lobby-problem">
          {failure}
        </p>
      )}
      {!open && !failure && (notice || waiting || checking) && (
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
