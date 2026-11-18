import {
  BN,
  BorshAccountsCoder,
  BorshCoder,
  convertIdlToCamelCase,
  type IdlAccounts,
} from "@anchor-lang/core";
import { type AccountInfo, PublicKey } from "@solana/web3.js";
import { PURRPS_GAME_IDL, type PurrpsGame } from "../generated/purrps_game";
import { DEVNET, publicKeySchema } from "../solana/addresses.mts";
import { type CatId, catStats } from "./catalog";
import { parsePredictionSnapshot } from "./predictor";
import { runAccountObservationSchema } from "./protocol";
import { RULES_V1, U64_MAX } from "./rules";
import { guardRunLayout, SNAPSHOT_END, SNAPSHOT_START } from "./run-layout";

const program = new PublicKey(DEVNET.program);
const idl = convertIdlToCamelCase(PURRPS_GAME_IDL);
const accounts = new BorshAccountsCoder(idl);
const types = new BorshCoder(idl).types;
type Accounts = IdlAccounts<PurrpsGame>;
export type RunIdentity = { owner: string; nonce: bigint };
export class RunAccountError extends Error {
  constructor(
    readonly code: "INVALID_ACCOUNT" | "UNSUPPORTED_RUN" | "SNAPSHOT_MISMATCH",
  ) {
    super(code);
  }
}
export function runAddresses(identity: RunIdentity) {
  const owner = new PublicKey(publicKeySchema.parse(identity.owner));
  if (identity.nonce < 0n || identity.nonce > U64_MAX)
    throw new RunAccountError("INVALID_ACCOUNT");
  const nonce = new Uint8Array(8);
  new DataView(nonce.buffer).setBigUint64(0, identity.nonce, true);
  const address = (seed: string) =>
    PublicKey.findProgramAddressSync(
      [new TextEncoder().encode(seed), owner.toBytes(), nonce],
      program,
    );
  return {
    run: address("run-game"),
    escrow: address("run-escrow"),
    receipt: address("result"),
  };
}
export function enumTag(value: object): string {
  const key = Object.keys(value);
  if (key.length !== 1 || key[0] === undefined)
    throw new RunAccountError("INVALID_ACCOUNT");
  return key[0];
}
function plain(value: unknown): unknown {
  if (BN.isBN(value)) return BigInt(String(value));
  if (value instanceof PublicKey) return value.toBase58();
  if (Array.isArray(value)) return value.map(plain);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, plain(v)]),
    );
  return value;
}
const fields = (value: object) => plain(value) as Record<string, unknown>;
const big = (value: BN) => BigInt(value.toString());
function checkAccount(
  info: AccountInfo<Buffer>,
  key: PublicKey,
  expected: PublicKey,
) {
  if (
    !key.equals(expected) ||
    !info.owner.equals(program) ||
    info.executable ||
    info.data.length > 10_240
  )
    throw new RunAccountError("INVALID_ACCOUNT");
}
const hex = (data: ArrayLike<number>) =>
  Array.from(data, (value) => value.toString(16).padStart(2, "0")).join("");
async function checkSnapshot(data: Buffer, hash: number[]) {
  const domain = new TextEncoder().encode("purrps:run:v1");
  const bytes = new Uint8Array(
    domain.length + 32 + SNAPSHOT_END - SNAPSHOT_START,
  );
  bytes.set(domain);
  bytes.set(program.toBytes(), domain.length);
  bytes.set(data.subarray(SNAPSHOT_START, SNAPSHOT_END), domain.length + 32);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  if (hex(digest) !== hex(hash)) throw new RunAccountError("SNAPSHOT_MISMATCH");
}
function checkVersion(s: Accounts["runGameState"]["snapshot"]) {
  if (
    s.protocolVersion !== 1 ||
    s.rulesBinding.version !== 1 ||
    s.cat.definingCatalog.version !== 1 ||
    s.assetManifest.version < 1 ||
    !types
      .encode("gameRules", s.rules)
      .equals(types.encode("gameRules", RULES_V1))
  )
    throw new RunAccountError("UNSUPPORTED_RUN");
  const stats = catStats(enumTag(s.cat.definition.id) as CatId, s.cat.level);
  const received: Record<string, unknown> = {
    ...fields(s.cat.stats),
    power: enumTag(s.cat.stats.power),
  };
  if (Object.entries(stats).some(([k, v]) => received[k] !== v))
    throw new RunAccountError("UNSUPPORTED_RUN");
  return stats;
}

export async function decodeRunAccount(
  identity: RunIdentity,
  key: PublicKey,
  info: AccountInfo<Buffer>,
) {
  const address = runAddresses(identity);
  checkAccount(info, key, address.run[0]);
  guardRunLayout(info.data);
  const r = accounts.decode<Accounts["runGameState"]>(
    "runGameState",
    info.data,
  );
  if (
    r.schemaVersion !== 1 ||
    r.bump !== address.run[1] ||
    !r.snapshot.run.equals(key) ||
    !r.snapshot.owner.equals(new PublicKey(identity.owner)) ||
    big(r.snapshot.nonce) !== identity.nonce ||
    !r.escrow.equals(address.escrow[0])
  )
    throw new RunAccountError("INVALID_ACCOUNT");
  await checkSnapshot(info.data, r.snapshotHash);
  const stats = checkVersion(r.snapshot);
  const observation = runAccountObservationSchema.parse({
    protocolVersion: r.snapshot.protocolVersion,
    schemaVersion: r.schemaVersion,
    rulesVersion: r.snapshot.rulesBinding.version,
    catalogVersion: r.snapshot.cat.definingCatalog.version,
    run: key.toBase58(),
    phase: enumTag(r.phase),
    activeTicks: big(r.activeTicks),
    acceptedSequence: big(r.lastAcceptedSequence),
    processedSequence: big(r.lastProcessedSequence),
    terminalReason: r.terminal === null ? null : enumTag(r.terminal.reason),
  });
  if (
    r.entityCount > 64 ||
    r.observationCount > 16 ||
    r.observationHead >= 16 ||
    r.intentCount > 32 ||
    r.intentHead >= 32 ||
    big(r.lastAcceptedSequence) - big(r.lastProcessedSequence) !==
      BigInt(r.intentCount)
  )
    throw new RunAccountError("INVALID_ACCOUNT");
  let prediction = null;
  let acceptedOrder = 0n;
  if (r.startObservation !== null && r.entityCount > 0) {
    if (r.observationCount === 0) throw new RunAccountError("INVALID_ACCOUNT");
    const latest =
      r.observations[(r.observationHead + r.observationCount - 1) % 16];
    const previous =
      r.observations[
        (r.observationHead + Math.max(0, r.observationCount - 2)) % 16
      ];
    if (latest === undefined || previous === undefined)
      throw new RunAccountError("INVALID_ACCOUNT");
    const projected = {
      frame: {
        phase: observation.phase,
        activeTicks: observation.activeTicks,
        runner: { ...fields(r.runner), axis: enumTag(r.runner.axis) },
        powers: Object.fromEntries(
          ["magnet", "doubleJump", "shield", "extraDash"].map((p, i) => [
            p,
            plain(r.powers[i]),
          ]),
        ),
        score: big(r.score),
        totalCoins: big(r.totalCoins),
        designatedCoinMask: r.designatedCoinMask,
        qualifiedCheckpoints: big(r.qualifiedCheckpoints),
        terminalReason: observation.terminalReason,
      },
      entities: r.entities.slice(0, r.entityCount).map((e) => ({
        ...fields(e),
        kind: enumTag(e.kind),
        ...("booster" in e.kind ? { power: enumTag(e.kind.booster[0]) } : {}),
        ...("ramp" in e.kind ? { riseSubpixels: e.kind.ramp[0] } : {}),
      })),
      generation: plain(r.worldGeneration),
      worldOriginPixels: big(r.worldOriginPixels),
      nextEntityId: big(r.nextEntityId),
      run: key.toBase58(),
      rulesVersion: 1,
      acceptedSequence: observation.acceptedSequence,
      processedSequence: observation.processedSequence,
      sample: {
        previousPrice: big(previous.price),
        previousExponent: previous.exponent,
        price: big(latest.price),
        exponent: latest.exponent,
      },
      queued: Array.from({ length: r.intentCount }, (_, i) => {
        const q = r.intents[(r.intentHead + i) % 32];
        if (
          q == null ||
          big(q.acceptedOrder) <= acceptedOrder ||
          big(q.acceptedOrder) > big(r.lastAcceptedOrder)
        )
          throw new RunAccountError("INVALID_ACCOUNT");
        acceptedOrder = big(q.acceptedOrder);
        const action = q.envelope.action;
        const kind = enumTag(action);
        return {
          envelope: {
            ...fields(q.envelope),
            action: {
              kind,
              ...("move" in action ? { axis: enumTag(action.move.axis) } : {}),
              ...("heartbeat" in action
                ? { active: action.heartbeat.active }
                : {}),
            },
          },
          assignedTick: big(q.assignedTick),
        };
      }),
    };
    prediction = parsePredictionSnapshot(projected);
  } else if (
    observation.phase === "active" ||
    observation.phase === "suspended"
  )
    throw new RunAccountError("INVALID_ACCOUNT");
  return {
    observation,
    prediction,
    stats,
    snapshotHash: hex(r.snapshotHash),
    terminal: r.terminal === null ? null : fields(r.terminal),
  };
}

export async function decodeEscrowAccount(
  identity: RunIdentity,
  key: PublicKey,
  info: AccountInfo<Buffer>,
) {
  const address = runAddresses(identity);
  checkAccount(info, key, address.escrow[0]);
  const e = accounts.decode<Accounts["runEscrow"]>("runEscrow", info.data);
  if (
    e.schemaVersion !== 1 ||
    e.bump !== address.escrow[1] ||
    !e.gameState.equals(address.run[0]) ||
    !e.snapshot.run.equals(address.run[0]) ||
    !e.snapshot.owner.equals(new PublicKey(identity.owner)) ||
    big(e.snapshot.nonce) !== identity.nonce
  )
    throw new RunAccountError("INVALID_ACCOUNT");
  await checkSnapshot(info.data, e.snapshotHash);
  checkVersion(e.snapshot);
  const status = enumTag(e.status);
  if ((status === "reserved") !== (e.receipt === null))
    throw new RunAccountError("INVALID_ACCOUNT");
  if (e.receipt !== null && !e.receipt.equals(address.receipt[0]))
    throw new RunAccountError("INVALID_ACCOUNT");
  return {
    status,
    receipt: e.receipt?.toBase58() ?? null,
    snapshotHash: hex(e.snapshotHash),
  };
}
