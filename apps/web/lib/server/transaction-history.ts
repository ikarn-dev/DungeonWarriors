import "server-only";
import {
  type ConfirmedSignatureInfo,
  type ParsedTransactionWithMeta,
  PublicKey,
} from "@solana/web3.js";
import { z } from "zod";
import {
  type TransactionActivity,
  type TransactionCursor,
  type TransactionHistoryPage,
  transactionHistoryPage,
  transactionPageSize,
} from "../game/transaction-history";
import { coder, idl, pda, program } from "../solana/program";
import { ApiError } from "./runtime";
import { checkedConnection } from "./transaction-network";

type Accounts = (typeof idl.instructions)[number]["accounts"];
function accountNames(accounts: Accounts): string[] {
  return accounts.flatMap((account) =>
    "accounts" in account ? accountNames(account.accounts) : account.name,
  );
}
const namesByInstruction = new Map(
  idl.instructions.map(({ name, accounts }) => [name, accountNames(accounts)]),
);
const labels: Readonly<Record<string, TransactionActivity>> = {
  reserveDungeon: "Wager placed",
  reserveRun: "Wager placed",
  reserveQuotedRun: "Wager placed",
  refundDungeonRandomness: "Wager refund",
  abortUndelegatedReservation: "Wager refund",
  settleReturnedRun: "Runner settled",
  settleRunAction: "Runner settled",
  claimStarter: "Starter requested",
  fulfillStarter: "Starter cat granted",
  purchaseCapsule: "Capsule purchased",
  fulfillCapsule: "Capsule opened",
  refundCapsule: "Capsule refund",
  deposit: "Deposit",
  withdraw: "Withdrawal",
  createPlayer: "Player created",
  applyUpgrade: "Cat upgraded",
};
const outcomes = ["Payout", "Quest settled", "Wager refund"] as const;
const settlement = z.object({
  args: z.object({
    outcome: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  }),
});

function activities(
  tx: ParsedTransactionWithMeta,
  accounts: { player: PublicKey; collection: PublicKey },
): TransactionActivity[] {
  const instructions = [
    ...tx.transaction.message.instructions,
    ...(tx.meta?.innerInstructions ?? []).flatMap(
      (group) => group.instructions,
    ),
  ];
  const result = new Set<TransactionActivity>();
  for (const instruction of instructions) {
    if (!("data" in instruction) || !instruction.programId.equals(program))
      continue;
    const decoded = coder.instruction.decode(instruction.data, "base58");
    if (!decoded) continue;
    // Compare declared account positions. Extra accounts on an otherwise
    // unrelated instruction must not put it into this player's history.
    const scoped = namesByInstruction
      .get(decoded.name)
      ?.some(
        (name, i) =>
          (name === "player" || name === "collection") &&
          instruction.accounts[i]?.equals(accounts[name]),
      );
    if (!scoped) continue;
    if (
      decoded.name === "settleDungeon" ||
      decoded.name === "finalizeDungeonSettlement"
    ) {
      const value =
        decoded.name === "settleDungeon"
          ? decoded.data
          : { args: decoded.data };
      const { args } = settlement.parse(value);
      result.add(outcomes[args.outcome]);
    } else {
      const label = Object.hasOwn(labels, decoded.name)
        ? labels[decoded.name]
        : undefined;
      if (label) result.add(label);
    }
  }
  return [...result];
}

type SignatureStream = {
  batch: ConfirmedSignatureInfo[];
  before: TransactionCursor["player"];
  consumed: number;
};
function nextPosition(stream: SignatureStream): TransactionCursor["player"] {
  if (
    stream.consumed === stream.batch.length &&
    stream.batch.length < transactionPageSize
  )
    return null;
  return stream.batch[stream.consumed - 1]?.signature ?? stream.before;
}

export async function readTransactionHistory(
  owner: string,
  cursor: TransactionCursor = { player: "latest", collection: "latest" },
): Promise<TransactionHistoryPage> {
  const rpc = await checkedConnection("base");
  const wallet = new PublicKey(owner).toBytes();
  const accounts = {
    player: pda("player", wallet),
    collection: pda("collection", wallet),
  };
  async function stream(
    source: keyof TransactionCursor,
  ): Promise<SignatureStream> {
    const before = cursor[source];
    const batch =
      before === null
        ? []
        : await rpc.getSignaturesForAddress(
            accounts[source],
            {
              limit: transactionPageSize,
              ...(before === "latest" ? {} : { before }),
            },
            "finalized",
          );
    return { batch, before, consumed: 0 };
  }
  const [player, collection] = await Promise.all([
    stream("player"),
    stream("collection"),
  ]);

  // Merge only the consumed prefixes. A quieter account can return much older
  // entries than the other one, and its unconsumed signatures belong later.
  const selected = new Map<string, ConfirmedSignatureInfo>();
  while (selected.size < transactionPageSize) {
    const p = player.batch[player.consumed];
    const c = collection.batch[collection.consumed];
    const newest = !c || (p && p.slot >= c.slot) ? p : c;
    if (!newest) break;
    selected.set(newest.signature, newest);
    if (p?.signature === newest.signature) player.consumed++;
    if (c?.signature === newest.signature) collection.consumed++;
  }
  const successful = [...selected.values()].filter((info) => info.err === null);
  const transactions = successful.length
    ? await rpc.getParsedTransactions(
        successful.map((info) => info.signature),
        {
          commitment: "finalized",
          maxSupportedTransactionVersion: 0,
        },
      )
    : [];
  if (transactions.length !== successful.length)
    throw new ApiError("TRANSACTION_HISTORY_UNAVAILABLE", 503);

  // Batch responses can arrive in a different order than their requests.
  const details = new Map<string, ParsedTransactionWithMeta>();
  for (const tx of transactions) {
    if (!tx) continue;
    const signature = tx.transaction.signatures[0];
    const info = signature ? selected.get(signature) : undefined;
    if (
      !signature ||
      !info ||
      info.err !== null ||
      info.slot !== tx.slot ||
      details.has(signature)
    )
      throw new ApiError("TRANSACTION_HISTORY_UNAVAILABLE", 503);
    details.set(signature, tx);
  }

  const entries = successful.flatMap((info) => {
    const tx = details.get(info.signature);
    if (tx?.meta?.err) return [];
    const kinds: TransactionActivity[] = tx?.meta
      ? activities(tx, accounts)
      : ["Details unavailable"];
    return kinds.length
      ? [
          {
            signature: info.signature,
            slot: info.slot,
            blockTime: tx?.blockTime ?? info.blockTime ?? null,
            activities: kinds,
          },
        ]
      : [];
  });
  const next = {
    player: nextPosition(player),
    collection: nextPosition(collection),
  };
  return transactionHistoryPage.parse({
    entries,
    next: next.player === null && next.collection === null ? null : next,
  });
}
