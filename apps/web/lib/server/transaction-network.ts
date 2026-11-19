import "server-only";
import { Connection } from "@solana/web3.js";
import { z } from "zod";
import { DEVNET } from "../solana/addresses.ts";
import { connection } from "./chain";
import { ApiError, erRpcConfig } from "./runtime";

export const networkSchema = z.enum(["base", "er"]);
export type TransactionNetwork = z.infer<typeof networkSchema>;

export async function checkedConnection(
  network: TransactionNetwork,
  pinnedValidator?: string,
) {
  if (network === "base") {
    const rpc = connection();
    if ((await rpc.getGenesisHash()) !== DEVNET.genesisHash)
      throw new ApiError("WRONG_NETWORK", 503);
    return rpc;
  }
  const {
    MAGICBLOCK_ER_HTTP_URL: url,
    MAGICBLOCK_VALIDATOR_IDENTITY: expected,
  } = erRpcConfig();
  if (pinnedValidator !== undefined && pinnedValidator !== expected)
    throw new ApiError("ER_VALIDATOR_MISMATCH", 503);
  const timedFetch: typeof fetch = (input, init) =>
    fetch(input, {
      ...init,
      signal: AbortSignal.timeout(8000),
      redirect: "error",
    });
  const response = await timedFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getIdentity" }),
  });
  if (!response.ok) throw new ApiError("ER_UNAVAILABLE", 503);
  const result = await response.json();
  if (result?.result?.identity !== expected)
    throw new ApiError("ER_VALIDATOR_MISMATCH", 503);
  return new Connection(url, {
    commitment: "confirmed",
    disableRetryOnRateLimit: true,
    fetch: timedFetch,
  });
}
