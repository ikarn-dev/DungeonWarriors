import { utils } from "@anchor-lang/core";
import { z } from "zod";
import { authenticate } from "../../../../lib/server/auth";
import { connection } from "../../../../lib/server/chain";
import {
  assertOrigin,
  body,
  clientIp,
  json,
  route,
  sessionToken,
} from "../../../../lib/server/http";
import { ApiError, rateLimit } from "../../../../lib/server/runtime";

const input = z
  .object({
    signature: z
      .string()
      .min(64)
      .max(88)
      .regex(/^[1-9A-HJ-NP-Za-km-z]+$/),
  })
  .strict();
export async function POST(request: Request) {
  return route(async () => {
    assertOrigin(request);
    await rateLimit("status", clientIp(request));
    const session = await authenticate(sessionToken(request));
    await rateLimit("status-wallet", clientIp(request), session.wallet);
    const value = await body(request, input);
    if (utils.bytes.bs58.decode(value.signature).length !== 64)
      throw new ApiError("INVALID_SIGNATURE", 400);
    const result = await connection().getSignatureStatuses([value.signature], {
      searchTransactionHistory: true,
    });
    return json({ slot: result.context.slot, status: result.value[0] ?? null });
  });
}
