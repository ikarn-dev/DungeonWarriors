"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  type DungeonArtwork,
  loadDungeonArtwork,
} from "../lib/dungeon/artwork";
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
} from "../lib/dungeon/transactions";
import { mergeDungeonView } from "../lib/dungeon/view-state";
import type { CatId } from "../lib/game/catalog";
import { displayUsdc, parseUsdc } from "../lib/game/custody-client";
import { gameDeviceKey, signGameTransaction } from "../lib/game/device-key";
import type { LobbyState } from "../lib/game/lobby-state";
import { WebApiError, webErrorMessage } from "../lib/game/web-api";
import DungeonScreen, { DungeonDialog } from "./DungeonScreen";
import LobbyToaster from "./LobbyToaster";
import { QuestLoading, type QuestStep } from "./QuestLoading";
import { QuestWager } from "./QuestWager";
import { useDungeonExit } from "./useDungeonExit";

// From Play until the game opens, the full-screen QuestLoading shows the
// steps; this toast id carries failures and the exit flow. In-game messages
// use the dungeon's own notice, because the modal dialog covers the toaster.
const QUEST_TOAST = "quest";
// Settlement after a result: a loading toast until finalized, then a short
// success. It shows in the dungeon's own toaster while the game is open and
// in the page toaster after it closes, under a separate id for each.
const DUNGEON_TOASTER = "dungeon";
const SETTLE_TOAST = { game: "settle-game", lobby: "settle-lobby" } as const;
const problem = (title: string) =>
  toast.error(title, { id: QUEST_TOAST, duration: 6000 });

export default function DungeonEntry({
  state,
  cat,
  wallet,
  blocked,
  device,
  onEnable,
  onDeposit,
  refresh,
  showMenu,
}: {
  readonly state: LobbyState;
  readonly cat: CatId;
  readonly wallet: string;
  readonly blocked: boolean;
  readonly device: string | undefined;
  readonly onEnable: () => void;
  readonly onDeposit: () => void;
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
  const [stage, setStage] = useState<QuestStep>("prepare");
  const [hidden, setHidden] = useState(false);
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
  const hideLoading = useCallback(() => {
    setHidden(true);
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
  const loading: QuestStep | null =
    open || pending || hidden
      ? null
      : busy
        ? stage
        : confirming
          ? "confirm"
          : funded && view?.phase === "ready"
            ? "open"
            : null;
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
  const settling = pendingSettlement && !pending;
  const settled = view?.settled === true;
  const settleShown = useRef(false);
  useEffect(() => {
    const where = open
      ? { id: SETTLE_TOAST.game, toasterId: DUNGEON_TOASTER }
      : { id: SETTLE_TOAST.lobby };
    toast.dismiss(open ? SETTLE_TOAST.lobby : SETTLE_TOAST.game);
    if (settling) {
      settleShown.current = true;
      toast.loading("Settling your result", where);
    } else if (settleShown.current) {
      settleShown.current = false;
      if (settled) toast.success("Result settled", where);
      else toast.dismiss(where.id);
    }
  }, [open, settling, settled]);
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
      blocked ||
      !device
    )
      return;
    const current = latest.current;
    let expedition = current && !current.settled ? current : null;
    if (!expedition && (!rawStake || !stake || stake > BigInt(state.available)))
      return;
    const artCat = expedition?.cat ?? cat;
    const controller = new AbortController();
    const { signal } = controller;
    starting.current = controller;
    setBusy(true);
    setHidden(false);
    setStage("prepare");
    setNotice(null);
    let step = "artwork";
    try {
      const artwork = await loadDungeonArtwork(artCat);
      signal.throwIfAborted();
      setArt(artwork);
      step = "prepare";
      let request: DungeonPrepare | null = null;
      if (expedition?.phase === "preparing" && expedition.preparation) {
        const previous = expedition;
        expedition = await send(
          { kind: "status", nonce: previous.nonce, client: client.current },
          signal,
        );
        if (
          (expedition?.phase === "cancelled" && expedition.settled) ||
          expedition?.preparation
        ) {
          request = {
            kind: "prepare",
            stake: previous.stake,
            cat: previous.cat,
            device,
            review: {
              maxRooms: previous.maxRooms,
              maxGross: previous.maxGross,
              rulesHash: previous.rulesHash,
            },
          };
        }
      } else if (!expedition && rawStake) {
        request = { kind: "prepare", stake: rawStake, cat, device };
      }
      if (request) {
        expedition = await send(request, signal);
        if (
          !expedition?.preparation ||
          expedition.stake !== request.stake ||
          expedition.cat !== request.cat ||
          (request.review &&
            (expedition.maxRooms !== request.review.maxRooms ||
              expedition.maxGross !== request.review.maxGross ||
              expedition.rulesHash !== request.review.rulesHash))
        )
          throw new WebApiError("INVALID_DUNGEON_QUOTE");
      }
      if (!expedition) return;
      if (expedition.preparation) {
        step = "sign";
        const key = await gameDeviceKey(wallet);
        if (!key || key.address !== device)
          throw new WebApiError("GAME_DEVICE_UNAVAILABLE");
        approved.current = await approveDungeonReservation(
          wallet,
          expedition,
          (tx) => signGameTransaction(key, tx),
          approved.current,
          device,
        );
        signal.throwIfAborted();
        step = "submit";
        setStage("confirm");
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
      problem(webErrorMessage(code));
      if (step === "artwork") returnToMenu();
      if (step !== "submit" && step !== "prepare") return;
      const saved = await send(
        { kind: "status", nonce: expedition?.nonce, client: client.current },
        signal,
      ).catch(() => null);
      if (signal.aborted) return;
      if (step === "submit" && !saved && latest.current?.preparation)
        setUncertain(latest.current.nonce);
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
        <QuestWager
          id={`dungeon-bet-${wallet}`}
          available={state.available}
          value={pendingWager ? displayUsdc(pendingWager.stake) : amount}
          onChange={setAmount}
          locked={busy || pendingWager !== null}
          invalid={!pendingWager && (!stake || stake > BigInt(state.available))}
          busy={busy}
          checking={checking}
          blocked={blocked}
          canSign={device !== undefined}
          onEnable={onEnable}
          onDeposit={onDeposit}
          onPlay={() => void begin()}
        />
      )}
      {loading && <QuestLoading step={loading} onLobby={hideLoading} />}
      {open && view && (
        <DungeonDialog onClose={close} onFailure={interrupt}>
          <LobbyToaster id={DUNGEON_TOASTER} />
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
