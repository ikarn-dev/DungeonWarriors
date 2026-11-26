import {
  createPrivateKey,
  createPublicKey,
  randomBytes,
  sign,
} from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { providerConfigSchema } from "../../../../../apps/web/lib/providers/config.ts";
import { DEVNET } from "../../../../../apps/web/lib/solana/addresses.ts";
export function wallet() {
  const key = createPrivateKey({
    key: Buffer.concat([
      Buffer.from("302e020100300506032b657004220420", "hex"),
      randomBytes(32),
    ]),
    format: "der",
    type: "pkcs8",
  });
  const publicKey = new PublicKey(
    createPublicKey(key).export({ format: "der", type: "spki" }).subarray(-32),
  );
  return {
    publicKey,
    address: publicKey.toBase58(),
    sign: (data: Uint8Array) => sign(null, data, key),
  };
}
export const environment = {
  APP_ORIGIN: "https://dungeon-warriors.example",
  HELIUS_DEVNET_RPC_URL: "https://devnet.helius-rpc.com/?api-key=test",
  UPSTASH_REDIS_REST_URL: "https://test.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "test",
  MAGICBLOCK_ROUTER_HTTP_URL: "https://devnet-router.magicblock.app",
  MAGICBLOCK_ER_HTTP_URL: "https://devnet-as.magicblock.app",
  MAGICBLOCK_ER_WS_URL: "wss://devnet-as.magicblock.app",
  MAGICBLOCK_VALIDATOR_IDENTITY: DEVNET.program,
  MAGICBLOCK_ORACLE_BTC_WRITE_AUTHORITY: PublicKey.default.toBase58(),
  MAGICBLOCK_ORACLE_ETH_WRITE_AUTHORITY: PublicKey.default.toBase58(),
  MAGICBLOCK_ORACLE_SOL_WRITE_AUTHORITY: PublicKey.default.toBase58(),
  ORACLE_MAX_AGE_SECONDS: "5",
  ORACLE_MAX_FUTURE_SKEW_SECONDS: "1",
  ORACLE_MIN_EXPONENT: "-8",
  ORACLE_MAX_EXPONENT: "8",
  SPONSOR_PUBLIC_KEY: wallet().address,
  SPONSOR_MIN_BALANCE_LAMPORTS: "1000000000",
  SPONSOR_OPERATION_LIMIT_LAMPORTS: "100000000",
  SPONSOR_COMPLETION_RESERVE_LAMPORTS: "50000000",
  SPONSOR_MAX_ATTEMPTS: "3",
};
export const config = providerConfigSchema.parse(environment);
