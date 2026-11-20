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
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { verifyManifestBinding } from "../lib/game/assets";
import { displayUsdc } from "../lib/game/custody-client";
import { grossPayout } from "../lib/game/economy";
import { Predictor } from "../lib/game/predictor";
import { earnedMultiplierBps, RULES_V1, runLevel } from "../lib/game/rules";
import { decodeRunAccount, runAddresses } from "../lib/game/run-accounts";
import {
  confirmGameAction,
  type GameSignature,
  type RunActionSubmitter,
} from "../lib/game/run-client";
import { crankInstructions } from "../lib/game/run-crank";
import { RunState } from "../lib/game/run-feed";
import type { GameIntent } from "../lib/game/run-transactions";
import { readWebJson, webApi } from "../lib/game/web-api";
import { DEVNET, publicKeySchema } from "../lib/solana/addresses";
import RunControls from "./RunControls";

const amount = z.string().regex(/^(0|[1-9][0-9]{0,19})$/);
const marketSchema = z.enum(["BTC", "ETH", "SOL"]);
const payout = z.object({
  grossPayoutBaseUnits: amount,
  refundBaseUnits: amount,
});
const schema = z.object({
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
  settlementReady: "Ready for settlement",
  settled: "Settlement finalized",
  refunded: "Refund finalized",
};
const formatNumber = new Intl.NumberFormat("en-US");

export default function RunStage({
  wallet,
  nonce,
  close,
  playKey,
  runSettled,
  submitAction,
}: {
  wallet: string;
  nonce: string;
  close?: (() => void) | undefined;
  playKey?: Keypair | undefined;
  runSettled?: () => void;
  submitAction?: RunActionSubmitter | undefined;
}) {
  const [status, setStatus] = useState("Reading your run…");
  const [visible, setVisible] = useState<{
    run: Run;
    market: z.infer<typeof marketSchema>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [artError, setArtError] = useState(false);
  const [settlement, setSettlement] = useState<string | null>(null);
  const mount = useRef<HTMLDivElement>(null);
  const gameHeading = useRef<HTMLHeadingElement>(null);
  const focused = useRef(false);
  const [control, setControl] = useState<{
    rpc: Connection;
    run: PublicKey;
  } | null>(null);
  const [base, setBase] = useState<z.infer<typeof schema>["run"] | null>(null);
  const [activationExpired, setActivationExpired] = useState(false);
  const [recoveryAvailable, setRecoveryAvailable] = useState(false);
  const [confirmedAction, setConfirmedAction] = useState<
    GameIntent["action"]["kind"] | null
  >(null);
  const actionKind = useRef<GameIntent["action"]["kind"] | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const actionWork = useRef<AbortController | null>(null);
  const actionSignature = useRef<GameSignature | null>(null);
  const [actionPending, setActionPending] = useState(false);
  useEffect(() => () => actionWork.current?.abort(), []);
  const prediction = useRef<{
    engine: Predictor;
    extrapolate: boolean;
    sampledAt: number;
    ticks: number;
    world: ReturnType<Predictor["predict"]>;
  } | null>(null);

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
    let stopped = false;
    async function apply(
      info: Pick<AccountInfo<Buffer>, "owner" | "data" | "executable">,
      slot: number,
      market: z.infer<typeof marketSchema>,
    ) {
      if (controller.signal.aborted || slot < lastSlot) return;
      const decoded = await decodeRunAccount(identity, run, info);
      if (controller.signal.aborted || slot < lastSlot || stopped) return;
      feed.applyRun(slot, decoded);
      lastSlot = slot;
      if (decoded.prediction !== null) {
        const engine =
          prediction.current?.engine ??
          new Predictor(decoded.prediction, decoded.stats);
        if (engine.reconcile(decoded.prediction))
          prediction.current = {
            engine,
            extrapolate: decoded.prediction.frame.phase === "active",
            sampledAt: performance.now(),
            ticks: 0,
            world: engine.predict(0),
          };
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
          erTimer = setTimeout(() => void pollEr(rpc, market), 500);
      }
    }
    const poll = async () => {
      try {
        if (document.hidden) return;
        const response = schema.parse(
          await webApi(
            "/api/chain/state",
            { kind: "liveRun", nonce },
            controller.signal,
          ),
        );
        if (controller.signal.aborted) return;
        setError(null);
        setBase(response.run);
        setActivationExpired(response.er?.activationExpired === true);
        setRecoveryAvailable(response.er?.recoveryAvailable === true);
        const funds = response.run.pending ?? response.run;
        const gross = funds.grossPayoutBaseUnits;
        const refund = funds.refundBaseUnits;
        if (gross !== undefined && refund !== undefined) {
          setSettlement(
            `${response.run.pending ? "Pending" : "Finalized"} ${
              refund !== "0"
                ? `refund ${displayUsdc(refund)}`
                : `payout ${displayUsdc(gross)}`
            } USDC`,
          );
        }
        if (response.er === null) {
          setStatus(labels[response.run.status]);
          stopped = true;
          clearTimeout(erTimer);
          er = undefined;
          setControl(null);
          if (response.run.status !== "recoveryPending") setVisible(null);
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
        }
      } catch {
        if (!controller.signal.aborted)
          setError("Run data is temporarily unavailable.");
      } finally {
        if (!controller.signal.aborted)
          timer = setTimeout(() => void poll(), 6000);
      }
    };
    prediction.current = null;
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
      clearTimeout(erTimer);
    };
  }, [wallet, nonce, playKey]);

  const phase = visible?.run.observation.phase;
  const started = (visible?.run.observation.activeTicks ?? 0n) > 0n;
  useEffect(() => {
    if (playKey && started && !focused.current) {
      focused.current = true;
      gameHeading.current?.focus();
    }
  }, [playKey, started]);
  const crank = visible?.run.crank;
  const crankActive = phase === "active" || phase === "suspended";
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
    const instructions = crankInstructions(
      run,
      playKey.publicKey,
      new PublicKey(crankOracle),
      crankEpoch,
      crankGeneration,
    );
    let timer: ReturnType<typeof setTimeout>;
    let lastBlockhash = "";
    async function drive(key: Keypair, interval: number) {
      const started = performance.now();
      try {
        const { blockhash } = await rpc.getLatestBlockhash("confirmed");
        if (controller.signal.aborted || lastBlockhash === blockhash) return;
        const message = new TransactionMessage({
          payerKey: key.publicKey,
          recentBlockhash: blockhash,
          instructions,
        }).compileToV0Message();
        const tx = new VersionedTransaction(message);
        tx.sign([key]);
        lastBlockhash = blockhash;
        await rpc.sendRawTransaction(tx.serialize(), {
          skipPreflight: true,
          maxRetries: 0,
        });
      } catch {
        // A later blockhash can retry a due scheduler task. Only confirmed snapshots drive the UI.
      } finally {
        if (!controller.signal.aborted)
          timer = setTimeout(
            () => void drive(key, interval),
            Math.max(0, interval - (performance.now() - started)),
          );
      }
    }
    void drive(playKey, crankInterval);
    return () => {
      controller.abort();
      clearTimeout(timer);
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
    async function attach(
      container: HTMLDivElement,
      selected: typeof cat,
      binding: { version: number; contentHash: string },
    ) {
      if (selected === undefined) return;
      const response = await fetch(
        `/game-assets/v${binding.version}/manifest.json`,
        { signal: controller.signal },
      );
      if (!response.ok) throw new Error("ASSETS_NOT_READY");
      const manifest = await verifyManifestBinding(
        await readWebJson(response),
        binding,
      );
      const [{ default: Phaser }, { renderRun }] = await Promise.all([
        import("phaser"),
        import("../lib/game/render-run"),
      ]);
      if (controller.signal.aborted) return;
      const initial = prediction.current?.world;
      if (!initial) return;
      game = renderRun(
        Phaser,
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
            active.world = active.engine.predict(ticks);
            active.ticks = ticks;
          }
          return active.world;
        },
        () => reduced.matches,
        () => {
          if (!controller.signal.aborted) setArtError(true);
        },
      );
    }
    void attach(parent, cat, { version, contentHash: hash }).catch(() => {
      if (!controller.signal.aborted) setArtError(true);
    });
    return () => {
      controller.abort();
      game?.destroy(true);
    };
  }, [cat, version, hash, hasWorld]);

  const frame = visible?.run.prediction?.frame;
  const terminal = base?.status === "settled" || base?.status === "refunded";
  const finalizing = visible?.run.observation.phase === "completionRequested";
  const market = visible?.market ?? base?.market;
  const nextAction: GameIntent["action"] | null =
    base?.status === "refundReady"
      ? { kind: "abortUndelegatedReservation", nonce }
      : base?.status === "settlementReady" && market
        ? { kind: "settleReturnedRun", nonce, market }
        : activationExpired && visible?.run.observation.phase === "ready"
          ? { kind: "expireDelegatedActivation", nonce }
          : recoveryAvailable &&
              market &&
              (phase === "active" || phase === "suspended")
            ? { kind: "suspendOrResumeRun", nonce, market }
            : !terminal &&
                market &&
                visible?.run.observation.phase === "terminalRecorded"
              ? { kind: "requestCompletion", nonce, market }
              : null;
  async function settle() {
    if (
      !submitAction ||
      (!nextAction && !actionSignature.current) ||
      submitting
    )
      return;
    const controller = new AbortController();
    actionWork.current = controller;
    setSubmitting(true);
    setActionNotice("Waiting for confirmation…");
    try {
      if (!actionSignature.current && nextAction)
        actionKind.current = nextAction.kind;
      const signature =
        actionSignature.current ??
        (nextAction &&
          (await submitAction(
            nextAction,
            (value) => {
              actionSignature.current = value;
              setActionPending(value !== null);
            },
            controller.signal,
          )));
      if (!signature) return;
      const status = await confirmGameAction(signature, controller.signal);
      if (status === "pending") {
        setActionNotice(
          "Confirmation is pending. Check the original signature.",
        );
        return;
      }
      actionSignature.current = null;
      setActionPending(false);
      if (status === "confirmed") setConfirmedAction(actionKind.current);
      setActionNotice(
        status === "confirmed"
          ? "Confirmed. Waiting for finalized result."
          : "Transaction failed. Check the run status and try again.",
      );
    } catch {
      if (!controller.signal.aborted)
        setActionNotice(
          actionSignature.current
            ? "Check the original transaction before retrying."
            : "Could not submit. Check your wallet and try again.",
        );
    } finally {
      if (!controller.signal.aborted) setSubmitting(false);
    }
  }

  return (
    <section
      className="grid gap-2 rounded-md border border-[#cbd3be] p-3"
      aria-label="Run viewer"
    >
      <div className="flex items-center justify-between gap-2">
        <h3
          className="font-medium focus-visible:outline-2"
          ref={gameHeading}
          tabIndex={-1}
        >
          Run {formatNumber.format(BigInt(nonce))}
          {visible ? ` · ${visible.market}` : ""}
        </h3>
        {(close || (terminal && runSettled)) && (
          <button
            type="button"
            className="min-h-11 px-2 text-sm underline"
            onClick={terminal && runSettled ? runSettled : close}
          >
            {terminal ? "Done" : "Close viewer"}
          </button>
        )}
      </div>
      <output className="text-sm">{error ?? status}</output>
      {settlement && (
        <p className="font-mono text-sm tabular-nums">{settlement}</p>
      )}
      {hasWorld && (
        <div
          className="aspect-video w-full overflow-hidden rounded bg-[#173b32]"
          ref={mount}
          role="img"
          aria-label="Run scene"
        />
      )}
      {artError && (
        <p className="text-sm" role="alert">
          Run artwork is unavailable.
        </p>
      )}
      {frame && (
        <div className="flex flex-wrap gap-x-4 text-sm tabular-nums">
          <span>Level {formatNumber.format(runLevel(frame.activeTicks))}</span>
          <span>Score {formatNumber.format(frame.score)}</span>
          <span>
            Checkpoint{" "}
            {formatNumber.format(
              frame.activeTicks % BigInt(RULES_V1.checkpointTicks),
            )}
            /{RULES_V1.checkpointTicks}
          </span>
          {frame.qualifiedCheckpoints > 0n && (
            <span>
              {earnedMultiplierBps(frame.qualifiedCheckpoints) / 10000}× earned
            </span>
          )}
          {visible &&
            visible.run.observation.phase === "active" &&
            frame.qualifiedCheckpoints > 0n && (
              <span>
                Cash-out value{" "}
                {displayUsdc(
                  grossPayout(
                    visible.run.stake,
                    frame.qualifiedCheckpoints,
                    visible.run.maxGross,
                  ).toString(),
                )}{" "}
                USDC
              </span>
            )}
        </div>
      )}
      {!terminal &&
        control &&
        playKey &&
        visible?.run.observation.phase === "active" &&
        frame && (
          <RunControls
            rpc={control.rpc}
            run={control.run}
            playKey={playKey}
            eligible={frame.qualifiedCheckpoints > 0n}
            accepted={visible.run.observation.acceptedSequence}
          />
        )}
      {!terminal && visible?.run.observation.phase === "active" && !playKey && (
        <p className="text-sm">
          Controls are available in the tab that authorized this run.
        </p>
      )}
      {!terminal && submitAction && (nextAction || actionPending) && (
        <button
          type="button"
          className="min-h-11 rounded-md border px-3 text-sm"
          disabled={
            submitting ||
            (!actionPending && confirmedAction === nextAction?.kind)
          }
          onClick={() => void settle()}
        >
          {actionPending
            ? "Check submission"
            : nextAction?.kind === "abortUndelegatedReservation"
              ? "Refund expired reservation"
              : nextAction?.kind === "expireDelegatedActivation"
                ? "Recover expired run"
                : nextAction?.kind === "suspendOrResumeRun"
                  ? "Recover stalled run"
                  : nextAction?.kind === "settleReturnedRun"
                    ? "Finalize result"
                    : "Settle run"}
        </button>
      )}
      {!terminal && finalizing && (
        <p className="text-sm">Settling on Solana Devnet.</p>
      )}
      {actionNotice && !terminal && (
        <output className="text-sm">{actionNotice}</output>
      )}
    </section>
  );
}
