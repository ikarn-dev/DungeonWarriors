"use client";

import { utils } from "@anchor-lang/core";
import {
  type AccountInfo,
  Connection,
  type Keypair,
  PublicKey,
} from "@solana/web3.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { displayUsdc } from "../lib/game/custody-client";
import { grossPayout } from "../lib/game/economy";
import { Predictor } from "../lib/game/predictor";
import { type PlayerIntent, PROTOCOL_VERSION } from "../lib/game/protocol";
import { earnedMultiplierBps, RULES_V1 } from "../lib/game/rules";
import { decodeRunAccount, runAddresses } from "../lib/game/run-accounts";
import type { RunArtwork } from "../lib/game/run-artwork";
import { RunState } from "../lib/game/run-feed";
import { mergeRunPrices, type RunPrice } from "../lib/game/run-price";
import {
  type GameIntent,
  playSponsorSchema,
} from "../lib/game/run-transactions";
import { webApi } from "../lib/game/web-api";
import { DEVNET, publicKeySchema } from "../lib/solana/addresses";
import RunControls from "./RunControls";
import { POWER_LABELS, RunHud, RunPanel } from "./RunHud";
import { useRunCrank } from "./useRunCrank";
import { useRunDelivery } from "./useRunDelivery";
import { type RunPrediction, useRunRenderer } from "./useRunRenderer";

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
const completionRetryMs = 30_000;
const powerHints = {
  magnet: "Pulling in nearby pickups",
  doubleJump: "Jump again in the air",
  shield: "Blocks one hit",
  extraDash: "Dash again during cooldown",
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
  media,
  onFinalized,
}: {
  wallet: string;
  nonce: string;
  // Current published catalog media; every run renders with this version.
  media: { version: number; contentHash: string } | null;
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
  const [prices, setPrices] = useState<RunPrice[]>([]);
  const [settlement, setSettlement] = useState<string | null>(null);
  const mount = useRef<HTMLDivElement>(null);
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
  const prediction = useRef<RunPrediction | null>(null);
  const revision = useRef(0);
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
          revision.current++;
          prediction.current = {
            engine,
            extrapolate:
              decoded.prediction.frame.phase === "active" &&
              decoded.prediction.frame.activeTicks > 0n,
            sampledAt,
            confirmedTick,
            ticks: 0,
            lead: 0,
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
  const cat = visible?.run.cat;
  const hasWorld = visible?.run.prediction != null;
  const { artReady, artError } = useRunRenderer({
    present,
    mount,
    hasWorld,
    rulesVersion,
    cat,
    media,
    artwork,
    prediction,
    revision,
    focusable: !!playKey && phase === "active",
  });
  useRunCrank(
    control,
    playKey,
    phase === "active" && (artReady || started || !present),
    visible?.run.crank,
  );

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
  const paused = phase === "suspended";
  const playing = phase === "active";
  const power = visible?.run.stats.power;
  const state = power && frame?.powers[power];
  const cooldown = visible?.run.stats.powerCooldownTicks ?? 1;
  const pickedUp = frame
    ? (Object.keys(POWER_LABELS) as (keyof typeof POWER_LABELS)[])
        .filter(
          (name) =>
            name !== power &&
            frame.powers[name].charges > 0 &&
            frame.powers[name].endsAtTick > frame.activeTicks,
        )
        .map((name) => `${POWER_LABELS[name]} active`)
    : [];
  const powerControl =
    power && state && frame
      ? {
          id: power,
          name: POWER_LABELS[power],
          ready: state.readyAtTick <= frame.activeTicks,
          active: state.charges > 0 && state.endsAtTick > frame.activeTicks,
          remaining: Math.min(
            1,
            Math.max(
              0,
              Number(state.readyAtTick - frame.activeTicks) / cooldown,
            ),
          ),
          detail: [
            state.charges > 0 && state.endsAtTick > frame.activeTicks
              ? powerHints[power]
              : state.readyAtTick > frame.activeTicks
                ? `Ready in ${Math.ceil(Number(state.readyAtTick - frame.activeTicks) / RULES_V1.ticksPerSecond)}s`
                : rulesVersion >= 2 &&
                    (power === "doubleJump" || power === "extraDash")
                  ? powerHints[power]
                  : "Ready",
            ...pickedUp,
          ].join(" · "),
        }
      : null;
  const payout =
    qualified && frame && visible
      ? {
          amount: `${displayUsdc(grossPayout(visible.run.stake, frame.qualifiedCheckpoints, visible.run.maxGross).toString())} USDC`,
          multiplier: `${earnedMultiplierBps(frame.qualifiedCheckpoints) / 10_000}×`,
        }
      : null;
  const settling =
    phase === "terminalRecorded" ||
    finalizing ||
    base?.status === "settlementReady";
  const resultTitle =
    base?.result?.outcome === "win"
      ? "Cash out complete"
      : base?.result?.outcome === "technicalRefund"
        ? "Wager refunded"
        : base?.result?.outcome === "loss" ||
            (settling && visible?.run.observation.terminalReason === "crash")
          ? "Run over"
          : settling
            ? labels.settlementReady
            : null;
  const statusPanel =
    !hasWorld || !artReady || !playing || resultTitle !== null;
  const showArtError = hasWorld && artError && resultTitle === null;
  const panelTitle =
    resultTitle ??
    (showArtError
      ? "Artwork unavailable"
      : paused && hasWorld
        ? "Reconnecting…"
        : (error ??
          (!hasWorld && activating && base?.status === "recoveryPending"
            ? "Starting on MagicBlock…"
            : !hasWorld || artReady
              ? status
              : "Loading the course…")));
  const finish = terminal && runSettled ? runSettled : undefined;
  const toast =
    (playing && error) ||
    (playing && !control
      ? "Controls are available in the tab that authorized this run."
      : null);

  if (!present) return null;

  return (
    <section className="run-stage" aria-label="Run viewer">
      <h3 className="sr-only">
        {market && `${market}/USD · `}Run {formatNumber.format(BigInt(nonce))}
      </h3>
      <div className="run-playfield">
        <div
          className="run-canvas"
          ref={mount}
          role="application"
          tabIndex={control && playing && artReady ? 0 : -1}
          aria-label="Game playfield"
        />
        {hasWorld && frame && cat && power && visible && (
          <RunHud
            frame={frame}
            cat={cat}
            catLevel={visible.run.catLevel}
            power={power}
            market={market}
            prices={prices}
            nonce={nonce}
          />
        )}
        {close && !finish && (
          <button
            className="pixel-button run-close"
            type="button"
            onClick={close}
          >
            Close viewer
          </button>
        )}
        {statusPanel && (
          <RunPanel title={panelTitle}>
            {hasWorld && paused && resultTitle === null && (
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
            {showArtError && <p>Reopen the run to reload its artwork.</p>}
            {settlement && <p className="run-panel-amount">{settlement}</p>}
            {actionNotice && !terminal && <output>{actionNotice}</output>}
            {finish && (
              <button
                type="button"
                className="pixel-button"
                data-tone="gold"
                onClick={finish}
              >
                Done
              </button>
            )}
          </RunPanel>
        )}
        {playing && artReady && (
          <p className="run-rotate">
            <span className="pixel-icon" data-icon="rotate-device" />
            Rotate to landscape to play
          </p>
        )}
        {toast && <output className="run-toast pixel-panel">{toast}</output>}
        {!terminal &&
          playing &&
          control &&
          playKey &&
          visible &&
          powerControl && (
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
              payout={payout}
              onInputs={predictionInput}
              rulesVersion={rulesVersion}
            />
          )}
      </div>
    </section>
  );
}
