import { PublicKey } from "@solana/web3.js";
import { z } from "zod";

export const publicKeySchema = z
  .string()
  .min(32)
  .max(44)
  .pipe(
    z.string().refine((value) => {
      try {
        return new PublicKey(value).toBase58() === value;
      } catch {
        return false;
      }
    }, "Invalid canonical Solana public key"),
  );

export const DEVNET = {
  genesisHash: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
  program: "F1cmavHq4562uJ8JmRPM5oFk8q28GW5hadXnZfVCCcUx",
  usdcMint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  oracleProgram: "PriCems5tHihc6UDXDjzjeawomAwBduWMGAi8ZUjppd",
  vrfProgram: "Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz",
  vrfQueue: "Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh",
  clock: "SysvarC1ock11111111111111111111111111111111",
  sysvarOwner: "Sysvar1111111111111111111111111111111111111",
} as const;

export const MARKETS = [
  {
    market: "BTC",
    feedId: 1,
    authorityEnv: "MAGICBLOCK_ORACLE_BTC_WRITE_AUTHORITY",
  },
  {
    market: "ETH",
    feedId: 2,
    authorityEnv: "MAGICBLOCK_ORACLE_ETH_WRITE_AUTHORITY",
  },
  {
    market: "SOL",
    feedId: 6,
    authorityEnv: "MAGICBLOCK_ORACLE_SOL_WRITE_AUTHORITY",
  },
] as const;

export function oracleAddress(feedId: number): string {
  if (!MARKETS.some((market) => market.feedId === feedId))
    throw new RangeError("Unsupported market");
  const encode = new TextEncoder();
  return PublicKey.findProgramAddressSync(
    [
      encode.encode("price_feed"),
      encode.encode("pyth-lazer"),
      encode.encode(String(feedId)),
    ],
    new PublicKey(DEVNET.oracleProgram),
  )[0].toBase58();
}

// SDK 0.17.3 defaults to a per-callback-program identity, not the legacy global PDA.
export function vrfCallbackAuthority(program: string): string {
  const key = publicKeySchema.parse(program);
  return PublicKey.findProgramAddressSync(
    [new TextEncoder().encode("identity"), new PublicKey(key).toBytes()],
    new PublicKey(DEVNET.vrfProgram),
  )[0].toBase58();
}
