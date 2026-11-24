"use client";
import { VersionedTransaction } from "@solana/web3.js";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type DungeonArtwork,
  loadDungeonArtwork,
} from "../lib/dungeon/artwork";
import {
  type DungeonOffer,
  type DungeonRequest,
  type DungeonView,
  dungeonOfferSchema,
  dungeonViewSchema,
} from "../lib/dungeon/protocol";
import { validateDungeonReservation } from "../lib/dungeon/transactions";
import { mergeDungeonView } from "../lib/dungeon/view-state";
import type { CatId } from "../lib/game/catalog";
import { displayUsdc, parseUsdc } from "../lib/game/custody-client";
import type { LobbyState } from "../lib/game/lobby-state";
import { WebApiError, webApi, webErrorMessage } from "../lib/game/web-api";
import DungeonStage from "./DungeonStage";

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
  const [view, setView] = useState<DungeonView | null>(null);
  const [art, setArt] = useState<DungeonArtwork | null>(null);
  const [amount, setAmount] = useState(""),
    [offer, setOffer] = useState<DungeonOffer | null>(null);
  const [busy, setBusy] = useState(false),
    [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  let stake: bigint | null = null;
  try {
    stake = parseUsdc(amount);
  } catch {
    stake = null;
  }
  const rawStake = stake?.toString();
  const active = view !== null && !view.settled;
  useEffect(() => {
    latest.current = view;
  }, [view]);
  const accept = useCallback(
    (incoming: DungeonView | null, newApproval = false) => {
      const next = mergeDungeonView(latest.current, incoming, newApproval);
      if (next && next.owner !== wallet)
        throw new Error("INVALID_DUNGEON_RESPONSE");
      if (newApproval && next?.phase === "preparing") finalized.current = null;
      latest.current = next;
      setView(next);
      if (next?.settled && finalized.current !== next.nonce) {
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
    async (input: DungeonRequest) => {
      return accept(
        dungeonViewSchema
          .nullable()
          .parse(
            await webApi("/api/dungeon", input, AbortSignal.timeout(12000)),
          ),
        input.kind === "quote",
      );
    },
    [accept],
  );
  const artworkCat = view && !view.settled ? view.cat : cat;
  useEffect(() => {
    let live = true;
    void loadDungeonArtwork(artworkCat).then(
      (value) => {
        if (live) setArt(value);
      },
      () => {
        if (live)
          setNotice(
            "Dungeon artwork could not load. Retry before placing a wager.",
          );
      },
    );
    return () => {
      live = false;
    };
  }, [artworkCat]);
  useEffect(() => {
    const controller = new AbortController();
    void webApi(
      "/api/dungeon",
      { kind: "status", client: client.current },
      controller.signal,
    )
      .then((value) => {
        if (!controller.signal.aborted)
          accept(dungeonViewSchema.nullable().parse(value));
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setNotice("Could not check your previous expedition. Try again.");
      });
    return () => controller.abort();
  }, [accept]);
  useEffect(() => {
    if (active || !rawStake) {
      setOffer(null);
      return;
    }
    const controller = new AbortController();
    setOffer(null);
    const timer = setTimeout(() => {
      void webApi(
        "/api/dungeon",
        { kind: "offer", stake: rawStake, cat },
        controller.signal,
      )
        .then((value) => {
          if (!controller.signal.aborted) {
            setOffer(dungeonOfferSchema.parse(value));
            setNotice(null);
          }
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted)
            setNotice(
              error instanceof WebApiError
                ? webErrorMessage(error.code)
                : "Could not quote this expedition.",
            );
        });
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [active, rawStake, cat]);
  const phase = view?.phase,
    settled = view?.settled,
    nonce = view?.nonce;
  useEffect(() => {
    if (
      !nonce ||
      settled ||
      phase === "playing" ||
      phase === "intermission" ||
      phase === "ready"
    )
      return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        await webApi(
          "/api/dungeon",
          { kind: "status", nonce, client: client.current },
          controller.signal,
        ).then((value) => {
          if (!controller.signal.aborted)
            accept(dungeonViewSchema.nullable().parse(value));
        });
      } catch {
        if (!controller.signal.aborted)
          setNotice("Your expedition is saved. Checking its status…");
      }
      if (!controller.signal.aborted)
        timer = setTimeout(() => void poll(), 2500);
    }
    timer = setTimeout(() => void poll(), 1000);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [phase, settled, nonce, accept]);
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
    setOpen(false);
  }, [send]);
  async function begin() {
    if (!sign || !offer || !rawStake || busy || blocked) return;
    setBusy(true);
    setNotice(null);
    let quote: DungeonView | null = null;
    try {
      await loadDungeonArtwork(cat);
      quote = await send({
        kind: "quote",
        stake: rawStake,
        cat,
        maxRooms: offer.maxRooms,
        maxGross: offer.maxGross,
        rulesHash: offer.rulesHash,
      });
      if (!quote?.preparation || quote.stake !== rawStake || quote.cat !== cat)
        throw new Error("INVALID_DUNGEON_QUOTE");
      setOpen(true);
      const tx = VersionedTransaction.deserialize(
        Uint8Array.from(atob(quote.preparation.transaction), (c) =>
          c.charCodeAt(0),
        ),
      );
      validateDungeonReservation(tx, wallet, quote);
      const signed = await sign(tx);
      validateDungeonReservation(signed, wallet, quote);
      const transaction = btoa(
        Array.from(signed.serialize(), (b) => String.fromCharCode(b)).join(""),
      );
      await send({ kind: "submit", nonce: quote.nonce, transaction });
    } catch (error) {
      setNotice(
        error instanceof WebApiError
          ? webErrorMessage(error.code)
          : "The expedition could not start. Your saved request will be checked.",
      );
      if (quote)
        void send({
          kind: "exit",
          nonce: quote.nonce,
          client: client.current,
        }).catch(() =>
          setNotice(
            "Your saved expedition will be checked when your wallet returns.",
          ),
        );
      if (!quote) {
        void webApi("/api/dungeon", { kind: "offer", stake: rawStake, cat })
          .then((value) => setOffer(dungeonOfferSchema.parse(value)))
          .catch(() => setOffer(null));
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {active ? (
        <div className="lobby-banner">
          <p>
            Expedition #{view.nonce} ·{" "}
            {view.phase === "preparing" ? "Preparing" : "Saved"}
          </p>
          <button
            className="pixel-button"
            data-tone="gold"
            type="button"
            onClick={() => setOpen(true)}
          >
            Open expedition
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
              aria-invalid={
                amount !== "" && (!stake || stake > BigInt(state.available))
              }
            />
            <span>USDC</span>
          </div>
          <p className="bet-available">
            Available {displayUsdc(state.available)} USDC
          </p>
          {offer && (
            <p className="dungeon-offer">
              {offer.maxRooms} rooms · Maximum gross payout{" "}
              {displayUsdc(offer.maxGross)} USDC
            </p>
          )}
          <button
            className="pixel-button lobby-play"
            data-tone="gold"
            type="button"
            disabled={
              blocked ||
              busy ||
              !sign ||
              !offer ||
              !art ||
              art.cat !== cat ||
              !stake ||
              stake > BigInt(state.available)
            }
            onClick={() => void begin()}
          >
            {busy ? "Preparing…" : "Bet & explore"}
          </button>
          <p className="dungeon-odds-note">
            Each gate: 2 in 3 treasure. Reach it before time runs out. PURRPS
            covers Devnet fees.
          </p>
        </div>
      )}
      {notice && <output className="lobby-section-note">{notice}</output>}
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
            {art?.cat === view.cat ? (
              <DungeonStage
                view={view}
                artwork={art}
                client={client.current}
                send={send}
                onDone={close}
              />
            ) : (
              <output className="dungeon-loading">
                Loading the catacombs…
              </output>
            )}
          </div>
        )}
      </dialog>
    </>
  );
}
