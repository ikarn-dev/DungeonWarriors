import "server-only";
import type { IdlAccounts } from "@anchor-lang/core";
import { PublicKey } from "@solana/web3.js";
import { z } from "zod";
import {
  beginBrowserReplay,
  browserGraceMs,
  browserInputsSchema,
  encodeBrowser,
  finishBrowserReplay,
  verifyBrowserStep,
} from "../game/browser-replay";
import { RULES_V4, rulesForVersion } from "../game/rules";
import { decodeRunAccount, runAddresses } from "../game/run-accounts";
import { initializeWorld } from "../game/world";
import type { DungeonWarriors } from "../solana/dungeon-warriors";
import { witnessBrowserPrice } from "./browser-prices";
import { type BrowserSession, withBrowserSession } from "./browser-store";
import { account } from "./chain";
import { readLiveRun } from "./live-run";
import { ApiError } from "./runtime";
import { checkedConnection } from "./transaction-network";

export const browserRequestSchema = z
  .object({
    kind: z.enum(["start", "step", "finish", "status"]),
    nonce: z.string().regex(/^[0-9]{1,20}$/),
    client: z.uuid(),
    through: z.number().int().nonnegative().safe().optional(),
    inputs: browserInputsSchema.default([]),
    exit: z.enum(["reload", "pageClosed", "hidden", "engineError"]).optional(),
  })
  .strict();
export type BrowserRequest = z.infer<typeof browserRequestSchema>;
export const BROWSER_RULES_VERSION = RULES_V4.rulesVersion;

export async function startSession(
  owner: string,
  nonce: string,
  client: string,
  now: number,
): Promise<BrowserSession> {
  const live = await readLiveRun(owner, nonce);
  if (!live.er) throw new ApiError("RUN_NOT_READY", 409);
  const address = runAddresses({ owner, nonce: BigInt(nonce) }).run[0];
  const info = {
    data: Buffer.from(live.er.data, "base64"),
    owner: new PublicKey(live.er.owner),
    executable: false,
    lamports: 0,
    rentEpoch: 0,
  };
  const run = await decodeRunAccount(
    { owner, nonce: BigInt(nonce) },
    address,
    info,
  );
  const raw = account<IdlAccounts<DungeonWarriors>["runGameState"]>(
    "runGameState",
    info,
  );
  const rules = rulesForVersion(run.observation.rulesVersion);
  if (
    !rules ||
    run.observation.rulesVersion !== BROWSER_RULES_VERSION ||
    run.crank.generation !== "0" ||
    !run.prediction ||
    !raw?.startObservation
  )
    throw new ApiError("BROWSER_RUN_UNAVAILABLE", 409);
  const binding = raw.snapshot.oracle;
  const origin = raw.startObservation;
  // The course is generated here from the run's first price, which anchors
  // every later price sample. The chain's own world is not used for v4.
  const anchor = BigInt(origin.price.toString());
  const sample = {
    previousPrice: anchor,
    previousExponent: origin.exponent,
    price: anchor,
    exponent: origin.exponent,
  };
  const world = initializeWorld(run.prediction.frame, run.stats, sample, rules);
  return {
    owner,
    nonce,
    client,
    snapshotHash: run.snapshotHash,
    market: z.enum(["BTC", "ETH", "SOL"]).parse(live.er.market),
    cat: run.cat,
    catLevel: run.catLevel,
    stake: run.stake.toString(),
    maxGross: run.maxGross.toString(),
    keyExpiresAt:
      Number(raw.snapshot.inputPermission.expiresAtSeconds.toString()) * 1000,
    source: {
      account: binding.account.toBase58(),
      validator: binding.validator.toBase58(),
      writeAuthority: binding.writeAuthority.toBase58(),
      maxAgeSeconds: binding.maxAgeSeconds,
      maxFutureSkewSeconds: binding.maxFutureSkewSeconds,
      minExponent: binding.minExponent,
      maxExponent: binding.maxExponent,
    },
    witnesses: [
      {
        sequence: origin.sequence.toString(),
        price: origin.price.toString(),
        exponent: origin.exponent,
        publishedAtSeconds: origin.publishedAtSeconds.toString(),
        postedSlot: origin.postedSlot.toString(),
        contentHash: Buffer.from(origin.contentHash).toString("hex"),
      },
    ],
    replay: beginBrowserReplay(
      world,
      run.stats,
      sample,
      rules,
      now,
      BigInt(origin.sequence.toString()),
    ),
    delivery: null,
    settled: false,
  };
}

export function browserView(session: BrowserSession) {
  return {
    replay: encodeBrowser(session.replay),
    client: session.client,
    cat: session.cat,
    catLevel: session.catLevel,
    market: session.market,
    stake: session.stake,
    maxGross: session.maxGross,
    settled: session.settled,
    finished: session.replay.stop !== null,
    serverNow: Date.now(),
  };
}
export type BrowserView = ReturnType<typeof browserView>;

export async function updateBrowserRun(owner: string, input: BrowserRequest) {
  return withBrowserSession(owner, input.nonce, async (stored) => {
    const now = Date.now();
    const session =
      stored ??
      (input.kind === "start"
        ? await startSession(owner, input.nonce, input.client, now)
        : null);
    if (!session) {
      const live = await readLiveRun(owner, input.nonce);
      if (live.run.status === "settled" || live.run.status === "refunded")
        throw new ApiError("RUN_ALREADY_SETTLED", 409);
      if (live.er) {
        const raw = account<IdlAccounts<DungeonWarriors>["runGameState"]>(
          "runGameState",
          {
            owner: new PublicKey(live.er.owner),
            data: Buffer.from(live.er.data, "base64"),
            executable: false,
            lamports: 0,
            rentEpoch: 0,
          },
        );
        if (raw?.snapshot.rulesBinding.version !== BROWSER_RULES_VERSION)
          throw new ApiError("BROWSER_RUN_UNAVAILABLE", 409);
      }
      throw new ApiError("RUN_NOT_FOUND", 409);
    }
    if (session.replay.stop === null) {
      if (now >= session.keyExpiresAt)
        session.replay = finishBrowserReplay(session.replay, "keyExpired");
      else if (now - session.replay.lastSeenAt > browserGraceMs)
        session.replay = finishBrowserReplay(session.replay, "pageClosed");
      else if (session.client !== input.client)
        session.replay = finishBrowserReplay(session.replay, "reload");
      else if (input.kind === "step" || input.kind === "finish") {
        try {
          session.replay = verifyBrowserStep(
            session.replay,
            input.through ?? Number(session.replay.world.frame.activeTicks),
            input.inputs,
            now,
          );
        } catch {
          throw new ApiError("INVALID_REPLAY", 409);
        }
      }
      if (input.kind === "finish" && session.replay.stop === null)
        session.replay = finishBrowserReplay(
          session.replay,
          input.exit ?? "pageClosed",
        );
      if (session.replay.stop === null && input.kind !== "status") {
        const rpc = await checkedConnection("er", session.source.validator);
        try {
          await witnessBrowserPrice(session, rpc, now);
        } catch {
          // A witnessed price outage ends at verified progress. Fresh prices
          // cannot restart a course whose earlier observations were missed.
          session.replay = finishBrowserReplay(
            session.replay,
            "priceUnavailable",
          );
        }
      }
    }
    return { session, value: browserView(session) };
  });
}
