"use client";

import { utils } from "@anchor-lang/core";
import {
  type AccountInfo,
  Connection,
  type Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { displayUsdc } from "../lib/game/custody-client";
import { grossPayout } from "../lib/game/economy";
import { Predictor } from "../lib/game/predictor";
import { type PlayerIntent, PROTOCOL_VERSION } from "../lib/game/protocol";
import { earnedMultiplierBps, RULES_V1, runLevel } from "../lib/game/rules";
import { decodeRunAccount, runAddresses } from "../lib/game/run-accounts";
import { loadRunArtwork, type RunArtwork } from "../lib/game/run-artwork";
import { crankInstructions } from "../lib/game/run-crank";
import { RunState } from "../lib/game/run-feed";
import { getRunBlockhash } from "../lib/game/run-input";
import { mergeRunPrices, type RunPrice } from "../lib/game/run-price";
import {
  type GameIntent,
  playSponsorSchema,
} from "../lib/game/run-transactions";
import { webApi } from "../lib/game/web-api";
import { DEVNET, publicKeySchema } from "../lib/solana/addresses";
import RunControls from "./RunControls";
import RunMarket from "./RunMarket";
import { useRunDelivery } from "./useRunDelivery";

const amount = z.string().regex(/^(0|[1-9][0-9]{0,19})$/);
const marketSchema = z.enum(["BTC", "ETH", "SOL"]);
const payout = z.object({
  grossPayoutBaseUnits: amount,
  refundBaseUnits: amount,
});
const schema = z.object({
  sponsor: playSponsorSchema
    .extend({ maxAttempts: z.number().int().positive() })
    .optional(),
  run: z.object({
    status: z.enum([
      "absent",
      "reserved",
      "refundReady",
      "recoveryPending",
      "settlementReady",
      "settled",
      "refunded",
    ]),
    market: marketSchema.optional(),
    result: z
      .object({
        outcome: z.enum(["win", "loss", "technicalRefund"]),
        market: marketSchema,
      })
      .optional(),
    pending: payout.optional(),
    grossPayoutBaseUnits: amount.optional(),
    refundBaseUnits: amount.optional(),
  }),
  er: z
    .strictObject({
      slot: z.number().int().nonnegative(),
      owner: z.literal(DEVNET.program),
      data: z.string().min(12).max(14000),
      market: marketSchema,
      endpoint: z
        .string()
        .regex(/^https:\/\/devnet-(us|eu|as)\.magicblock\.app\/?$/),
      inputKey: publicKeySchema,
      activationExpired: z.boolean(),
      recoveryAvailable: z.boolean().optional(),
    })
    .nullable(),
});
type Run = Awaited<ReturnType<typeof decodeRunAccount>>;
const labels: Record<z.infer<typeof schema>["run"]["status"], string> = {
  absent: "Run unavailable",
  reserved: "Waiting for activation",
  refundReady: "Reservation expired",
  recoveryPending: "Checking the run on MagicBlock",
  settlementReady: "Finalizing your result…",
  settled: "Settlement finalized",
  refunded: "Refund finalized",
};
const formatNumber = new Intl.NumberFormat("en-US");
const suspensionCopy: Readonly<Record<string, string>> = {
  schedulerGap: "MagicBlock fell behind on game updates.",
  oracleStale: "The market price feed went stale.",
  oracleInvalid: "MagicBlock could not verify the market price.",
  unsafeWorld: "The game could not safely advance the course.",
};
const livePollMs = 500;
const maxCranksInFlight = 4;
const completionRetryMs = 30_000;
const powers = {
  magnet: ["Magnet", "Pulls in nearby pickups"],
  doubleJump: ["Double jump", "Press Jump again in the air"],
  shield: ["Shield", "Blocks one hit"],
  extraDash: ["Extra dash", "Dash again during cooldown"],
} as const;

export default function RunStage({
  wallet,
  nonce,
  close,
  playKey,
  artwork,
  activating,
  runSettled,
  autoDeliver = false,
  present = true,
  onFinalized,
}: {
  wallet: string;
  nonce: string;
  close?: (() => void) | undefined;
  playKey?: Keypair | undefined;
  artwork?: RunArtwork | undefined;
  activating?: boolean | undefined;
  runSettled?: () => void;
  onFinalized?: () => void;
  autoDeliver?: boolean;
  present?: boolean;
}) {
  const [status, setStatus] = useState("Reading your run…");
  const [visible, setVisible] = useState<{
    run: Run;
    market: z.infer<typeof marketSchema>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [artError, setArtError] = useState(false);
  const [artReady, setArtReady] = useState(false);
  const [prices, setPrices] = useState<RunPrice[]>([]);
  const [settlement, setSettlement] = useState<string | null>(null);
  const mount = useRef<HTMLDivElement>(null);
  const focused = useRef(false);
  const reported = useRef(false);
  const [control, setControl] = useState<{
    rpc: Connection;
    run: PublicKey;
  } | null>(null);
  const [base, setBase] = useState<z.infer<typeof schema>["run"] | null>(null);
  const [activationExpired, setActivationExpired] = useState(false);
  const [recoveryAvailable, setRecoveryAvailable] = useState(false);
  const [sponsor, setSponsor] = useState<z.infer<typeof schema>["sponsor"]>();
  const [erReachable, setErReachable] = useState(false);
  const [retryCompletion, setRetryCompletion] = useState<number | null>(null);
  const prediction = useRef<{
    engine: Predictor;
    extrapolate: boolean;
    sampledAt: number;
    confirmedTick: bigint;
    ticks: number;
    world: ReturnType<Predictor["predict"]>;
  } | null>(null);
  const rulesVersion =
    visible?.run.observation.rulesVersion ?? RULES_V1.rulesVersion;
  const predictionInput = useCallback(
    (sequence: bigint, actions: readonly PlayerIntent[]) => {
      const scene = prediction.current;
      if (!scene) return;
      const run = runAddresses({
        owner: wallet,
        nonce: BigInt(nonce),
      }).run[0].toBase58();
      scene.ticks = -1;
      if (actions.length === 0) {
        scene.engine.discardAfter(sequence);
        return;
      }
      try {
        for (const [index, action] of actions.entries())
          scene.engine.enqueue({
            protocolVersion: PROTOCOL_VERSION,
            rulesVersion,
            run,
            clientSequence: sequence + BigInt(index) + 1n,
            action,
          });
      } catch {
        // A newer snapshot already owns the sequence.
      }
    },
    [wallet, nonce, rulesVersion],
  );

  useEffect(() => {
    const controller = new AbortController();
    const identity = { owner: wallet, nonce: BigInt(nonce) };
    const addresses = runAddresses(identity);
    const feed = new RunState();
    const run = addresses.run[0];
    let lastSlot = -1;
    let timer: ReturnType<typeof setTimeout>;
    let erTimer: ReturnType<typeof setTimeout>;
    let er: Connection | undefined;
    let subscription: number | undefined;
    let lastPush = 0;
    let lastAdvance = 0;
    let lastFrameTick = -1n;
    let lastData: Buffer | undefined;
    let livePhase: Run["observation"]["phase"] | undefined;
    let stopped = false;
    let lastPrice: bigint | undefined;
    let initialChecks = playKey ? 5 : 0;
    function disconnectFeed() {
      if (er && subscription !== undefined)
        void er.removeAccountChangeListener(subscription).catch(() => {});
      er = undefined;
      subscription = undefined;
      clearTimeout(erTimer);
    }
    async function apply(
      info: Pick<AccountInfo<Buffer>, "owner" | "data" | "executable">,
      slot: number,
      market: z.infer<typeof marketSchema>,
    ) {
      if (
        controller.signal.aborted ||
        slot < lastSlot ||
        lastData?.equals(info.data)
      )
        return;
      const decoded = await decodeRunAccount(identity, run, info);
      if (controller.signal.aborted || slot < lastSlot || stopped) return;
      feed.applyRun(slot, decoded);
      lastSlot = slot;
      lastData = info.data;
      livePhase = decoded.observation.phase;
      if (decoded.observation.activeTicks > lastFrameTick) {
        lastFrameTick = decoded.observation.activeTicks;
        lastAdvance = performance.now();
      }
      const quote = decoded.prices.at(-1);
      if (quote && (lastPrice === undefined || quote.sequence > lastPrice)) {
        lastPrice = quote.sequence;
        setPrices((points) => mergeRunPrices(points, decoded.prices));
      }
      if (decoded.prediction !== null) {
        const previous = prediction.current;
        const confirmedTick = decoded.prediction.frame.activeTicks;
        const engine =
          previous?.engine ?? new Predictor(decoded.prediction, decoded.stats);
        if (engine.reconcile(decoded.prediction)) {
          const now = performance.now();
          const tickMs = 1000 / RULES_V1.ticksPerSecond;
          const sampledAt = previous?.extrapolate
            ? Math.min(
                now,
                Math.max(
                  now - RULES_V1.maxPredictionTicks * tickMs,
                  previous.sampledAt +
                    Number(confirmedTick - previous.confirmedTick) * tickMs,
                ),
              )
            : now;
          prediction.current = {
            engine,
            extrapolate:
              decoded.prediction.frame.phase === "active" &&
              decoded.prediction.frame.activeTicks > 0n,
            sampledAt,
            confirmedTick,
            ticks: 0,
            world: engine.predict(0),
          };
        }
      }
      setError(null);
      setVisible({ run: decoded, market });
      setStatus(
        decoded.observation.phase === "active"
          ? decoded.observation.activeTicks === 0n
            ? "Waiting for the first MagicBlock tick"
            : "Run active on MagicBlock"
          : decoded.observation.phase === "suspended"
            ? "Run suspended"
            : decoded.observation.phase === "ready"
              ? "Waiting for activation"
              : "Waiting for settlement",
      );
      if (decoded.terminal !== null) {
        const { grossPayoutBaseUnits: gross, refundBaseUnits: refund } =
          decoded.terminal;
        if (typeof gross === "bigint" && typeof refund === "bigint")
          setSettlement(
            refund > 0n
              ? `Pending refund ${displayUsdc(refund.toString())} USDC`
              : `Pending payout ${displayUsdc(gross.toString())} USDC`,
          );
      }
    }
    async function pollEr(
      rpc: Connection,
      market: z.infer<typeof marketSchema>,
    ) {
      try {
        if (
          document.hidden ||
          performance.now() - lastPush < livePollMs * 2 ||
          stopped ||
          er !== rpc ||
          controller.signal.aborted
        )
          return;
        const { value, context } = await rpc.getAccountInfoAndContext(
          run,
          "confirmed",
        );
        if (value !== null && er === rpc)
          await apply(value, context.slot, market);
      } catch {
        if (!controller.signal.aborted && !stopped)
          setError("Live run updates are delayed.");
      } finally {
        if (!controller.signal.aborted && !stopped && er === rpc)
          erTimer = setTimeout(() => void pollEr(rpc, market), livePollMs);
      }
    }
    const poll = async () => {
      try {
        // During healthy play, a pinned MagicBlock feed is enough. Read Solana
        // escrow again when the run finishes or MagicBlock stops advancing.
        if (
          er &&
          livePhase === "active" &&
          performance.now() - lastAdvance < 2500
        )
          return;
        const response = schema.parse(
          await webApi(
            "/api/chain/state",
            { kind: "liveRun", nonce },
            AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
          ),
        );
        if (controller.signal.aborted) return;
        setError(null);
        setBase(response.run);
        setSponsor(response.sponsor);
        setErReachable(response.er !== null);
        setActivationExpired(response.er?.activationExpired === true);
        setRecoveryAvailable(response.er?.recoveryAvailable === true);
        const funds = response.run.pending ?? response.run;
        const gross = funds.grossPayoutBaseUnits;
        const refund = funds.refundBaseUnits;
        if (gross !== undefined && refund !== undefined) {
          setSettlement(
            response.run.result?.outcome === "loss"
              ? "Wager settled"
              : `${response.run.pending ? "Pending" : "Finalized"} ${
                  refund !== "0"
                    ? `refund ${displayUsdc(refund)}`
                    : `payout ${displayUsdc(gross)}`
                } USDC`,
          );
        }
        if (response.er === null) {
          if (response.run.status === "absent" && initialChecks > 0) return;
          if (
            response.run.status === "recoveryPending" &&
            er &&
            livePhase === "active"
          )
            return;
          setStatus(labels[response.run.status]);
          stopped = true;
          disconnectFeed();
          setControl(null);
          if (
            response.run.status !== "recoveryPending" &&
            livePhase !== "terminalRecorded" &&
            livePhase !== "completionRequested"
          )
            setVisible(null);
          if (["settled", "refunded", "absent"].includes(response.run.status))
            controller.abort();
          return;
        }
        stopped = false;
        await apply(
          {
            owner: new PublicKey(response.er.owner),
            data: utils.bytes.base64.decode(response.er.data),
            executable: false,
          },
          response.er.slot,
          response.er.market,
        );
        initialChecks = 0;
        if (!er && playKey?.publicKey.toBase58() === response.er.inputKey) {
          const rpc = new Connection(response.er.endpoint, {
            commitment: "confirmed",
            disableRetryOnRateLimit: true,
            fetch: (url, options) =>
              fetch(url, {
                ...options,
                redirect: "error",
                signal: AbortSignal.timeout(8000),
              }),
          });
          er = rpc;
          setControl({ rpc, run });
          void pollEr(rpc, response.er.market);
          const market = response.er.market;
          subscription = rpc.onAccountChange(
            run,
            (info, { slot }) => {
              if (document.hidden || er !== rpc) return;
              void apply(info, slot, market).then(
                () => {
                  lastPush = performance.now();
                },
                () => {
                  if (!controller.signal.aborted)
                    setError("Live run updates are delayed.");
                },
              );
            },
            "confirmed",
          );
        }
      } catch {
        if (!controller.signal.aborted)
          setError("Run data is temporarily unavailable.");
      } finally {
        if (!controller.signal.aborted) {
          const delay = initialChecks > 0 ? 1200 : 6000;
          if (initialChecks > 0) initialChecks--;
          timer = setTimeout(() => void poll(), delay);
        }
      }
    };
    prediction.current = null;
    setPrices([]);
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
      disconnectFeed();
    };
  }, [wallet, nonce, playKey]);

  const phase = visible?.run.observation.phase;
  const started = (visible?.run.observation.activeTicks ?? 0n) > 0n;
  useEffect(() => {
    if (playKey && artReady && phase === "active" && !focused.current) {
      focused.current = true;
      mount.current?.focus({ preventScroll: true });
    }
  }, [artReady, phase, playKey]);
  const crank = visible?.run.crank;
  const crankActive = phase === "active" && (artReady || started || !present);
  const crankOracle = crank?.oracle;
  const crankEpoch = crank?.epoch;
  const crankGeneration = crank?.generation;
  const crankInterval = crank?.intervalMs;
  useEffect(() => {
    if (
      !control ||
      !playKey ||
      !crankActive ||
      !crankOracle ||
      !crankEpoch ||
      !crankInterval ||
      !crankGeneration ||
      crankGeneration === "0"
    )
      return;
    const controller = new AbortController();
    const { rpc, run } = control;
    const oracle = new PublicKey(crankOracle);
    const epoch = crankEpoch;
    const generation = crankGeneration;
    const driver = crypto.randomUUID();
    let attempt = 0;
    let inFlight = 0;
    async function drive(key: Keypair) {
      if (controller.signal.aborted || inFlight >= maxCranksInFlight) return;
      inFlight++;
      try {
        const { blockhash } = await getRunBlockhash(rpc);
        if (controller.signal.aborted) return;
        const message = new TransactionMessage({
          payerKey: key.publicKey,
          recentBlockhash: blockhash,
          instructions: crankInstructions(
            run,
            key.publicKey,
            oracle,
            epoch,
            generation,
            `${driver}:${attempt++}`,
          ),
        }).compileToV0Message();
        const tx = new VersionedTransaction(message);
        tx.sign([key]);
        await rpc.sendRawTransaction(tx.serialize(), {
          skipPreflight: true,
          maxRetries: 0,
        });
      } catch {
        // A failed trigger grants no progress. Confirmed snapshots drive the UI.
      } finally {
        inFlight--;
      }
    }
    void drive(playKey);
    const timer = setInterval(() => void drive(playKey), crankInterval);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [
    control,
    playKey,
    crankActive,
    crankOracle,
    crankEpoch,
    crankGeneration,
    crankInterval,
  ]);

  const cat = visible?.run.cat;
  const version = visible?.run.assetBinding.version;
  const hash = visible?.run.assetBinding.contentHash;
  const hasWorld = visible?.run.prediction != null;

  useEffect(() => {
    if (!present) {
      focused.current = false;
      setArtReady(false);
      return;
    }
    const parent = mount.current;
    if (
      !parent ||
      !hasWorld ||
      cat === undefined ||
      version === undefined ||
      hash === undefined
    )
      return;
    const controller = new AbortController();
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    let game:
      | ReturnType<typeof import("../lib/game/render-run").renderRun>
      | undefined;
    setArtError(false);
    setArtReady(false);
    async function attach(
      container: HTMLDivElement,
      selected: typeof cat,
      binding: { version: number; contentHash: string },
    ) {
      if (selected === undefined) return;
      const { engine, manifest, renderRun, assets } =
        artwork?.binding.version === binding.version &&
        artwork.binding.contentHash === binding.contentHash &&
        artwork.cat === selected
          ? artwork
          : await loadRunArtwork(binding, controller.signal);
      if (controller.signal.aborted) return;
      const initial = prediction.current?.world;
      if (!initial) return;
      game = renderRun(
        engine,
        container,
        manifest,
        selected,
        () => {
          const active = prediction.current;
          if (!active) return initial;
          const ticks = active.extrapolate
            ? Math.min(
                RULES_V1.maxPredictionTicks,
                Math.floor(
                  ((performance.now() - active.sampledAt) *
                    RULES_V1.ticksPerSecond) /
                    1000,
                ),
              )
            : 0;
          if (ticks !== active.ticks) {
            try {
              active.world = active.engine.predict(ticks);
              active.ticks = ticks;
            } catch {
              active.extrapolate = false;
              active.world = active.engine.predict(0);
              active.ticks = 0;
            }
          }
          return active.world;
        },
        () => reduced.matches,
        () => {
          if (!controller.signal.aborted) setArtError(true);
        },
        () => {
          if (!controller.signal.aborted) setArtReady(true);
        },
        assets,
      );
    }
    void attach(parent, cat, { version, contentHash: hash }).catch(() => {
      if (!controller.signal.aborted) setArtError(true);
    });
    return () => {
      controller.abort();
      game?.destroy(true);
    };
  }, [artwork, cat, version, hash, hasWorld, present]);

  const frame = visible?.run.prediction?.frame;
  const terminal = base?.status === "settled" || base?.status === "refunded";
  useEffect(() => {
    if (terminal && !reported.current) {
      reported.current = true;
      onFinalized?.();
    }
  }, [terminal, onFinalized]);
  const finalizing = visible?.run.observation.phase === "completionRequested";
  const market = visible?.market ?? base?.market ?? base?.result?.market;
  const suspension = visible?.run.suspensionReason;
  const suspendedAt = visible?.run.suspendedAt;
  const canResume =
    phase === "suspended" &&
    suspendedAt != null &&
    playKey &&
    !visible?.run.inputKeyRevoked &&
    (suspension === "schedulerGap" ||
      suspension === "oracleStale" ||
      suspension === "oracleInvalid");
  const completionAttempts =
    finalizing && visible ? visible.run.crank.completionAttempts : null;
  const maxAttempts = sponsor?.maxAttempts ?? 0;
  useEffect(() => {
    if (
      completionAttempts === null ||
      completionAttempts >= maxAttempts ||
      !erReachable
    )
      return;
    const timer = setTimeout(
      () => setRetryCompletion(completionAttempts),
      completionRetryMs,
    );
    return () => clearTimeout(timer);
  }, [completionAttempts, maxAttempts, erReachable]);
  let nextAction: GameIntent["action"] | null = null;
  if (autoDeliver && !terminal) {
    if (base?.status === "refundReady") {
      nextAction = { kind: "abortUndelegatedReservation", nonce };
    } else if (base?.status === "settlementReady" && market) {
      nextAction = { kind: "settleReturnedRun", nonce, market };
    } else if (activationExpired && phase === "ready") {
      nextAction = { kind: "expireDelegatedActivation", nonce };
    } else if (
      recoveryAvailable &&
      market &&
      (phase === "active" || phase === "suspended")
    ) {
      nextAction = { kind: "suspendOrResumeRun", nonce, market };
    } else if (canResume && market) {
      nextAction = {
        kind: "resumeRun",
        nonce,
        market,
        inputKey: playKey.publicKey.toBase58(),
        suspendedAt: suspendedAt.toString(),
      };
    } else if (
      market &&
      visible &&
      (phase === "terminalRecorded" ||
        (erReachable &&
          completionAttempts !== null &&
          completionAttempts === retryCompletion &&
          completionAttempts < maxAttempts))
    ) {
      nextAction = {
        kind: "requestCompletion",
        nonce,
        market,
        hasCrank: visible.run.crank.generation !== "0",
        expectedAttempt: visible.run.crank.completionAttempts,
      };
    }
  }
  const actionNotice = useRunDelivery(wallet, nextAction, sponsor, playKey);
  const qualified = (frame?.qualifiedCheckpoints ?? 0n) > 0n;
  const checkpoint = frame
    ? Number(frame.activeTicks % BigInt(RULES_V1.checkpointTicks))
    : 0;
  const paused = phase === "suspended";
  const playing = phase === "active";
  const speed = frame
    ? frame.runner.automaticSpeedSubpixelsPerTick /
      RULES_V1.physics.runnerSpeedSubpixelsPerTick
    : 1;
  const power = visible?.run.stats.power;
  const state = power && frame?.powers[power];
  const pickedUp = frame
    ? (Object.keys(powers) as (keyof typeof powers)[])
        .filter(
          (name) =>
            name !== power &&
            frame.powers[name].charges > 0 &&
            frame.powers[name].endsAtTick > frame.activeTicks,
        )
        .map((name) => `${powers[name][0]} active`)
    : [];
  const powerControl =
    power && state && frame
      ? {
          name: powers[power][0],
          ready: state.readyAtTick <= frame.activeTicks,
          detail: [
            state.charges > 0 && state.endsAtTick > frame.activeTicks
              ? `${powers[power][0]} active. ${powers[power][1]}.`
              : state.readyAtTick > frame.activeTicks
                ? `${powers[power][0]} ready in ${Math.ceil(Number(state.readyAtTick - frame.activeTicks) / RULES_V1.ticksPerSecond)}s`
                : rulesVersion === 2 &&
                    (power === "doubleJump" || power === "extraDash")
                  ? powers[power][1]
                  : `${powers[power][0]} ready`,
            ...pickedUp,
          ].join(" · "),
        }
      : null;
  const statusPanel = !artReady || !playing;
  const resultTitle =
    base?.result?.outcome === "loss" ||
    visible?.run.observation.terminalReason === "crash"
      ? "Run over"
      : base?.result?.outcome === "win"
        ? "Cash out complete"
        : base?.result?.outcome === "technicalRefund"
          ? "Wager refunded"
          : null;

  if (!present) return null;

  return (
    <section className="run-stage" aria-label="Run viewer">
      <div className="run-stage-bar">
        <h3>
          {market && `${market}/USD · `}Run {formatNumber.format(BigInt(nonce))}
        </h3>
        {(close || (terminal && runSettled)) && (
          <button
            className="run-control"
            type="button"
            onClick={terminal && runSettled ? runSettled : close}
          >
            {terminal ? "Done" : "Close viewer"}
          </button>
        )}
      </div>
      {hasWorld && frame && (
        <div className="run-playfield">
          <div
            className="run-canvas"
            ref={mount}
            role="application"
            tabIndex={control && playing && artReady ? 0 : -1}
            aria-label="Game playfield"
          />
          <dl className="run-hud">
            <div>
              <dt>Level</dt>
              <dd>{formatNumber.format(runLevel(frame.activeTicks))}</dd>
            </div>
            <div>
              <dt>Score</dt>
              <dd>{formatNumber.format(frame.score)}</dd>
            </div>
            <div>
              <dt>Coins</dt>
              <dd>{formatNumber.format(frame.totalCoins)}</dd>
            </div>
            <div>
              <dt>Speed</dt>
              <dd>{speed.toFixed(2)}×</dd>
            </div>
            <div className="run-checkpoint">
              <dt id={`checkpoint-${nonce}`}>Checkpoint</dt>
              <dd>
                <progress
                  aria-labelledby={`checkpoint-${nonce}`}
                  value={checkpoint}
                  max={RULES_V1.checkpointTicks}
                />
              </dd>
            </div>
          </dl>
          {market && <RunMarket market={market} prices={prices} />}
          {playing && artReady && (
            <p className="run-rotate">Rotate to landscape to play</p>
          )}
          {statusPanel && (
            <div className="run-overlay">
              <div aria-live="polite">
                <h4>
                  {artError
                    ? "Artwork unavailable"
                    : paused
                      ? "Reconnecting…"
                      : (resultTitle ??
                        error ??
                        (artReady ? status : "Loading the course…"))}
                </h4>
                {paused && (
                  <p>
                    {error ??
                      (suspension && suspensionCopy[suspension]) ??
                      "MagicBlock paused the run."}{" "}
                    {recoveryAvailable
                      ? "Returning the original wager."
                      : canResume
                        ? "Your run will continue from here when the feed recovers."
                        : "Waiting for MagicBlock to resolve the run."}
                  </p>
                )}
                {artError && <p>Reopen the run to reload its artwork.</p>}
                {settlement && <p>{settlement}</p>}
              </div>
              {actionNotice && !terminal && <output>{actionNotice}</output>}
            </div>
          )}
        </div>
      )}
      {!hasWorld && (
        <div className="run-message" aria-live="polite">
          <h4>
            {resultTitle ??
              error ??
              (activating && base?.status === "recoveryPending"
                ? "Starting on MagicBlock…"
                : status)}
          </h4>
          {settlement && <p>{settlement}</p>}
        </div>
      )}
      {playing && error && <output className="run-notice">{error}</output>}
      {!terminal &&
        playing &&
        control &&
        playKey &&
        frame &&
        visible &&
        powerControl && (
          <div className="run-deck">
            <div className="run-earnings">
              <span>Cash out</span>
              <strong>
                {qualified
                  ? `${displayUsdc(grossPayout(visible.run.stake, frame.qualifiedCheckpoints, visible.run.maxGross).toString())} USDC`
                  : "Locked"}
              </strong>
              <small>
                {qualified
                  ? `${earnedMultiplierBps(frame.qualifiedCheckpoints) / 10_000}× earned`
                  : "Reach a qualifying checkpoint"}
              </small>
            </div>
            <RunControls
              rpc={control.rpc}
              run={control.run}
              playKey={playKey}
              eligible={qualified}
              accepted={visible.run.observation.acceptedSequence}
              playing={playing}
              artReady={artReady}
              surface={mount}
              power={powerControl}
              onInputs={predictionInput}
              rulesVersion={rulesVersion}
            />
          </div>
        )}
      {playing && !control && (
        <p className="run-notice">
          Controls are available in the tab that authorized this run.
        </p>
      )}
      {!terminal && finalizing && (
        <p className="run-notice">Settling on Solana Devnet.</p>
      )}
      {!hasWorld && actionNotice && !terminal && (
        <output className="run-notice">{actionNotice}</output>
      )}
    </section>
  );
}
