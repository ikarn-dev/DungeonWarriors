import "server-only";
import { isIP } from "node:net";
import { after } from "next/server";
import type { z } from "zod";
import { isLoopbackOrigin } from "../providers/config.ts";
import { ApiError, serverConfig } from "./runtime";
import {
  flushTelemetry,
  httpOutcome,
  observeDuration,
  type RouteOperation,
  telemetryEnabled,
} from "./telemetry";

// `__Host-` cookies require Secure, which Safari refuses over
// http://localhost. A loopback http origin uses an unprefixed, non-Secure
// cookie; every https origin keeps the `__Host-` cookie.
function local() {
  return isLoopbackOrigin(serverConfig().APP_ORIGIN);
}
export function sessionCookieName(): string {
  return local() ? "purrps-session" : "__Host-purrps-session";
}
export function cookie(token: string, maxAge = 43200): string {
  const secure = local() ? "" : " Secure;";
  return `${sessionCookieName()}=${token}; Path=/; HttpOnly;${secure} SameSite=Strict; Max-Age=${maxAge}`;
}
export function clientIp(request: Request) {
  const { VERCEL: platform } = process.env;
  const value =
    platform === "1" ? request.headers.get("x-vercel-forwarded-for") : null;
  return value !== null && isIP(value) > 0 ? value : "unknown";
}
export function assertOrigin(request: Request) {
  if (
    request.headers.get("origin") !== serverConfig().APP_ORIGIN ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    throw new ApiError("ORIGIN_REJECTED", 403);
}
export async function body<T>(
  request: Request,
  schema: z.ZodType<T>,
  maximum = 4096,
): Promise<T> {
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json")
    throw new ApiError("JSON_REQUIRED", 415);
  if (request.body === null) throw new ApiError("INVALID_REQUEST", 400);
  const reader = request.body.getReader();
  let timedOut = false;
  const deadline = setTimeout(() => {
    timedOut = true;
    void reader.cancel().catch(() => undefined);
  }, 5000);
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > maximum) {
        await reader.cancel();
        throw new ApiError("REQUEST_TOO_LARGE", 413);
      }
      chunks.push(part.value);
    }
  } finally {
    clearTimeout(deadline);
    reader.releaseLock();
  }
  if (timedOut) throw new ApiError("REQUEST_TIMEOUT", 408);
  try {
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return schema.parse(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    );
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("INVALID_REQUEST", 400);
  }
}
export function sessionToken(request: Request) {
  const name = sessionCookieName();
  const matches = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((value) => value.trim())
    .filter((value) => value.startsWith(`${name}=`));
  if (matches.length !== 1) throw new ApiError("AUTH_REQUIRED", 401);
  const token = matches[0]?.slice(name.length + 1);
  if (token === undefined || !/^[A-Za-z0-9_-]{43}$/.test(token))
    throw new ApiError("AUTH_REQUIRED", 401);
  return token;
}
export function json(
  value: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      Vary: "Cookie, Origin",
      ...headers,
    },
  });
}
export async function route(
  operation: RouteOperation,
  work: () => Promise<Response>,
) {
  const started = performance.now();
  let status = 503;
  try {
    const response = await work();
    status = response.status;
    return response;
  } catch (error) {
    const failure =
      error instanceof ApiError
        ? error
        : new ApiError("SERVICE_UNAVAILABLE", 503);
    status = failure.status;
    return json(
      {
        error: failure.code,
        ...(failure.code === "SERVICE_NOT_CONFIGURED" &&
        failure.fields !== undefined
          ? { fields: failure.fields }
          : {}),
      },
      failure.status,
      failure.status === 429 ? { "Retry-After": "60" } : {},
    );
  } finally {
    observeDuration(operation, started, httpOutcome(status));
    if (telemetryEnabled()) after(flushTelemetry);
  }
}
