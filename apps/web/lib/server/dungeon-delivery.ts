import "server-only";
import { utils } from "@anchor-lang/core";
import { DELEGATION_PROGRAM_ID } from "@magicblock-labs/ephemeral-rollups-sdk";
import { TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { pause } from "../game/web-api";
import { program } from "../solana/program";
import { browserVerifierKey } from "./browser-config";
import { matchExpedition, readExpedition } from "./dungeon-chain";
import {
  settlementAddress,
  settlementInstructions,
} from "./dungeon-settlement-instructions";
import { type DungeonRecord, withDungeon } from "./dungeon-store";
import { ApiError } from "./runtime";
import {
  admitSponsorCost,
  checkPlaySpend,
  dedicatedSponsor,
  sendReviewed,
} from "./sponsorship";
import { checkedConnection } from "./transaction-network";

export async function refreshDungeon(record: DungeonRecord) {
  const e = await readExpedition(record.owner, record.nonce);
  if (!e) {
    if (record.phase !== "preparing")
      throw new ApiError("DUNGEON_ACCOUNT_UNAVAILABLE", 503);
    const rpc = await checkedConnection("base"),
      signature = record.reserve.signature;
    const status = signature
      ? (
          await rpc.getSignatureStatuses([signature], {
            searchTransactionHistory: true,
          })
        ).value[0]
      : null;
    if (status?.err && status.confirmationStatus === "finalized") {
      record.phase = "cancelled";
      record.settled = true;
      record.reason = "cancelled";
      record.payout = "0";
      return;
    }
    if (
      !status &&
      (await rpc.getBlockHeight("finalized")) >
        record.reserve.lastValidBlockHeight
    ) {
      const again = signature
        ? (
            await rpc.getSignatureStatuses([signature], {
              searchTransactionHistory: true,
            })
          ).value[0]
        : null;
      if (!again && !(await readExpedition(record.owner, record.nonce))) {
        record.phase = "cancelled";
        record.settled = true;
        record.reason = "cancelled";
        record.payout = "0";
      }
    }
    return;
  }
  matchExpedition(record, e);
  const state = Object.keys(e.status)[0];
  if (state === "won" || state === "lost" || state === "refunded") {
    record.phase = state;
    record.settled = true;
    record.payout = e.payout.toString();
    record.cleared = e.cleared;
    record.gates = e.gates.slice(0, e.gateCount);
    record.randomness = e.randomness
      ? Buffer.from(e.randomness).toString("hex")
      : null;
    record.delivery = null;
    return;
  }
  if (e.randomness) {
    record.randomness = Buffer.from(e.randomness).toString("hex");
    if (record.outcome !== null) {
      record.dueAt = Date.now();
      record.phase =
        record.outcome === 0
          ? "won"
          : record.outcome === 1
            ? "lost"
            : "refunded";
    } else if (record.phase === "preparing") {
      record.phase = "ready";
      record.dueAt = Date.now() + 60000;
    }
  } else {
    record.dueAt = Number(e.randomnessDeadline.toString()) * 1000;
    if (Date.now() >= record.dueAt) {
      record.outcome = 2;
      record.phase = "refunded";
      record.reason = "vrfTimeout";
      record.payout = record.stake;
    }
  }
}
function prepareDelivery(owner: string, nonce: string) {
  return withDungeon(owner, nonce, async (record) => {
    if (!record || record.settled || record.outcome === null)
      return { record, value: null };
    await refreshDungeon(record);
    if (record.settled) return { record, value: null };
    const base = await checkedConnection("base");
    const receipt = record.randomness
      ? await base.getAccountInfo(settlementAddress(owner, nonce), "confirmed")
      : null;
    const returned = receipt?.owner.equals(program);
    if (
      record.delivery?.stage === "schedule" &&
      (returned || receipt?.owner.equals(DELEGATION_PROGRAM_ID))
    )
      record.delivery = null;
    if (record.delivery?.stage === "commit" && returned) {
      // Prefer the independent cranker. Recovery submits the same Hydra
      // trigger if the scheduler has not finished by the next wallet visit.
      if (Date.now() - (record.delivery.sentAt ?? 0) < 15_000)
        return { record, value: null };
      record.delivery = null;
    }
    if (record.delivery) {
      const delivery = record.delivery;
      const rpc =
        delivery.stage === "commit" ? await checkedConnection("er") : base;
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
        if (!status) record.delivery = null;
      }
      if (
        delivery.stage === "commit" &&
        !status?.err &&
        (status?.confirmationStatus === "confirmed" ||
          status?.confirmationStatus === "finalized")
      ) {
        if (!delivery.sentAt || Date.now() - delivery.sentAt < 30_000)
          return { record, value: null };
        record.delivery = null;
      }
      if (status?.err && status.confirmationStatus === "finalized")
        record.delivery = null;
      else if (
        status?.confirmationStatus === "finalized" ||
        (delivery.stage === "schedule" &&
          !status?.err &&
          status?.confirmationStatus === "confirmed")
      ) {
        await refreshDungeon(record);
        if (record.settled) return { record, value: null };
        record.delivery = null;
      } else if (record.delivery) return { record, value: record.delivery };
    }
    const verifier = browserVerifierKey();
    const sponsor = await dedicatedSponsor(base);
    const plan = await settlementInstructions(
      base,
      record,
      sponsor.publicKey,
      verifier.publicKey,
      receipt,
    );
    if (!plan) return { record, value: null };
    const network = plan.stage === "commit" ? "er" : "base";
    const rpc = network === "er" ? await checkedConnection("er") : base;
    const block = await rpc.getLatestBlockhash("confirmed");
    const tx = new VersionedTransaction(
      new TransactionMessage({
        payerKey: sponsor.publicKey,
        recentBlockhash: block.blockhash,
        instructions: plan.instructions,
      }).compileToV0Message(),
    );
    tx.sign(
      record.randomness && plan.stage !== "trigger"
        ? [sponsor, verifier]
        : [sponsor],
    );
    const cost = await checkPlaySpend(
      rpc,
      tx,
      sponsor.publicKey,
      network,
      true,
      plan.stage === "trigger",
    );
    record.delivery = {
      transaction: Buffer.from(tx.serialize()).toString("base64"),
      signature: utils.bytes.bs58.encode(tx.signatures[0] ?? new Uint8Array()),
      lastValidBlockHeight: block.lastValidBlockHeight,
      cost: cost.toString(),
      ...(plan.stage ? { stage: plan.stage, sentAt: Date.now() } : {}),
    };
    return { record, value: record.delivery };
  });
}

export async function deliverDungeon(owner: string, nonce: string) {
  // Send the rollup write in the same background invocation when the base
  // delegation confirms. Saved transactions let the next recovery resume it.
  for (let step = 0; step < 2; step++) {
    const pending = await prepareDelivery(owner, nonce);
    if (!pending) return;
    const cost = BigInt(pending.cost);
    if (cost > 0n)
      await admitSponsorCost(
        `dungeon:${owner}:${nonce}:${pending.stage ?? "settle"}`,
        cost,
        pending.signature,
      );
    const network = pending.stage === "commit" ? "er" : "base";
    const rpc = await checkedConnection(network);
    const tx = VersionedTransaction.deserialize(
      Buffer.from(pending.transaction, "base64"),
    );
    await sendReviewed(rpc, tx, network, pending.signature, true);
    if (pending.stage !== "schedule") return;
    const er = await checkedConnection("er");
    const receipt = settlementAddress(owner, nonce);
    const deadline = AbortSignal.timeout(6000);
    while (!deadline.aborted) {
      const visible = await er.getAccountInfo(receipt, "confirmed");
      if (visible?.owner.equals(program)) break;
      await pause(500, deadline);
    }
    if (deadline.aborted) return;
  }
}
