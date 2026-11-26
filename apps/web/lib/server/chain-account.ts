import "server-only";
import type { IdlAccounts } from "@anchor-lang/core";
import {
  type AccountInfo,
  type Connection,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import type { DungeonWarriors } from "../solana/dungeon-warriors";
import { coder, pda, program } from "../solana/program";
import { ApiError } from "./runtime";

type Accounts = IdlAccounts<DungeonWarriors>;
export const invalidChainAccount = () =>
  new ApiError("INVALID_CHAIN_ACCOUNT", 502);
const invalidAccount = invalidChainAccount;
export function account<T>(
  name: string,
  value: AccountInfo<Buffer> | null,
): T | null {
  if (value === null) return null;
  if (
    !value.owner.equals(program) ||
    value.executable ||
    value.data.length > 10240
  )
    throw new ApiError("INVALID_CHAIN_ACCOUNT", 502);
  try {
    return coder.accounts.decode<T>(name, value.data);
  } catch {
    throw new ApiError("INVALID_CHAIN_ACCOUNT", 502);
  }
}
export function readPlayer(owner: PublicKey, info: AccountInfo<Buffer> | null) {
  const player = account<Accounts["playerAccount"]>("playerAccount", info);
  if (player === null) return null;
  const [, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from("player"), owner.toBytes()],
    program,
  );
  if (
    player.schemaVersion !== 1 ||
    !player.owner.equals(owner) ||
    player.bump !== bump ||
    !player.wins
      .add(player.losses)
      .add(player.technicalRefunds)
      .eq(player.settledRuns) ||
    player.settledRuns.gt(player.nextRunNonce)
  )
    throw invalidAccount();
  return player;
}

export function uninitialized(info: AccountInfo<Buffer> | null) {
  return (
    info === null ||
    (info.owner.equals(SystemProgram.programId) &&
      !info.executable &&
      info.data.length === 0)
  );
}

export function stateContext(slot: number) {
  return {
    network: "solana-devnet" as const,
    commitment: "finalized" as const,
    slot,
    fetchedAt: new Date().toISOString(),
  };
}

export async function readFinalizedPlayer(rpc: Connection, owner: PublicKey) {
  const { value, context } = await rpc.getAccountInfoAndContext(
    pda("player", owner.toBytes()),
    "finalized",
  );
  return {
    context,
    player: readPlayer(owner, uninitialized(value) ? null : value),
  };
}
