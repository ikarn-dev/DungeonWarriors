"use client";
import type { VersionedTransaction } from "@solana/web3.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  type DungeonArtwork,
  loadDungeonArtwork,
} from "../lib/dungeon/artwork";
import { logDungeon } from "../lib/dungeon/debug";
import { clearDeparture, savedDeparture } from "../lib/dungeon/departure";
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
import DungeonScreen, { DungeonDialog } from "./DungeonScreen";
import { useDungeonExit } from "./useDungeonExit";

// One toast follows a quest from Play until the game opens: it updates in
// place and is dismissed when the dungeon appears. In-game messages use the
// dungeon's own notice, because the modal dialog covers the toaster.
const QUEST_TOAST = "quest";
const progress = (title: string) => toast.loading(title, { id: QUEST_TOAST });
const problem = (title: string) =>
  toast.error(title, { id: QUEST_TOAST, duration: 6000 });

export default function DungeonEntry({
  state,
  cat,
  wallet,
  blocked,
  sign,
  refresh,
  showMenu,
}: {
  readonly state: LobbyState;
  readonly cat: CatId;
  readonly wallet: string;
  readonly blocked: boolean;
  readonly sign:
    | ((tx: VersionedTransaction) => Promise<VersionedTransaction>)
    | undefined;
  readonly refresh: (signal: AbortSignal) => Promise<void>;
  readonly showMenu: () => void;
}) {
  const client = useRef(crypto.randomUUID());
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
  const [uncertain, setUncertain] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
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
  const confirming =
    (view?.phase === "preparing" && !view.preparation) ||
    (uncertain !== null && uncertain === view?.nonce);
  const funded = active && pendingWager === null;
  const accept = useCallback(
    (incoming: DungeonView | null, newApproval = false) => {
      const next = mergeDungeonView(latest.current, incoming, newApproval);
      if (next && next.owner !== wallet)
        throw new Error("INVALID_DUNGEON_RESPONSE");
      if (newApproval && next?.phase === "preparing") finalized.current = null;
      latest.current = next;
      setView(next);
      if (next?.settled) clearDeparture(wallet, next.nonce);
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
  const returnToMenu = useCallback(() => {
    setLaunch(false);
    setNotice(null);
    showMenu();
  }, [showMenu]);
  const { exit, pending, requested } = useDungeonExit({
    open,
    phase: view?.phase,
    latest,
    wallet,
    client: client.current,
    send,
    onMenu: returnToMenu,
    toastId: QUEST_TOAST,
  });
  useEffect(() => {
    const controller = new AbortController();
    const departure = savedDeparture(wallet);
    if (departure) {
      exit(departure);
      setChecking(false);
    } else
      void send({ kind: "status" }, controller.signal)
        .catch(() => {
          if (!controller.signal.aborted)
            problem("Couldn't check your last quest.");
        })
        .finally(() => {
          if (!controller.signal.aborted) setChecking(false);
        });
    return () => {
      controller.abort();
      starting.current?.abort();
    };
  }, [exit, send, wallet]);
  const nonce = view?.nonce;
  const watching = (funded || confirming) && !launch;
  const pendingSettlement =
    active && view !== null && ["won", "lost", "refunded"].includes(view.phase);
  useEffect(() => {
    if (busy || pending || !nonce || (!watching && !pendingSettlement)) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const next = await send({ kind: "status", nonce }, controller.signal);
        if (uncertain !== null && next?.nonce === uncertain) {
          setUncertain(null);
          if (next.preparation) problem("Your wager wasn't confirmed.");
        }
        if (next?.phase === "cancelled") {
          setLaunch(false);
          setNotice(null);
          problem("Your wager wasn't confirmed. Try again.");
        } else if (next && next.phase !== "preparing") setNotice(null);
        if (next?.settled) {
          if (watching && next.phase === "refunded") {
            returnToMenu();
            toast("Your wager was refunded.", { id: QUEST_TOAST });
          }
          return;
        }
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
  }, [
    nonce,
    watching,
    pending,
    pendingSettlement,
    busy,
    send,
    returnToMenu,
    uncertain,
  ]);
  useEffect(() => {
    if (
      busy ||
      checking ||
      pending ||
      launch ||
      view?.phase !== "ready" ||
      view.settled ||
      requested.current === view.nonce
    )
      return;
    if (art?.cat === view.cat) {
      setLaunch(true);
      return;
    }
    const { nonce, cat } = view;
    let cancelled = false;
    progress("Opening the catacombs…");
    void loadDungeonArtwork(cat).then(
      (artwork) => {
        if (!cancelled) setArt(artwork);
      },
      () => {
        if (!cancelled) exit({ kind: "exit", nonce, client: client.current });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [art, busy, checking, exit, launch, pending, requested, view]);
  useEffect(() => {
    if (open) toast.dismiss(QUEST_TOAST);
  }, [open]);
  const interrupt = useCallback(() => {
    const current = latest.current;
    if (current && !current.settled)
      exit({ kind: "exit", nonce: current.nonce, client: client.current });
    else returnToMenu();
  }, [exit, returnToMenu]);
  const close = useCallback(() => {
    if (
      latest.current?.phase === "playing" &&
      !window.confirm(
        "Leaving this room forfeits your wager. Return to the menu?",
      )
    )
      return;
    interrupt();
  }, [interrupt]);
  async function begin() {
    if (
      starting.current ||
      checking ||
      confirming ||
      funded ||
      pending ||
      blocked
    )
      return;
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
    setNotice(null);
    progress("Getting your quest ready…");
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
          progress("Approve the wager in your wallet");
        approved.current = await approveDungeonReservation(
          wallet,
          expedition,
          sign,
          approved.current,
        );
        signal.throwIfAborted();
        step = "submit";
        progress("Confirming your wager…");
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
      problem(webErrorMessage(code));
      if (step === "artwork") returnToMenu();
      if (step !== "submit" && step !== "prepare") return;
      const saved = await send(
        { kind: "status", nonce: expedition?.nonce, client: client.current },
        signal,
      ).catch(() => null);
      if (signal.aborted) return;
      if (step === "submit" && !saved && latest.current?.preparation) {
        setUncertain(latest.current.nonce);
        progress("Confirming your wager…");
      } else if (saved && !saved.settled && !saved.preparation)
        progress("Confirming your quest…");
    } finally {
      if (starting.current === controller) {
        starting.current = null;
        if (!signal.aborted) setBusy(false);
      }
    }
  }
  return (
    <>
      {funded || confirming || pending ? (
        <output className="lobby-section-note">
          {pending || pendingSettlement
            ? "Resolving your quest…"
            : confirming
              ? "Confirming your wager…"
              : watching &&
                  (view?.phase === "playing" || view?.phase === "intermission")
                ? "Quest in progress."
                : "Opening the catacombs…"}
        </output>
      ) : (
        <div className="bet-card dungeon-bet">
          <div className="bet-field">
            <div className="bet-field-head">
              <label htmlFor={`dungeon-bet-${wallet}`}>Wager</label>
              <span>
                Available{" "}
                <strong className="lobby-figure">
                  {displayUsdc(state.available)}
                </strong>{" "}
                USDC
              </span>
            </div>
            <div className="bet-amount">
              <input
                id={`dungeon-bet-${wallet}`}
                inputMode="decimal"
                autoComplete="off"
                value={pendingWager ? displayUsdc(pendingWager.stake) : amount}
                onChange={(event) => setAmount(event.target.value)}
                disabled={busy || pendingWager !== null}
                aria-invalid={
                  !pendingWager &&
                  amount !== "" &&
                  (!stake || stake > BigInt(state.available))
                }
              />
              <span>USDC</span>
            </div>
          </div>
          {pendingWager && busy && (
            <p className="dungeon-offer">
              {pendingWager.maxRooms} rooms · Up to{" "}
              {displayUsdc(pendingWager.maxGross)} USDC
            </p>
          )}
          <button
            className="pixel-button lobby-play"
            aria-busy={busy || checking}
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
          <p className="lobby-section-note">
            Leaving or refreshing during a room forfeits your wager.
          </p>
        </div>
      )}
      {open && view && (
        <DungeonDialog onClose={close} onFailure={interrupt}>
          <button
            className="pixel-button dungeon-lobby"
            aria-keyshortcuts="Escape"
            type="button"
            disabled={busy}
            onClick={close}
            title={
              view.phase === "playing"
                ? "Leaving or refreshing an active room forfeits your wager"
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
            onFailure={interrupt}
          />
        </DungeonDialog>
      )}
    </>
  );
}
