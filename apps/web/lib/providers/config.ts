import { z } from "zod";
import { publicKeySchema } from "../solana/addresses.ts";

function endpointSchema(protocol: string, hosts: readonly string[]) {
  return z
    .url()
    .max(2_048)
    .pipe(
      z.string().refine((value) => {
        const url = new URL(value);
        return (
          url.protocol === protocol &&
          hosts.includes(url.hostname) &&
          url.port === "" &&
          url.username === "" &&
          url.password === "" &&
          url.hash === "" &&
          url.pathname === "/"
        );
      }),
    );
}

const erHosts = [
  "devnet-us.magicblock.app",
  "devnet-eu.magicblock.app",
  "devnet-as.magicblock.app",
];
const publicEndpoint = (protocol: string, hosts: readonly string[]) =>
  endpointSchema(protocol, hosts).pipe(
    z.string().refine((value) => new URL(value).search === ""),
  );
const lamports = z
  .string()
  .regex(/^[0-9]{1,20}$/)
  .transform(BigInt)
  .pipe(z.bigint().min(1n).max(0xffff_ffff_ffff_ffffn));
const seconds = z
  .string()
  .regex(/^[0-9]{1,5}$/)
  .transform(Number)
  .pipe(z.number().int().min(0).max(65_535));
const exponent = z
  .string()
  .regex(/^-?[0-9]{1,2}$/)
  .transform(Number)
  .pipe(z.number().int().min(-18).max(18));

// Pure parsing accepts a supplied environment; no process.env reads or secret
// values are exported to a client bundle. The CLI reports field names only.
const structure = z.object({
  APP_ORIGIN: z
    .url()
    .max(2_048)
    .pipe(
      z.string().refine((value) => {
        const url = new URL(value);
        return url.protocol === "https:" && url.origin === value;
      }),
    ),
  HELIUS_DEVNET_RPC_URL: endpointSchema("https:", [
    "devnet.helius-rpc.com",
  ]).pipe(
    z.string().refine((value) => {
      const url = new URL(value);
      return (
        url.searchParams.size === 1 &&
        (url.searchParams.get("api-key")?.length ?? 0) > 0
      );
    }),
  ),
  UPSTASH_REDIS_REST_URL: z
    .url()
    .max(2_048)
    .pipe(
      z.string().refine((value) => {
        const url = new URL(value);
        return (
          url.protocol === "https:" &&
          url.hostname.endsWith(".upstash.io") &&
          url.port === "" &&
          url.username === "" &&
          url.password === "" &&
          url.hash === "" &&
          url.search === "" &&
          url.pathname === "/"
        );
      }),
    ),
  UPSTASH_REDIS_REST_TOKEN: z
    .string()
    .min(1)
    .max(4_096)
    .regex(/^[^\s]+$/),
  MAGICBLOCK_ROUTER_HTTP_URL: publicEndpoint("https:", [
    "devnet-router.magicblock.app",
  ]),
  MAGICBLOCK_ER_HTTP_URL: publicEndpoint("https:", erHosts),
  MAGICBLOCK_ER_WS_URL: publicEndpoint("wss:", erHosts),
  MAGICBLOCK_VALIDATOR_IDENTITY: publicKeySchema,
  MAGICBLOCK_ORACLE_BTC_WRITE_AUTHORITY: publicKeySchema,
  MAGICBLOCK_ORACLE_ETH_WRITE_AUTHORITY: publicKeySchema,
  MAGICBLOCK_ORACLE_SOL_WRITE_AUTHORITY: publicKeySchema,
  ORACLE_MAX_AGE_SECONDS: seconds.pipe(z.number().min(1)),
  ORACLE_MAX_FUTURE_SKEW_SECONDS: seconds,
  ORACLE_MIN_EXPONENT: exponent,
  ORACLE_MAX_EXPONENT: exponent,
  SPONSOR_PUBLIC_KEY: publicKeySchema,
  SPONSOR_MIN_BALANCE_LAMPORTS: lamports,
  SPONSOR_OPERATION_LIMIT_LAMPORTS: lamports,
  SPONSOR_COMPLETION_RESERVE_LAMPORTS: lamports,
  SPONSOR_MAX_ATTEMPTS: seconds.pipe(z.number().min(1)),
});

export const authConfigSchema = structure.pick({
  APP_ORIGIN: true,
  UPSTASH_REDIS_REST_URL: true,
  UPSTASH_REDIS_REST_TOKEN: true,
});
export const rpcConfigSchema = structure.pick({ HELIUS_DEVNET_RPC_URL: true });
const sponsorFields = structure.pick({
  SPONSOR_PUBLIC_KEY: true,
  SPONSOR_MIN_BALANCE_LAMPORTS: true,
  SPONSOR_OPERATION_LIMIT_LAMPORTS: true,
  SPONSOR_COMPLETION_RESERVE_LAMPORTS: true,
  SPONSOR_MAX_ATTEMPTS: true,
});
function validateSponsorBudget(
  value: z.output<typeof sponsorFields>,
  context: z.RefinementCtx,
) {
  if (
    value.SPONSOR_COMPLETION_RESERVE_LAMPORTS >
    value.SPONSOR_OPERATION_LIMIT_LAMPORTS
  )
    context.addIssue({
      code: "custom",
      path: ["SPONSOR_COMPLETION_RESERVE_LAMPORTS"],
      message: "Invalid provider configuration",
    });
  if (
    value.SPONSOR_MIN_BALANCE_LAMPORTS < value.SPONSOR_OPERATION_LIMIT_LAMPORTS
  )
    context.addIssue({
      code: "custom",
      path: ["SPONSOR_MIN_BALANCE_LAMPORTS"],
      message: "Invalid provider configuration",
    });
}
export const sponsorConfigSchema = sponsorFields.superRefine(
  validateSponsorBudget,
);

export const providerConfigSchema = structure.pipe(
  z.transform((value: z.output<typeof structure>, context) => {
    const issue = (field: keyof typeof value): void => {
      context.addIssue({
        code: "custom",
        path: [field],
        message: "Invalid provider configuration",
      });
    };
    if (
      new URL(value.MAGICBLOCK_ER_HTTP_URL).hostname !==
      new URL(value.MAGICBLOCK_ER_WS_URL).hostname
    )
      issue("MAGICBLOCK_ER_WS_URL");
    if (value.ORACLE_MIN_EXPONENT > value.ORACLE_MAX_EXPONENT)
      issue("ORACLE_MAX_EXPONENT");
    validateSponsorBudget(value, context);
    return value;
  }),
);

export type ProviderConfig = z.infer<typeof providerConfigSchema>;
