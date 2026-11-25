import { type DungeonRequest, dungeonRequestSchema } from "./protocol";

export type DungeonExit = Extract<DungeonRequest, { kind: "exit" }>;

const key = (wallet: string) => `purrps:dungeon:room:${wallet}`;

export function savedDeparture(wallet: string): DungeonExit | null {
  try {
    const saved = sessionStorage.getItem(key(wallet));
    if (saved === null) return null;
    const parsed = dungeonRequestSchema.safeParse(JSON.parse(saved));
    return parsed.success && parsed.data.kind === "exit" ? parsed.data : null;
  } catch {
    return null;
  }
}

export function rememberDeparture(wallet: string, exit: DungeonExit) {
  try {
    sessionStorage.setItem(key(wallet), JSON.stringify(exit));
  } catch {
    // An unavailable store still leaves the server's saved deadline in place.
  }
}

export function clearDeparture(wallet: string, nonce: string) {
  try {
    if (savedDeparture(wallet)?.nonce === nonce)
      sessionStorage.removeItem(key(wallet));
  } catch {
    // Storage can be disabled by the browser.
  }
}

export function departOnPageHide(exit: DungeonExit) {
  return fetch("/api/dungeon", {
    method: "POST",
    credentials: "same-origin",
    keepalive: true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(exit),
  });
}
