import "server-only";
import {
  gameInstructions as buildGame,
  programInstruction as buildInstruction,
  type GameIntent,
} from "../game/run-transactions";
import { WebApiError } from "../game/web-api";
import { ApiError } from "./runtime";

export {
  type GameIntent,
  gameIntentSchema,
  gameNetwork,
} from "../game/run-transactions";

function serverBuild<T>(build: () => T): T {
  try {
    return build();
  } catch (error) {
    if (error instanceof WebApiError)
      throw new ApiError(
        error.code,
        error.code === "INVALID_PLAY_KEY" || error.code === "INVALID_MARKET"
          ? 400
          : 503,
      );
    throw error;
  }
}

export function programInstruction(
  ...args: Parameters<typeof buildInstruction>
) {
  return serverBuild(() => buildInstruction(...args));
}

export function gameInstructions(wallet: string, intent: GameIntent) {
  return serverBuild(() => buildGame(wallet, intent));
}
