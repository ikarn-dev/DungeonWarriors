import "server-only";
import { utils } from "@anchor-lang/core";
import { TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { dungeonAccounts } from "../dungeon/transactions";
import { programInstruction } from "../solana/instruction";
import { pda } from "../solana/program";
import { browserVerifierKey } from "./browser-config";
import { matchExpedition, readExpedition } from "./dungeon-chain";
import { dungeonSecret } from "./dungeon-randomness";
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
    if (record.outcome !== null)
      record.phase =
        record.outcome === 0
          ? "won"
          : record.outcome === 1
            ? "lost"
            : "refunded";
    else if (record.phase === "preparing") {
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
export async function deliverDungeon(owner: string, nonce: string) {
  const pending = await withDungeon(owner, nonce, async (record) => {
    if (!record || record.settled || record.outcome === null)
      return { record, value: null };
    await refreshDungeon(record);
    if (record.settled) return { record, value: null };
    const rpc = await checkedConnection("base");
    if (record.delivery) {
      const delivery = record.delivery;
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
      if (status?.err && status.confirmationStatus === "finalized")
        record.delivery = null;
      else if (status?.confirmationStatus === "finalized") {
        await refreshDungeon(record);
        if (record.settled) return { record, value: null };
        record.delivery = null;
      } else if (record.delivery) return { record, value: record.delivery };
    }
    const verifier = browserVerifierKey(),
      sponsor = await dedicatedSponsor(rpc);
    const accounts = dungeonAccounts(owner, nonce);
    let ix: ReturnType<typeof programInstruction>;
    if (!record.randomness) {
      if (record.reason !== "vrfTimeout") return { record, value: null };
      ix = programInstruction("refundDungeonRandomness", accounts, {});
    } else {
      const gates = [...record.gates];
      while (gates.length < 5) gates.push(255);
      ix = programInstruction(
        "settleDungeon",
        {
          ...accounts,
          verifier: verifier.publicKey,
          payer: sponsor.publicKey,
          leaderboard: pda("dungeon-leaderboard"),
        },
        {
          args: {
            secret: Array.from(dungeonSecret(owner, nonce)),
            gates,
            gateCount: record.gates.length,
            outcome: record.outcome,
          },
        },
      );
    }
    const block = await rpc.getLatestBlockhash("confirmed");
    const tx = new VersionedTransaction(
      new TransactionMessage({
        payerKey: sponsor.publicKey,
        recentBlockhash: block.blockhash,
        instructions: [ix],
      }).compileToV0Message(),
    );
    tx.sign(record.randomness ? [sponsor, verifier] : [sponsor]);
    const cost = await checkPlaySpend(rpc, tx, sponsor.publicKey, "base", true);
    record.delivery = {
      transaction: Buffer.from(tx.serialize()).toString("base64"),
      signature: utils.bytes.bs58.encode(tx.signatures[0] ?? new Uint8Array()),
      lastValidBlockHeight: block.lastValidBlockHeight,
      cost: cost.toString(),
    };
    return { record, value: record.delivery };
  });
  if (pending) {
    const cost = BigInt(pending.cost);
    if (cost > 0n)
      await admitSponsorCost(
        `dungeon:${owner}:${nonce}:settle`,
        cost,
        pending.signature,
      );
    const rpc = await checkedConnection("base");
    await sendReviewed(
      rpc,
      VersionedTransaction.deserialize(
        Buffer.from(pending.transaction, "base64"),
      ),
      "base",
      pending.signature,
      true,
    );
  }
}
