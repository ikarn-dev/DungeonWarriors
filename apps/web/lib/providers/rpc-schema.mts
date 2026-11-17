import { Buffer } from "node:buffer";
import { TOKEN_PROGRAM_ID, unpackMint } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { z } from "zod";
import { DEVNET, publicKeySchema } from "../solana/addresses.mts";

const safeUnsigned = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
export const identitySchema = z.object({ identity: publicKeySchema });
export const genesisSchema = z.string().max(64);
export const pongSchema = z.object({ result: z.literal("PONG") });
export const balanceSchema = z.object({
  context: z.object({ slot: safeUnsigned }),
  value: safeUnsigned,
});
export const accountSchema = z.object({
  owner: publicKeySchema,
  executable: z.boolean(),
  lamports: safeUnsigned,
  data: z.tuple([z.string().max(350_000), z.literal("base64")]),
});
export const accountsSchema = z.object({
  context: z.object({ slot: safeUnsigned }),
  value: z.array(accountSchema.nullable()).max(8),
});
export type RpcAccount = z.infer<typeof accountSchema>;

const envelopeSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.literal(1),
  result: z.unknown().optional(),
  error: z.object({ code: z.number().int(), message: z.string() }).optional(),
});

export function rpcResult(input: unknown): unknown {
  const envelope = envelopeSchema.parse(input);
  if (envelope.error !== undefined || envelope.result === undefined)
    throw new Error("RPC_REJECTED");
  return envelope.result;
}

export function accountBytes(account: RpcAccount): Uint8Array {
  const data = account.data[0];
  if (data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data))
    throw new Error("MALFORMED_ACCOUNT");
  const bytes = Buffer.from(data, "base64");
  if (bytes.toString("base64") !== data) throw new Error("MALFORMED_ACCOUNT");
  return bytes;
}

export function validateUsdcMint(account: RpcAccount): void {
  if (account.owner !== DEVNET.tokenProgram || account.executable)
    throw new Error("MINT_MISMATCH");
  const mint = unpackMint(
    new PublicKey(DEVNET.usdcMint),
    {
      owner: new PublicKey(account.owner),
      executable: account.executable,
      lamports: account.lamports,
      rentEpoch: 0,
      data: Buffer.from(accountBytes(account)),
    },
    TOKEN_PROGRAM_ID,
  );
  if (mint.decimals !== 6 || !mint.isInitialized)
    throw new Error("MINT_MISMATCH");
}

export function decodeClock(account: RpcAccount): {
  readonly slot: bigint;
  readonly nowSeconds: bigint;
} {
  if (account.owner !== DEVNET.sysvarOwner || account.executable)
    throw new Error("CLOCK_MISMATCH");
  const bytes = accountBytes(account);
  if (bytes.length !== 40) throw new Error("CLOCK_MISMATCH");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    slot: view.getBigUint64(0, true),
    nowSeconds: view.getBigInt64(32, true),
  };
}
