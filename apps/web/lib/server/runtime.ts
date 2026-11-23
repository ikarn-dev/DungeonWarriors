import "server-only";
import { createHash } from "node:crypto";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import type { z } from "zod";
import {
  authConfigSchema,
  erConfigSchema,
  rpcConfigSchema,
  sponsorConfigSchema,
} from "../providers/config.ts";
import { observeDuration } from "./telemetry";

export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly fields?: readonly string[],
  ) {
    super(code);
  }
}
function requiredConfig<T>(schema: z.ZodType<T>) {
  const result = schema.safeParse(process.env);
  if (!result.success)
    throw new ApiError("SERVICE_NOT_CONFIGURED", 503, [
      ...new Set(
        result.error.issues
          .map((issue) => issue.path[0])
          .filter(
            (field): field is string =>
              typeof field === "string" && /^[A-Z][A-Z0-9_]*$/.test(field),
          ),
      ),
    ]);
  return result.data;
}
export const serverConfig = () => requiredConfig(authConfigSchema);
export const baseRpcConfig = () => requiredConfig(rpcConfigSchema);
export const erRpcConfig = () => requiredConfig(erConfigSchema);
export const sponsorshipConfig = () => requiredConfig(sponsorConfigSchema);
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
let singleton: ReturnType<typeof makeRuntime> | undefined;
function makeRuntime() {
  const config = serverConfig();
  const redis = new Redis({
    url: config.UPSTASH_REDIS_REST_URL,
    token: config.UPSTASH_REDIS_REST_TOKEN,
    retry: false,
    signal: () => AbortSignal.timeout(5000),
  });
  redis.use(async (request, next) => {
    const started = performance.now();
    let ok = false;
    try {
      const result = await next(request);
      ok = Array.isArray(result)
        ? result.every((item) => item.error == null)
        : result.error == null;
      return result;
    } finally {
      observeDuration("redis", started, ok ? "ok" : "unavailable");
    }
  });
  const prefix = `purrps:devnet:${digest(config.APP_ORIGIN).slice(0, 16)}`;
  const limiter = (limit: number) =>
    new Ratelimit({
      redis,
      prefix: `${prefix}:limit:${limit}`,
      limiter: Ratelimit.slidingWindow(limit, "1 m"),
      timeout: 3000,
      analytics: false,
      ephemeralCache: false,
    });
  return {
    config,
    redis,
    prefix,
    global: limiter(120),
    ip: limiter(20),
    wallet: limiter(30),
    browser: limiter(90),
  };
}
export function runtime() {
  if (singleton === undefined) singleton = makeRuntime();
  return singleton;
}
export async function rateLimit(
  operation: string,
  ip: string,
  wallet?: string,
) {
  const r = runtime();
  const results = await Promise.all([
    r.global.limit(operation),
    r.ip.limit(`${operation}:${digest(ip)}`),
    ...(wallet === undefined
      ? []
      : [r.wallet.limit(`${operation}:${digest(wallet)}`)]),
  ]);
  assertAdmission(results);
}
export function assertAdmission(
  results: ReadonlyArray<{ success: boolean; reason?: string | undefined }>,
) {
  if (results.some((result) => result.reason === "timeout"))
    throw new ApiError("LIMITER_UNAVAILABLE", 503);
  if (results.some((result) => !result.success))
    throw new ApiError("RATE_LIMITED", 429);
}
