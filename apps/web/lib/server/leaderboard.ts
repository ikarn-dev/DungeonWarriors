import "server-only";
import type { IdlAccounts } from "@anchor-lang/core";
import { runAddresses } from "../game/run-accounts";
import type { PurrpsGame } from "../solana/purrps-game";
import { ApiError } from "./runtime";

export type Leaderboard = IdlAccounts<PurrpsGame>["leaderboard"];

export function leaderboardView(board: Leaderboard | null, bump: number) {
  if (board === null) return [];
  const invalid = () => new ApiError("INVALID_CHAIN_ACCOUNT", 502);
  if (
    board.schemaVersion !== 1 ||
    board.bump !== bump ||
    board.entries.length !== 20 ||
    board.count > board.entries.length
  )
    throw invalid();

  const wallets = new Set<string>();
  return board.entries.flatMap((entry, i) => {
    if (i >= board.count) {
      if (entry != null) throw invalid();
      return [];
    }
    if (entry == null) throw invalid();
    const wallet = entry.owner.toBase58();
    const nonce = BigInt(entry.nonce.toString());
    const previous = board.entries[i - 1];
    if (
      wallets.has(wallet) ||
      !entry.run.equals(runAddresses({ owner: wallet, nonce }).run[0]) ||
      (previous != null &&
        (entry.score.gt(previous.score) ||
          (entry.score.eq(previous.score) &&
            Buffer.compare(entry.run.toBuffer(), previous.run.toBuffer()) <=
              0)))
    )
      throw invalid();
    wallets.add(wallet);
    return { rank: i + 1, wallet, score: entry.score.toString() };
  });
}
