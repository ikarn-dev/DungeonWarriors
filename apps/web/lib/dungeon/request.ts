import { pause, WebApiError, webApi } from "../game/web-api";
import type { DungeonRequest } from "./protocol";

// A busy write lock rejects before changing the record. Repeat the same
// request; never replace a wallet-approved transaction or cancel it here.
export async function requestDungeon(
  input: DungeonRequest,
  signal?: AbortSignal,
): Promise<unknown> {
  const deadline = AbortSignal.timeout(12000);
  const bounded = signal ? AbortSignal.any([signal, deadline]) : deadline;
  for (let attempt = 0; ; attempt++) {
    bounded.throwIfAborted();
    try {
      return await webApi("/api/dungeon", input, bounded);
    } catch (error) {
      if (
        !(error instanceof WebApiError) ||
        error.code !== "DUNGEON_BUSY" ||
        attempt >= 3
      )
        throw error;
      await pause(1000, bounded);
    }
  }
}
