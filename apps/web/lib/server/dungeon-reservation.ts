import "server-only";
import { utils } from "@anchor-lang/core";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import {
  catSchema,
  type DungeonRequest,
  dungeonOfferSchema,
} from "../dungeon/protocol";
import type { DungeonPrepare } from "../dungeon/request";
import { DUNGEON_RULES_VERSION, payout } from "../dungeon/rules";
import {
  hasDungeonReservationFee,
  reservationMessage,
  validateDungeonReservation,
} from "../dungeon/transactions";
import { verifyWalletSignature } from "./auth";
import { dungeonSetup, quoteDepth, readExpedition } from "./dungeon-chain";
import { dungeonSecret, secretCommitment } from "./dungeon-randomness";
import {
  activeDungeon,
  type DungeonRecord,
  withDungeon,
} from "./dungeon-store";
import { dungeonView } from "./dungeon-view";
import { ApiError, digest, sponsorshipConfig } from "./runtime";
import {
  admitSponsorCost,
  checkPlaySpend,
  dedicatedSponsor,
  sendReviewed,
} from "./sponsorship";
import { checkedConnection } from "./transaction-network";

type QuoteRequest = Extract<DungeonRequest, { kind: "quote" }>;
export async function offerDungeon(
  owner: string,
  input: Extract<DungeonRequest, { kind: "offer" }>,
) {
  const setup = await dungeonSetup(owner),
    stake = BigInt(input.stake);
  if (stake > BigInt(setup.player.availableBaseUnits.toString()))
    throw new ApiError("INSUFFICIENT_CREDIT", 409);
  const index = catSchema.options.indexOf(input.cat);
  if (
    (setup.collection.ownedMask & (1 << index)) === 0 ||
    !setup.collection.cats[index]
  )
    throw new ApiError("CAT_NOT_OWNED", 409);
  const maxRooms = quoteDepth(stake, setup.free, setup.rules);
  return dungeonOfferSchema.parse({
    owner,
    cat: input.cat,
    rules: setup.rules,
    rulesHash: setup.ruleHash,
    stake: input.stake,
    maxRooms,
    maxGross: payout(stake, maxRooms, setup.rules).toString(),
    available: setup.player.availableBaseUnits.toString(),
  });
}

export async function quoteDungeon(
  owner: string,
  input: QuoteRequest | DungeonPrepare,
) {
  const active = await activeDungeon(owner);
  if (active !== null && input.kind !== "quote" && !input.device)
    throw new ApiError("DUNGEON_ACTIVE", 409);
  const setup = await dungeonSetup(owner),
    stake = BigInt(input.stake);
  if (BigInt(setup.player.lockedStakeBaseUnits.toString()) !== 0n)
    throw new ApiError("DUNGEON_ACTIVE", 409);
  if (stake > BigInt(setup.player.availableBaseUnits.toString()))
    throw new ApiError("INSUFFICIENT_CREDIT", 409);
  const ids = catSchema.options,
    index = ids.indexOf(input.cat);
  if (
    (setup.collection.ownedMask & (1 << index)) === 0 ||
    !setup.collection.cats[index]
  )
    throw new ApiError("CAT_NOT_OWNED", 409);
  const nonce = setup.player.nextRunNonce.toString();
  if (active !== null && active !== nonce)
    throw new ApiError("DUNGEON_ACTIVE", 409);
  return withDungeon(owner, nonce, async (existing) => {
    const device =
      input.kind === "prepare" ? input.device : existing?.reserve.device;
    if (
      device &&
      (setup.grant?.owner.toBase58() !== owner ||
        setup.grant.device.toBase58() !== device ||
        device === sponsorshipConfig().SPONSOR_PUBLIC_KEY)
    )
      throw new ApiError("INVALID_GAME_DEVICE", 409);
    const reviewed = input.kind === "quote" ? input : input.review;
    // A browser can replace only an unsigned preparation with the same wager.
    const sameUnsigned =
      existing?.phase === "preparing" &&
      !existing.settled &&
      existing.reserve.signature === null &&
      existing.stake === input.stake &&
      existing.cat === input.cat &&
      (reviewed
        ? existing.maxRooms === reviewed.maxRooms &&
          existing.maxGross === reviewed.maxGross &&
          existing.rulesHash === reviewed.rulesHash
        : !!device);
    if (
      sameUnsigned &&
      existing.reserve.device === device &&
      hasDungeonReservationFee(existing.reserve.transaction)
    )
      return { record: existing, value: dungeonView(existing) };
    if (
      existing &&
      !sameUnsigned &&
      (!existing.settled || existing.phase !== "cancelled")
    )
      throw new ApiError("DUNGEON_ACTIVE", 409);
    const maxRooms = quoteDepth(stake, setup.free, setup.rules);
    if (
      reviewed &&
      (reviewed.maxRooms !== maxRooms ||
        reviewed.maxGross !== payout(stake, maxRooms, setup.rules).toString() ||
        reviewed.rulesHash !== setup.ruleHash)
    )
      throw new ApiError("DUNGEON_QUOTE_CHANGED", 409);
    const sponsor = await dedicatedSponsor(setup.rpc),
      policy = sponsorshipConfig();
    const maxPayerDebit = policy.SPONSOR_OPERATION_LIMIT_LAMPORTS.toString();
    const block = await setup.rpc.getLatestBlockhash("confirmed"),
      now = Date.now();
    const record: DungeonRecord = {
      nonce,
      owner,
      cat: input.cat,
      rules: setup.rules,
      rulesHash: setup.ruleHash,
      commitment: secretCommitment(dungeonSecret(owner, nonce)),
      stake: stake.toString(),
      maxGross: payout(stake, maxRooms, setup.rules).toString(),
      maxRooms,
      cleared: 0,
      gates: [],
      phase: "preparing",
      settled: false,
      payout: "0",
      room: null,
      client: null,
      randomness: null,
      createdAt: now,
      dueAt: now + setup.rules.vrfTimeoutSeconds * 1000,
      reserve: {
        transaction: "",
        lastValidBlockHeight: block.lastValidBlockHeight,
        sponsor: sponsor.publicKey.toBase58(),
        maxPayerDebit,
        messageHash: "0".repeat(64),
        signature: null,
        cost: "0",
        ...(device ? { device } : {}),
      },
      delivery: null,
      outcome: null,
      reason: null,
    };
    const tx = new VersionedTransaction(
      reservationMessage(
        record,
        record.reserve.sponsor,
        maxPayerDebit,
        block.blockhash,
        true,
        device,
      ),
    );
    await checkPlaySpend(setup.rpc, tx, sponsor.publicKey, "base", false);
    record.reserve.transaction = Buffer.from(tx.serialize()).toString("base64");
    record.reserve.messageHash = digest(
      Buffer.from(tx.message.serialize()).toString("base64"),
    );
    return { record, value: dungeonView(record) };
  });
}
export async function submitDungeon(
  owner: string,
  nonce: string,
  bytes: string,
) {
  const pending = await withDungeon(owner, nonce, async (record) => {
    if (!record) throw new ApiError("DUNGEON_NOT_FOUND", 409);
    if (record.reserve.signature !== null) return { record, value: record };
    if (record.phase !== "preparing" || record.settled)
      throw new ApiError("DUNGEON_STATE_CHANGED", 409);
    if (record.rules.version !== DUNGEON_RULES_VERSION)
      throw new ApiError("DUNGEON_ENGINE_MISMATCH", 503);
    let tx: VersionedTransaction;
    try {
      tx = VersionedTransaction.deserialize(Buffer.from(bytes, "base64"));
    } catch {
      throw new ApiError("TRANSACTION_REJECTED", 400);
    }
    if (
      digest(Buffer.from(tx.message.serialize()).toString("base64")) !==
      record.reserve.messageHash
    )
      throw new ApiError("TRANSACTION_REJECTED", 400);
    try {
      validateDungeonReservation(
        tx,
        owner,
        dungeonView(record),
        record.reserve.device,
      );
    } catch {
      throw new ApiError("TRANSACTION_REJECTED", 400);
    }
    const authority = record.reserve.device ?? owner;
    const signer = tx.message.staticAccountKeys.findIndex(
      (key) => key.toBase58() === authority,
    );
    const signature = tx.signatures[signer];
    if (
      signer < 0 ||
      signer >= tx.message.header.numRequiredSignatures ||
      !signature ||
      !verifyWalletSignature(authority, tx.message.serialize(), signature)
    )
      throw new ApiError("INVALID_SIGNATURE", 400);
    const rpc = await checkedConnection("base");
    const sponsor = await dedicatedSponsor(rpc);
    if (sponsor.publicKey.toBase58() !== record.reserve.sponsor)
      throw new ApiError("INVALID_RUN_SPONSOR", 409);
    tx.sign([sponsor]);
    const cost = await checkPlaySpend(rpc, tx, sponsor.publicKey, "base", true);
    record.reserve.transaction = Buffer.from(tx.serialize()).toString("base64");
    record.reserve.signature = utils.bytes.bs58.encode(
      tx.signatures[0] ?? new Uint8Array(),
    );
    record.reserve.cost = cost.toString();
    return { record, value: record };
  });
  await broadcastReservation(pending);
  return dungeonView(pending);
}
export async function broadcastReservation(record: DungeonRecord) {
  const signature = record.reserve.signature;
  if (!signature) return;
  const rpc = await checkedConnection("base");
  const status = (
    await rpc.getSignatureStatuses([signature], {
      searchTransactionHistory: true,
    })
  ).value[0];
  if (
    status ||
    (await rpc.getBlockHeight("finalized")) >
      record.reserve.lastValidBlockHeight
  )
    return;
  if (await readExpedition(record.owner, record.nonce)) return;
  const cost = BigInt(record.reserve.cost);
  if (cost > 0n)
    await admitSponsorCost(
      `dungeon:${record.owner}:${record.nonce}:reserve`,
      cost,
      signature,
    );
  const tx = VersionedTransaction.deserialize(
    Buffer.from(record.reserve.transaction, "base64"),
  );
  if (
    !tx.message.staticAccountKeys[0]?.equals(
      new PublicKey(record.reserve.sponsor),
    )
  )
    throw new ApiError("INVALID_RUN_SPONSOR", 409);
  await sendReviewed(rpc, tx, "base", signature, true);
}
