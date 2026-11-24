import "server-only";
import type { IdlAccounts } from "@anchor-lang/core";
import { PublicKey } from "@solana/web3.js";
import { expeditionAddress } from "../dungeon/transactions";
import { pda } from "../solana/program";
import type { PurrpsGame } from "../solana/purrps-game";
import { account } from "./chain-account";
import { ApiError } from "./runtime";
import { checkedConnection } from "./transaction-network";

type Accounts = IdlAccounts<PurrpsGame>;
export async function dungeonHistory(owner: string, fromNonce?: string) {
  const rpc = await checkedConnection("base");
  const player = account<Accounts["playerAccount"]>(
    "playerAccount",
    await rpc.getAccountInfo(
      pda("player", new PublicKey(owner).toBytes()),
      "finalized",
    ),
  );
  if (!player) return { entries: [], next: null };
  if (player.owner.toBase58() !== owner)
    throw new ApiError("INVALID_DUNGEON_ACCOUNT", 409);
  const head = BigInt(player.nextRunNonce.toString());
  const end = fromNonce === undefined ? head : BigInt(fromNonce);
  if (end > head) throw new ApiError("INVALID_DUNGEON_PAGE", 400);
  const start = end > 8n ? end - 8n : 0n;
  const nonces = Array.from({ length: Number(end - start) }, (_, i) =>
    (end - 1n - BigInt(i)).toString(),
  );
  const infos = nonces.length
    ? await rpc.getMultipleAccountsInfo(
        nonces.map((n) => expeditionAddress(owner, n)),
        "finalized",
      )
    : [];
  if (infos.length !== nonces.length)
    throw new ApiError("INVALID_DUNGEON_ACCOUNT", 503);
  const entries = infos.flatMap((info, i) => {
    if (!info) return [];
    const e = account<Accounts["dungeonExpedition"]>("dungeonExpedition", info);
    if (!e || e.owner.toBase58() !== owner || e.nonce.toString() !== nonces[i])
      throw new ApiError("INVALID_DUNGEON_ACCOUNT", 503);
    return [
      {
        nonce: e.nonce.toString(),
        cat: Object.keys(e.cat)[0],
        state: Object.keys(e.status)[0],
        cleared: e.cleared,
        stake: e.stake.toString(),
        payout: e.payout.toString(),
      },
    ];
  });
  return { entries, next: start > 0n ? start.toString() : null };
}
export async function dungeonLeaderboard() {
  const rpc = await checkedConnection("base");
  const board = account<Accounts["leaderboard"]>(
    "leaderboard",
    await rpc.getAccountInfo(pda("dungeon-leaderboard"), "finalized"),
  );
  if (!board) return [];
  if (board.schemaVersion !== 1 || board.count > 20)
    throw new ApiError("INVALID_DUNGEON_ACCOUNT", 503);
  const seen = new Set<string>();
  return board.entries.slice(0, board.count).map((entry, i) => {
    if (
      !entry ||
      entry.score.gtn(5) ||
      !entry.run.equals(
        expeditionAddress(entry.owner.toBase58(), entry.nonce.toString()),
      ) ||
      seen.has(entry.owner.toBase58())
    )
      throw new ApiError("INVALID_DUNGEON_ACCOUNT", 503);
    seen.add(entry.owner.toBase58());
    return {
      rank: i + 1,
      wallet: entry.owner.toBase58(),
      score: entry.score.toString(),
    };
  });
}
