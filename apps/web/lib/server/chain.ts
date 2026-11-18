import "server-only";
import { BorshCoder, convertIdlToCamelCase } from "@anchor-lang/core";
import { type AccountInfo, Connection, PublicKey } from "@solana/web3.js";
import { z } from "zod";
import { DEVNET } from "../solana/addresses.ts";
import { PURRPS_GAME_IDL } from "../solana/purrps-game.ts";
import { ApiError, runtime } from "./runtime";

export const program = new PublicKey(DEVNET.program);
export const idl = convertIdlToCamelCase(PURRPS_GAME_IDL);
export const coder = new BorshCoder(idl);
export const u64Input = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,19})$/)
  .refine((n) => BigInt(n) <= 0xffffffffffffffffn);
export function nonceBytes(value: string | bigint) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(value));
  return b;
}
export function pda(seed: string, ...parts: Uint8Array[]) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(seed), ...parts],
    program,
  )[0];
}
export function connection() {
  return new Connection(runtime().config.HELIUS_DEVNET_RPC_URL, {
    commitment: "finalized",
    disableRetryOnRateLimit: true,
    fetch: (url, init) =>
      fetch(url, {
        ...init,
        signal: AbortSignal.timeout(8000),
        redirect: "error",
      }),
  });
}
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
export const stateInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("wallet") }).strict(),
  z.object({ kind: z.literal("draw"), nonce: u64Input }).strict(),
  z.object({ kind: z.literal("run"), nonce: u64Input }).strict(),
  z
    .object({
      kind: z.literal("history"),
      fromNonce: u64Input,
      limit: z.number().int().min(1).max(8),
    })
    .strict(),
]);
export async function readState(
  wallet: string,
  input: z.infer<typeof stateInput>,
) {
  const owner = new PublicKey(wallet);
  let addresses: PublicKey[];
  switch (input.kind) {
    case "wallet":
      addresses = [
        pda("game-config"),
        pda("player", owner.toBytes()),
        pda("collection", owner.toBytes()),
        pda("house"),
      ];
      break;
    case "draw":
      addresses = [pda("draw", owner.toBytes(), nonceBytes(input.nonce))];
      break;
    case "run":
      addresses = [
        pda("run-escrow", owner.toBytes(), nonceBytes(input.nonce)),
        pda("run-game", owner.toBytes(), nonceBytes(input.nonce)),
      ];
      break;
    case "history": {
      const start = BigInt(input.fromNonce);
      addresses = Array.from(
        { length: Math.min(input.limit, Number(start > 8n ? 8n : start)) },
        (_, i) =>
          pda("result", owner.toBytes(), nonceBytes(start - 1n - BigInt(i))),
      );
      break;
    }
  }
  const rpc = connection();
  if ((await rpc.getGenesisHash()) !== DEVNET.genesisHash)
    throw new ApiError("WRONG_NETWORK", 503);
  const values = await rpc.getMultipleAccountsInfoAndContext(addresses, {
    commitment: "finalized",
  });
  const accounts = values.value.map((value, i) => {
    if (
      value !== null &&
      (!value.owner.equals(program) ||
        value.data.length > 10240 ||
        value.executable)
    )
      throw new ApiError("INVALID_CHAIN_ACCOUNT", 502);
    return {
      address: addresses[i]?.toBase58(),
      account:
        value === null
          ? null
          : {
              owner: value.owner.toBase58(),
              data: value.data.toString("base64"),
              executable: false,
            },
    };
  });
  if (input.kind === "wallet") {
    const cfg = account<{
      schemaVersion: number;
      rules: { version: number } | null;
      catalog: { version: number } | null;
    }>("gameConfig", values.value[0] ?? null);
    if (cfg !== null) {
      if (cfg.schemaVersion !== 1)
        throw new ApiError("UNSUPPORTED_CONFIGURATION", 503);
      const bindings = [
        ...(cfg.rules === null
          ? []
          : [{ seed: "rules", version: cfg.rules.version }]),
        ...(cfg.catalog === null
          ? []
          : [{ seed: "catalog", version: cfg.catalog.version }]),
      ];
      if (bindings.length > 0) {
        const keys = bindings.map((binding) => {
          const b = Buffer.alloc(4);
          b.writeUInt32LE(binding.version);
          return pda(binding.seed, b);
        });
        const published = await rpc.getMultipleAccountsInfoAndContext(keys, {
          commitment: "finalized",
          minContextSlot: values.context.slot,
        });
        published.value.forEach((value, i) => {
          if (
            value === null ||
            !value.owner.equals(program) ||
            value.data.length > 10240
          )
            throw new ApiError("INVALID_CHAIN_ACCOUNT", 502);
          accounts.push({
            address: keys[i]?.toBase58(),
            account: {
              owner: value.owner.toBase58(),
              data: value.data.toString("base64"),
              executable: false,
            },
          });
        });
        values.context.slot = published.context.slot;
      }
    }
  }
  return {
    network: "solana-devnet",
    commitment: "finalized",
    slot: values.context.slot,
    fetchedAt: new Date().toISOString(),
    accounts,
  };
}
