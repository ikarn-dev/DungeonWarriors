import type { AccountInfo, Connection, PublicKey } from "@solana/web3.js";
import type { RunUiStatus } from "./protocol";
import {
  decodeEscrowAccount,
  decodeRunAccount,
  type RunIdentity,
  runAddresses,
} from "./run-accounts";

type Run = Awaited<ReturnType<typeof decodeRunAccount>>;
type Escrow = Awaited<ReturnType<typeof decodeEscrowAccount>>;
export type RunView = {
  status: RunUiStatus;
  run: Run | null;
  escrow: Escrow | null;
  error: string | null;
};

export class RunState {
  private erSlot = -1;
  private baseSlot = -1;
  private requestedSequence: bigint | null = null;
  private recovery = false;
  private current: RunView = {
    status: "activating",
    run: null,
    escrow: null,
    error: null,
  };
  view(): RunView {
    return structuredClone(this.current);
  }
  requested(sequence: bigint) {
    if (sequence < 1n) throw new Error("INVALID_SEQUENCE");
    this.requestedSequence = sequence;
    this.updateStatus();
  }
  recoveryPending() {
    this.recovery = true;
    this.updateStatus();
  }
  fail(code: string) {
    this.current.error = code;
    this.current.status = "error";
  }
  applyRun(slot: number, run: Run) {
    if (!Number.isSafeInteger(slot) || slot < 0)
      throw new Error("INVALID_SLOT");
    if (slot < this.erSlot) return;
    const old = this.current.run;
    if (
      old !== null &&
      (old.snapshotHash !== run.snapshotHash ||
        old.observation.run !== run.observation.run)
    )
      throw new Error("RUN_CHANGED");
    if (
      old !== null &&
      (run.observation.activeTicks < old.observation.activeTicks ||
        run.observation.acceptedSequence < old.observation.acceptedSequence ||
        run.observation.processedSequence < old.observation.processedSequence ||
        (old.observation.terminalReason !== null &&
          run.observation.terminalReason !== old.observation.terminalReason) ||
        (old.prediction !== null &&
          run.prediction !== null &&
          run.prediction.worldOriginPixels < old.prediction.worldOriginPixels))
    )
      throw new Error("RUN_REGRESSION");
    if (
      this.current.escrow !== null &&
      this.current.escrow.snapshotHash !== run.snapshotHash
    )
      throw new Error("SNAPSHOT_MISMATCH");
    this.erSlot = slot;
    this.current.run = structuredClone(run);
    this.current.error = null;
    this.updateStatus();
  }
  applyFinalizedEscrow(slot: number, escrow: Escrow) {
    if (!Number.isSafeInteger(slot) || slot < 0)
      throw new Error("INVALID_SLOT");
    if (slot < this.baseSlot) return;
    const old = this.current.escrow;
    if (
      (old !== null &&
        (old.snapshotHash !== escrow.snapshotHash ||
          (old.status !== "reserved" &&
            (old.status !== escrow.status ||
              old.receipt !== escrow.receipt)))) ||
      (this.current.run !== null &&
        this.current.run.snapshotHash !== escrow.snapshotHash)
    )
      throw new Error("ESCROW_CONFLICT");
    this.baseSlot = slot;
    this.current.escrow = { ...escrow };
    this.current.error = null;
    this.updateStatus();
  }
  private updateStatus() {
    if (this.current.error !== null) {
      this.current.status = "error";
      return;
    }
    const e = this.current.escrow;
    const r = this.current.run?.observation;
    if (e !== null && e.status !== "reserved") {
      this.current.status =
        e.status === "refundedTechnical" ? "refunded" : "settled";
      return;
    }
    if (this.recovery) {
      this.current.status = "recoveryPending";
      return;
    }
    if (r === undefined || r.phase === "ready") {
      this.current.status = "activating";
      return;
    }
    if (r.phase === "completionRequested") {
      this.current.status = "settling";
      return;
    }
    if (r.terminalReason !== null) {
      this.current.status =
        r.terminalReason === "crash" || r.terminalReason === "surrender"
          ? "lost"
          : "accepted";
      return;
    }
    if (r.phase === "suspended") {
      this.current.status = "suspended";
      return;
    }
    this.current.status =
      this.requestedSequence !== null &&
      r.acceptedSequence < this.requestedSequence
        ? "requested"
        : "active";
  }
}

// Connections are supplied by the restricted RPC boundary. A submitted signature
// never calls applyFinalizedEscrow; only this finalized base account read does.
export async function subscribeRun(
  identity: RunIdentity,
  er: Connection,
  base: Connection,
  onView: (view: RunView) => void,
) {
  const state = new RunState();
  const addresses = runAddresses(identity);
  let closed = false;
  const failures = new Set<"er" | "base">();
  const stops: Array<() => Promise<void>> = [];
  const emit = () => {
    if (!closed) onView(state.view());
  };
  function channel(
    connection: Connection,
    key: PublicKey,
    kind: "er" | "base",
  ) {
    let busy = false;
    let pending: { info: AccountInfo<Buffer> | null; slot: number } | null =
      null;
    let lastSlot = -1;
    const receive = async (info: AccountInfo<Buffer> | null, slot: number) => {
      if (
        closed ||
        slot < lastSlot ||
        (pending !== null && slot < pending.slot)
      )
        return;
      pending = { info, slot };
      if (busy) return;
      busy = true;
      try {
        while (pending !== null && !closed) {
          const next = pending;
          pending = null;
          if (next.slot < lastSlot) continue;
          try {
            if (next.info === null) {
              if (lastSlot >= 0) throw new Error("ACCOUNT_MISSING");
              continue;
            }
            if (kind === "er") {
              const run = await decodeRunAccount(identity, key, next.info);
              if (!closed) state.applyRun(next.slot, run);
            } else {
              const escrow = await decodeEscrowAccount(
                identity,
                key,
                next.info,
              );
              if (!closed) state.applyFinalizedEscrow(next.slot, escrow);
            }
            lastSlot = next.slot;
            failures.delete(kind);
            if (failures.size > 0) state.fail("ACCOUNT_UPDATE_FAILED");
            emit();
          } catch {
            if (!closed) {
              failures.add(kind);
              state.fail("ACCOUNT_UPDATE_FAILED");
              emit();
            }
          }
        }
      } finally {
        busy = false;
      }
    };
    const commitment = kind === "base" ? "finalized" : "confirmed";
    const id = connection.onAccountChange(
      key,
      (info, context) => {
        void receive(info, context.slot);
      },
      commitment,
    );
    stops.push(() => connection.removeAccountChangeListener(id));
    let timer: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([
      connection.getAccountInfoAndContext(key, commitment),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("INITIAL_READ_TIMEOUT")),
          5000,
        );
      }),
    ])
      .then((value) => receive(value.value, value.context.slot))
      .finally(() => clearTimeout(timer));
  }
  try {
    await Promise.all([
      channel(er, addresses.run[0], "er"),
      channel(base, addresses.escrow[0], "base"),
    ]);
    emit();
  } catch {
    state.fail("SUBSCRIPTION_FAILED");
    emit();
    closed = true;
    await Promise.allSettled(stops.map((stop) => stop()));
    throw new Error("SUBSCRIPTION_FAILED");
  }
  return {
    state,
    close: async () => {
      closed = true;
      await Promise.allSettled(stops.map((stop) => stop()));
    },
  };
}
