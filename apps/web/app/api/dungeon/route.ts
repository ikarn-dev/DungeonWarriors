import { after } from "next/server";
import { z } from "zod";
import { dungeonRequestSchema } from "../../../lib/dungeon/protocol";
import { dungeonPrepareSchema } from "../../../lib/dungeon/request";
import { DUNGEON_V2, ENGINE } from "../../../lib/dungeon/rules";
import { authenticate } from "../../../lib/server/auth";
import { browserVerifierAddress } from "../../../lib/server/browser-config";
import { recoverDungeonWallet } from "../../../lib/server/dungeon-recovery";
import { quoteDungeon } from "../../../lib/server/dungeon-reservation";
import { updateDungeon } from "../../../lib/server/dungeon-run";
import {
  assertOrigin,
  body,
  json,
  route,
  sessionToken,
} from "../../../lib/server/http";
import {
  ApiError,
  assertAdmission,
  digest,
  runtime,
} from "../../../lib/server/runtime";

const requestSchema = z.union([dungeonPrepareSchema, dungeonRequestSchema]);

export function GET() {
  return json({
    version: DUNGEON_V2.version,
    engineHash: DUNGEON_V2.engineHash
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(""),
    engine: ENGINE,
    verifier: browserVerifierAddress(),
  });
}
export async function POST(request: Request) {
  return route("run.browser", async () => {
    assertOrigin(request);
    const { wallet } = await authenticate(sessionToken(request));
    assertAdmission([
      await runtime().browser.limit(`dungeon:${digest(wallet)}`),
    ]);
    // Up to PHYSICS.maxInputs controls of about 45 bytes each.
    const input = await body(request, requestSchema, 196608);
    const view = await (input.kind === "prepare"
      ? quoteDungeon(wallet, input)
      : updateDungeon(wallet, input)
    ).catch((error: unknown) => {
      if (["prepare", "quote", "submit"].includes(input.kind)) {
        const code =
          error instanceof ApiError ? error.code : "SERVICE_UNAVAILABLE";
        process.stderr.write(`[dungeon] ${input.kind} ${code}\n`);
      }
      throw error;
    });
    if (
      input.kind === "history" ||
      input.kind === "status" ||
      input.kind === "exit" ||
      input.kind === "cashout" ||
      (view &&
        "phase" in view &&
        ["won", "lost", "refunded"].includes(view.phase))
    )
      after(() => recoverDungeonWallet(wallet));
    return json(view);
  });
}
