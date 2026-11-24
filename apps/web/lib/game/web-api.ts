export class WebApiError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}
// Player-facing copy for expected failures; anything else stays generic.
const FRIENDLY: Readonly<Record<string, string>> = {
  DUNGEON_NOT_PUBLISHED:
    "The dungeon update is awaiting activation. Your wager has not been taken.",
  DUNGEON_COLLATERAL_UNAVAILABLE:
    "There is not enough treasure backing this bet. Try a smaller amount.",
  DUNGEON_QUOTE_CHANGED:
    "The available expedition changed. Review the new quote and try again.",
  DUNGEON_ACTIVE:
    "Your previous expedition is being resolved. Check it before placing another bet.",
  DUNGEON_BUSY: "Your expedition is saving. Press Play to continue.",
  DUNGEON_STATE_CHANGED:
    "Your expedition changed while the request was pending. Its saved status is being checked.",
  CAT_NOT_OWNED: "Choose a cat in your collection.",
  INSUFFICIENT_CREDIT: "Add USDC to your game balance or lower your bet.",
  AUTH_REQUIRED: "Please sign in again to continue.",
  ACCOUNT_STATE_UNAVAILABLE: "Couldn't load your account. Please refresh.",
  WALLET_OR_ACCOUNT_REQUEST_FAILED: "Your wallet didn't finish the request.",
  MESSAGE_SIGNING_REQUIRED: "This wallet can't sign in. Try another wallet.",
  TRANSACTION_SIGNING_REQUIRED: "This wallet can't approve transactions.",
  TRANSACTION_FAILED: "The transaction didn't go through. Please try again.",
  BLOCKHASH_EXPIRED: "That request expired. Please try again.",
  DRAW_STATUS_UNAVAILABLE:
    "Couldn't check your capsule yet. It appears once it's ready.",
  ASSETS_NOT_READY: "Game art is updating. Please try again shortly.",
  ADMISSION_CLOSED: "Runs are paused right now. Please check back soon.",
  SERVICE_UNAVAILABLE:
    "The transaction service is temporarily unavailable. Try again shortly.",
  LIMITER_UNAVAILABLE:
    "The transaction service is temporarily unavailable. Try again shortly.",
  ER_UNAVAILABLE: "MagicBlock is temporarily unavailable. Try again shortly.",
  RATE_LIMITED: "Too many requests. Wait a moment and try again.",
};
export function webErrorMessage(code: string) {
  if (code === "ORIGIN_REJECTED")
    return "Sign-in could not start on this site address. Please contact the PURRPS team.";
  if (code === "SERVICE_NOT_CONFIGURED")
    return "PURRPS is temporarily unavailable. Please try again once service is restored.";
  if (code === "SPONSOR_BUDGET_UNAVAILABLE")
    return "PURRPS cannot cover the Devnet fees right now. Try again when sponsorship is available.";
  return FRIENDLY[code] ?? "Something went wrong. Please try again.";
}
export async function readWebJson(response: Response): Promise<unknown> {
  if (response.body === null) throw new WebApiError("EMPTY_RESPONSE");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > 262144) {
        await reader.cancel();
        throw new WebApiError("RESPONSE_TOO_LARGE");
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new WebApiError("INVALID_RESPONSE");
  }
}
export async function webApi<T>(
  path: string,
  input?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(path, {
    method: input === undefined ? "GET" : "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: input === undefined ? {} : { "Content-Type": "application/json" },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }),
    ...(signal === undefined ? {} : { signal }),
  });
  const value = await readWebJson(response);
  if (!response.ok)
    throw new WebApiError(
      typeof value === "object" &&
        value !== null &&
        "error" in value &&
        typeof value.error === "string"
        ? value.error
        : "REQUEST_FAILED",
    );
  return value as T;
}
export const encodeBase64 = (value: Uint8Array) =>
  btoa(String.fromCharCode(...value));
export const decodeBase64 = (value: string) =>
  Uint8Array.from(atob(value), (byte) => byte.charCodeAt(0));

// Resolves after the delay, or immediately once the signal aborts.
export function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", cancel);
      resolve();
    }, ms);
    function cancel() {
      clearTimeout(timer);
      resolve();
    }
    signal.addEventListener("abort", cancel, { once: true });
  });
}
