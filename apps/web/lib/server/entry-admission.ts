import "server-only";
import type { z } from "zod";
import { ApiError } from "./runtime";
import type { intentSchema } from "./transactions";
export function assertCurrentEntry(intent: z.infer<typeof intentSchema>) {
  if (
    (intent.operation === "game" &&
      (intent.action.kind === "reserveRun" ||
        (intent.action.kind === "purchaseCapsule" &&
          intent.action.capsule === "upgrade"))) ||
    (intent.operation === "owner" && intent.instruction === "reserveRun")
  )
    throw new ApiError("ADMISSION_CLOSED", 409);
}
