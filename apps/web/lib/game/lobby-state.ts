import {
  BorshAccountsCoder,
  convertIdlToCamelCase,
  type IdlAccounts,
  utils,
} from "@anchor-lang/core";
import { PublicKey } from "@solana/web3.js";
import { z } from "zod";
import { DEVNET, publicKeySchema } from "../solana/addresses";
import { PURRPS_GAME_IDL, type PurrpsGame } from "../solana/purrps-game";
import type { CatId } from "./catalog";

const coder = new BorshAccountsCoder(convertIdlToCamelCase(PURRPS_GAME_IDL));
type Accounts = IdlAccounts<PurrpsGame>;
const rawSchema = z
  .object({
    network: z.literal("solana-devnet"),
    commitment: z.literal("finalized"),
    slot: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    fetchedAt: z.iso.datetime(),
    accounts: z
      .array(
        z
          .object({
            address: publicKeySchema,
            account: z
              .object({
                owner: z.literal(DEVNET.program),
                data: z.string().max(14000),
                executable: z.literal(false),
              })
              .strict()
              .nullable(),
          })
          .strict(),
      )
      .max(6),
  })
  .strict();
export const CAT_NAMES: Record<CatId, string> = {
  collector: "Collector",
  acrobat: "Acrobat",
  guardian: "Guardian",
  sprinter: "Sprinter",
};
const ids = ["collector", "acrobat", "guardian", "sprinter"] as const;
const grades = ["common", "rare", "epic"] as const;
const tag = (value: object) => Object.keys(value)[0];
function drawAddress(owner: PublicKey, nonce: bigint) {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, nonce, true);
  return PublicKey.findProgramAddressSync(
    [new TextEncoder().encode("draw"), owner.toBytes(), bytes],
    new PublicKey(DEVNET.program),
  );
}
export function decodeLobbyState(input: unknown, wallet: string) {
  const parsed = rawSchema.parse(input);
  const owner = new PublicKey(publicKeySchema.parse(wallet));
  const program = new PublicKey(DEVNET.program);
  if (
    new Set(parsed.accounts.map((value) => value.address)).size !==
    parsed.accounts.length
  )
    throw new Error("INVALID_ACCOUNT_RESPONSE");
  const address = (seed: string, ...parts: Uint8Array[]) =>
    PublicKey.findProgramAddressSync(
      [new TextEncoder().encode(seed), ...parts],
      program,
    )[0];
  const decode = <K extends keyof Accounts>(
    name: K,
    key: PublicKey,
  ): Accounts[K] | null => {
    const row = parsed.accounts.find(
      (value) => value.address === key.toBase58(),
    );
    if (row === undefined) throw new Error("INCOMPLETE_ACCOUNT_RESPONSE");
    if (row.account === null) return null;
    const bytes = utils.bytes.base64.decode(row.account.data);
    if (
      bytes.length > 10240 ||
      utils.bytes.base64.encode(bytes) !== row.account.data
    )
      throw new Error("INVALID_ACCOUNT_RESPONSE");
    return coder.decode<Accounts[K]>(name, bytes);
  };
  const cfg = decode("gameConfig", address("game-config"));
  const player = decode("playerAccount", address("player", owner.toBytes()));
  const collection = decode(
    "collection",
    address("collection", owner.toBytes()),
  );
  if (
    (player === null) !== (collection === null) ||
    (cfg !== null && cfg.schemaVersion !== 1)
  )
    throw new Error("INVALID_ACCOUNT_RESPONSE");
  if (
    player !== null &&
    collection !== null &&
    (player.schemaVersion !== 1 ||
      collection.schemaVersion !== 1 ||
      !player.owner.equals(owner) ||
      player.settledRuns.gt(player.nextRunNonce) ||
      !collection.owner.equals(owner) ||
      collection.ownedMask > 15)
  )
    throw new Error("INVALID_ACCOUNT_RESPONSE");
  const cats = ids.flatMap((id, index) => {
    const owned = collection?.cats[index] ?? null;
    if (
      collection !== null &&
      ((collection.ownedMask & (1 << index)) !== 0) !== (owned !== null)
    )
      throw new Error("INVALID_ACCOUNT_RESPONSE");
    if (owned === null) return [];
    if (
      tag(owned.cat) !== id ||
      owned.level < 1 ||
      owned.level > 5 ||
      owned.definingCatalog.version < 1
    )
      throw new Error("INVALID_ACCOUNT_RESPONSE");
    return [{ id, level: owned.level, rarity: tag(owned.rarity) ?? "" }];
  });
  const selected =
    collection?.selectedCat === null || collection === null
      ? null
      : tag(collection.selectedCat);
  if (selected !== null && !cats.some((cat) => cat.id === selected))
    throw new Error("INVALID_ACCOUNT_RESPONSE");
  const starter = collection === null ? null : tag(collection.starter);
  const nonce =
    player === null ? null : BigInt(player.nextDrawNonce.toString());
  if (starter === "pending" || collection?.pendingDraw != null) {
    if (nonce === null || nonce === 0n || collection?.pendingDraw == null)
      throw new Error("INVALID_ACCOUNT_RESPONSE");
    const [draw] = drawAddress(owner, nonce - 1n);
    if (!collection.pendingDraw.equals(draw))
      throw new Error("INVALID_ACCOUNT_RESPONSE");
  }
  let assetBinding: null | { version: number; contentHash: string } = null;
  let catalogVersion: number | null = null;
  if (cfg?.catalog != null) {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, cfg.catalog.version, true);
    const key = PublicKey.findProgramAddressSync(
      [new TextEncoder().encode("catalog"), bytes],
      program,
    )[0];
    const catalog = decode("catalogVersion", key);
    if (
      catalog === null ||
      catalog.schemaVersion !== 1 ||
      catalog.binding.version !== cfg.catalog.version ||
      catalog.binding.contentHash.some(
        (value: number, index: number) =>
          value !== cfg.catalog?.contentHash[index],
      )
    )
      throw new Error("INVALID_ACCOUNT_RESPONSE");
    catalogVersion = catalog.binding.version;
    assetBinding = {
      version: catalog.assetManifest.version,
      contentHash: catalog.assetManifest.contentHash
        .map((v: number) => v.toString(16).padStart(2, "0"))
        .join(""),
    };
  }
  return {
    slot: parsed.slot,
    configured: cfg !== null,
    hasPlayer: player !== null,
    allowStarter: cfg?.allowStarter ?? false,
    allowPurchases: cfg?.allowPurchases ?? false,
    allowReservations: cfg?.allowReservations ?? false,
    nextRunNonce: player?.nextRunNonce.toString() ?? "0",
    settledRuns: player?.settledRuns.toString() ?? "0",
    rulesVersion: cfg?.rules?.version ?? null,
    available: player?.availableBaseUnits.toString() ?? "0",
    upgrades: Object.fromEntries(
      grades.map((grade, index) => [
        grade,
        collection?.upgradeQuantities[index]?.toString() ?? "0",
      ]),
    ),
    definingCatalogs: Object.fromEntries(
      ids.map((id, index) => [
        id,
        collection?.cats[index]?.definingCatalog.version,
      ]),
    ),
    catalogVersion,
    assetBinding,
    cats,
    selected: selected as CatId | null,
    starter,
    nonce,
    inventoryVersion:
      collection === null
        ? null
        : BigInt(collection.inventoryVersion.toString()),
    pendingDraw: collection?.pendingDraw?.toBase58() ?? null,
  };
}
export type LobbyState = ReturnType<typeof decodeLobbyState>;

export function decodePaidDraw(input: unknown, wallet: string, nonce: bigint) {
  const [address, bump] = drawAddress(new PublicKey(wallet), nonce);
  const { accounts } = rawSchema.parse(input);
  const row = accounts[0];
  if (
    accounts.length !== 1 ||
    !row ||
    row.address !== address.toBase58() ||
    row.account === null
  )
    throw new Error("INVALID_DRAW_ACCOUNT");
  const draw = coder.decode<Accounts["capsuleDraw"]>(
    "capsuleDraw",
    utils.bytes.base64.decode(row.account.data),
  );
  const kind = tag(draw.kind);
  const status = tag(draw.status);
  if (
    draw.schemaVersion !== 1 ||
    draw.bump !== bump ||
    draw.owner.toBase58() !== wallet ||
    draw.nonce.toString() !== nonce.toString() ||
    (kind !== "paidCat" && kind !== "upgrade") ||
    draw.paidDeadlineSeconds === null ||
    (status !== "pending" && status !== "fulfilled" && status !== "refunded")
  )
    throw new Error("INVALID_DRAW_ACCOUNT");
  let reward: string | null = null;
  if (status === "fulfilled") {
    if (draw.result && "cat" in draw.result && kind === "paidCat") {
      const cat = tag(draw.result.cat[0]);
      if (ids.some((id) => id === cat)) reward = CAT_NAMES[cat as CatId];
    } else if (draw.result && "upgrade" in draw.result && kind === "upgrade") {
      const grade = tag(draw.result.upgrade[0]);
      if (grades.some((item) => item === grade)) reward = `${grade} upgrade`;
    }
    if (reward === null) throw new Error("INVALID_DRAW_ACCOUNT");
  }
  return {
    status,
    kind,
    reward,
    deadline: draw.paidDeadlineSeconds.toString(),
    cost: draw.priceBaseUnits.toString(),
  };
}
