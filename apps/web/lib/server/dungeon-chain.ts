import "server-only";
import { createHash } from "node:crypto";
import type { IdlAccounts } from "@anchor-lang/core";
import { PublicKey } from "@solana/web3.js";
import { affordableDepth, dungeonRulesSchema, payout } from "../dungeon/rules";
import { dungeonAccounts, expeditionAddress } from "../dungeon/transactions";
import { requiredVaultBalance } from "../game/economy";
import { DEVNET } from "../solana/addresses";
import { coder, pda } from "../solana/program";
import type { PurrpsGame } from "../solana/purrps-game";
import { browserVerifierKey } from "./browser-config";
import { account } from "./chain-account";
import type { DungeonRecord } from "./dungeon-store";
import { ApiError } from "./runtime";
import { checkedConnection } from "./transaction-network";

type Accounts = IdlAccounts<PurrpsGame>;
export async function dungeonSetup(owner: string) {
  const rpc = await checkedConnection("base"),
    keys = dungeonAccounts(owner, "0");
  const infos = await rpc.getMultipleAccountsInfo(
    [
      keys.config,
      pda("dungeon-config"),
      keys.player,
      keys.collection,
      keys.house,
    ],
    "finalized",
  );
  const config = account<Accounts["gameConfig"]>(
    "gameConfig",
    infos[0] ?? null,
  );
  const dungeon = account<Accounts["dungeonConfig"]>(
    "dungeonConfig",
    infos[1] ?? null,
  );
  const player = account<Accounts["playerAccount"]>(
    "playerAccount",
    infos[2] ?? null,
  );
  const collection = account<Accounts["collection"]>(
    "collection",
    infos[3] ?? null,
  );
  const house = account<Accounts["houseState"]>("houseState", infos[4] ?? null);
  if (!dungeon) throw new ApiError("DUNGEON_NOT_PUBLISHED", 503);
  if (
    !config ||
    !player ||
    !collection ||
    !house ||
    config.schemaVersion !== 1 ||
    player.schemaVersion !== 1 ||
    collection.schemaVersion !== 1 ||
    house.schemaVersion !== 1 ||
    !house.config.equals(keys.config) ||
    !house.vault.equals(keys.vault) ||
    !player.owner.equals(new PublicKey(owner)) ||
    !collection.owner.equals(new PublicKey(owner))
  )
    throw new ApiError("INVALID_DUNGEON_ACCOUNT", 409);
  if (!dungeon.enabled || !config.allowReservations)
    throw new ApiError("ADMISSION_CLOSED", 409);
  if (!dungeon.verifier.equals(browserVerifierKey().publicKey))
    throw new ApiError("VERIFIER_MISMATCH", 503);
  if (
    config.vrfProgram.toBase58() !== DEVNET.vrfProgram ||
    config.vrfQueue.toBase58() !== DEVNET.vrfQueue
  )
    throw new ApiError("VRF_SCOPE_MISMATCH", 503);
  const rules = dungeonRulesSchema.parse(dungeon.rules);
  const ruleHash = createHash("sha256")
    .update("purrps:dungeon-rules:v1")
    .update(coder.types.encode("dungeonRules", dungeon.rules))
    .digest("hex");
  if (ruleHash !== Buffer.from(dungeon.rulesHash).toString("hex"))
    throw new ApiError("DUNGEON_RULES_MISMATCH", 503);
  const vault = await rpc.getTokenAccountBalance(house.vault, "finalized");
  const required = requiredVaultBalance(
    BigInt(house.totalAvailableBaseUnits.toString()),
    BigInt(house.totalPurchaseEscrowBaseUnits.toString()),
    BigInt(house.totalMaxGrossBaseUnits.toString()),
    BigInt(house.bufferBaseUnits.toString()),
  );
  const free = BigInt(vault.value.amount) - required;
  return { rpc, config, dungeon, player, collection, rules, ruleHash, free };
}
export function quoteDepth(
  stake: bigint,
  free: bigint,
  rules: ReturnType<typeof dungeonRulesSchema.parse>,
) {
  const depth = affordableDepth(stake, stake + free, rules);
  if (depth === 0 || payout(stake, depth, rules) <= stake)
    throw new ApiError("DUNGEON_COLLATERAL_UNAVAILABLE", 409);
  return depth;
}
export async function readExpedition(owner: string, nonce: string) {
  const rpc = await checkedConnection("base");
  const info = await rpc.getAccountInfo(
    expeditionAddress(owner, nonce),
    "finalized",
  );
  const e = account<Accounts["dungeonExpedition"]>("dungeonExpedition", info);
  if (
    e &&
    (e.schemaVersion !== 1 ||
      e.owner.toBase58() !== owner ||
      e.nonce.toString() !== nonce)
  )
    throw new ApiError("DUNGEON_SCOPE_MISMATCH", 409);
  return e;
}
export function matchExpedition(
  record: DungeonRecord,
  e: Accounts["dungeonExpedition"],
) {
  if (
    e.owner.toBase58() !== record.owner ||
    e.nonce.toString() !== record.nonce ||
    Object.keys(e.cat)[0] !== record.cat ||
    e.stake.toString() !== record.stake ||
    e.maxGross.toString() !== record.maxGross ||
    e.maxRooms !== record.maxRooms ||
    Buffer.from(e.commitment).toString("hex") !== record.commitment ||
    Buffer.from(e.rulesHash).toString("hex") !== record.rulesHash ||
    !e.verifier.equals(browserVerifierKey().publicKey)
  )
    throw new ApiError("DUNGEON_SCOPE_MISMATCH", 409);
}
