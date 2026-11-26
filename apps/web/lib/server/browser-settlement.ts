import "server-only";
import { BN, utils } from "@anchor-lang/core";
import { MAGIC_CONTEXT_ID } from "@magicblock-labs/ephemeral-rollups-sdk";
import {
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { browserGraceMs, finishBrowserReplay } from "../game/browser-replay";
import { runAddresses } from "../game/run-accounts";
import type { GameIntent } from "../game/run-transactions";
import { browserVerifierKey } from "./browser-config";
import { type BrowserSession, withBrowserSession } from "./browser-store";
import { account, pda } from "./chain";
import { programInstruction } from "./game-transactions";
import { readLiveRun } from "./live-run";
import { ApiError, sponsorshipConfig } from "./runtime";
import {
  admitSponsorCost,
  checkPlaySpend,
  dedicatedSponsor,
  sendReviewed,
} from "./sponsorship";
import { checkedConnection } from "./transaction-network";
import { prepare, validateTransaction } from "./transactions";

async function resultTransaction(session: BrowserSession) {
  const verifier = browserVerifierKey();
  const rpc = await checkedConnection("er", session.source.validator);
  const record = account<{ authority: PublicKey }>(
    "browserVerifier",
    await rpc.getAccountInfo(pda("browser-verifier"), "confirmed"),
  );
  if (!record?.authority.equals(verifier.publicKey))
    throw new ApiError("VERIFIER_MISMATCH", 503);
  const sponsor = await dedicatedSponsor(await checkedConnection("base"));
  if (verifier.publicKey.equals(sponsor.publicKey))
    throw new ApiError("VERIFIER_MISMATCH", 503);
  const run = runAddresses({
    owner: session.owner,
    nonce: BigInt(session.nonce),
  }).run[0];
  const { frame } = session.replay.world;
  const sequence = session.replay.prices.findLast(
    (event) => BigInt(event.tick) <= frame.activeTicks,
  )?.sequence;
  const final = session.witnesses.find(
    (event) => event.sequence === sequence?.toString(),
  );
  if (!final || !session.replay.stop || !frame.terminalReason)
    throw new ApiError("RUN_NOT_FINISHED", 409);
  const instruction = programInstruction(
    "recordBrowserResult",
    {
      run,
      browserVerifier: pda("browser-verifier"),
      authority: verifier.publicKey,
      magicContext: MAGIC_CONTEXT_ID,
    },
    {
      args: {
        snapshotHash: Array.from(Buffer.from(session.snapshotHash, "hex")),
        reason: { [frame.terminalReason]: {} },
        activeTicks: new BN(frame.activeTicks.toString()),
        score: new BN(frame.score.toString()),
        coins: new BN(frame.totalCoins.toString()),
        qualifiedCheckpoints: new BN(frame.qualifiedCheckpoints.toString()),
        finalObservation: {
          sequence: new BN(final.sequence),
          price: new BN(final.price),
          exponent: final.exponent,
          publishedAtSeconds: new BN(final.publishedAtSeconds),
          postedSlot: new BN(final.postedSlot),
          contentHash: Array.from(Buffer.from(final.contentHash, "hex")),
        },
      },
    },
  );
  const block = await rpc.getLatestBlockhash("confirmed");
  const tx = new VersionedTransaction(
    new TransactionMessage({
      payerKey: sponsor.publicKey,
      recentBlockhash: block.blockhash,
      instructions: [instruction],
    }).compileToV0Message(),
  );
  tx.sign([verifier, sponsor]);
  await checkPlaySpend(rpc, tx, sponsor.publicKey, "er", true);
  return {
    transaction: Buffer.from(tx.serialize()).toString("base64"),
    signature: utils.bytes.bs58.encode(tx.signatures[0] ?? new Uint8Array()),
    network: "er" as const,
    lastValidBlockHeight: block.lastValidBlockHeight,
    sentAt: Date.now(),
  };
}

async function actionTransaction(
  session: BrowserSession,
  action: GameIntent["action"],
) {
  const settings = sponsorshipConfig();
  const intent = {
    operation: "game",
    sponsored: false,
    playSponsor: {
      sponsor: settings.SPONSOR_PUBLIC_KEY,
      floor: settings.SPONSOR_MIN_BALANCE_LAMPORTS.toString(),
    },
    action,
  } satisfies GameIntent;
  const prepared = await prepare(session.owner, intent);
  const tx = validateTransaction(session.owner, intent, prepared.transaction);
  const sponsor = await dedicatedSponsor(await checkedConnection("base"));
  tx.sign([sponsor]);
  const rpc = await checkedConnection(
    prepared.network,
    prepared.network === "er" ? session.source.validator : undefined,
  );
  await checkPlaySpend(rpc, tx, sponsor.publicKey, prepared.network, true);
  return {
    transaction: Buffer.from(tx.serialize()).toString("base64"),
    signature: utils.bytes.bs58.encode(tx.signatures[0] ?? new Uint8Array()),
    network: prepared.network,
    lastValidBlockHeight: prepared.lastValidBlockHeight,
    sentAt: Date.now(),
  };
}

// This accepts a run identity only. Results come exclusively from the persisted
// server replay, never a request-supplied score, multiplier, payout or frame.
export async function deliverBrowserRun(owner: string, nonce: string) {
  const pending = await withBrowserSession(owner, nonce, async (session) => {
    if (!session) throw new ApiError("RUN_NOT_FOUND", 409);
    const now = Date.now();
    if (
      !session.replay.stop &&
      now - session.replay.lastSeenAt > browserGraceMs
    )
      session.replay = finishBrowserReplay(session.replay, "pageClosed");
    if (!session.replay.stop || session.settled)
      return { session, value: null };
    if (session.delivery) {
      const delivery = session.delivery;
      const rpc = await checkedConnection(delivery.network);
      let status = (
        await rpc.getSignatureStatuses([delivery.signature], {
          searchTransactionHistory: true,
        })
      ).value[0];
      if (
        !status &&
        (await rpc.getBlockHeight("finalized")) > delivery.lastValidBlockHeight
      ) {
        status = (
          await rpc.getSignatureStatuses([delivery.signature], {
            searchTransactionHistory: true,
          })
        ).value[0];
        if (!status) session.delivery = null;
      }
      if (status?.err) session.delivery = null;
      else if (
        status &&
        (status.confirmationStatus === "finalized" ||
          (delivery.network === "er" &&
            status.confirmationStatus === "confirmed"))
      )
        session.delivery = null;
      else if (session.delivery) return { session, value: session.delivery };
    }
    const live = await readLiveRun(owner, nonce);
    if (live.run.status === "settled" || live.run.status === "refunded") {
      session.settled = true;
      return { session, value: null };
    }
    if (live.er) {
      if (Buffer.from(live.er.data, "base64").length === 0)
        throw new ApiError("INVALID_CHAIN_ACCOUNT", 502);
      const info = account<
        import("@anchor-lang/core").IdlAccounts<
          import("../solana/dungeon-warriors").DungeonWarriors
        >["runGameState"]
      >("runGameState", {
        owner: new PublicKey(live.er.owner),
        data: Buffer.from(live.er.data, "base64"),
        executable: false,
        lamports: 0,
        rentEpoch: 0,
      });
      if (
        !info ||
        Buffer.from(info.snapshotHash).toString("hex") !== session.snapshotHash
      )
        throw new ApiError("RUN_SCOPE_MISMATCH", 409);
      if ("active" in info.phase)
        session.delivery = await resultTransaction(session);
      else if ("terminalRecorded" in info.phase)
        session.delivery = await actionTransaction(session, {
          kind: "requestCompletion",
          nonce,
          market: session.market,
          hasCrank: false,
          expectedAttempt: info.crank.completionAttempts,
        });
      else if (
        "completionRequested" in info.phase &&
        now - session.replay.lastSeenAt > 30_000 &&
        info.crank.completionAttempts < sponsorshipConfig().SPONSOR_MAX_ATTEMPTS
      )
        session.delivery = await actionTransaction(session, {
          kind: "requestCompletion",
          nonce,
          market: session.market,
          hasCrank: false,
          expectedAttempt: info.crank.completionAttempts,
        });
    } else if (live.run.status === "settlementReady")
      session.delivery = await actionTransaction(session, {
        kind: "settleReturnedRun",
        nonce,
        market: session.market,
      });
    return { session, value: session.delivery };
  });
  if (pending) {
    const rpc = await checkedConnection(pending.network);
    const tx = VersionedTransaction.deserialize(
      Buffer.from(pending.transaction, "base64"),
    );
    const sponsor = tx.message.staticAccountKeys[0];
    if (
      !sponsor ||
      sponsor.toBase58() !== sponsorshipConfig().SPONSOR_PUBLIC_KEY
    )
      throw new ApiError("INVALID_RUN_SPONSOR", 409);
    const cost = await checkPlaySpend(rpc, tx, sponsor, pending.network, true);
    if (cost > 0n)
      await admitSponsorCost(
        `browser:${owner}:${nonce}:${pending.network}`,
        cost,
        pending.signature,
      );
    await sendReviewed(rpc, tx, pending.network, pending.signature, true);
  }
}
