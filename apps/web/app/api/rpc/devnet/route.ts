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
    jsonrpc: z.literal("2.0"),
    id: z.union([z.number().int(), z.string().max(64)]),
    method: z.enum(["getLatestBlockhash", "getGenesisHash", "getVersion"]),
    params: z.array(z.unknown()).max(1).optional(),
  })
  .strict();
export async function POST(request: Request) {
  return route(async () => {
    assertOrigin(request);
    await rateLimit("rpc", clientIp(request));
    const session = await authenticate(sessionToken(request));
    await rateLimit("rpc-wallet", clientIp(request), session.wallet);
    const value = await body(request, input);
    const rpc = connection();
    let result: unknown;
    if (value.method === "getLatestBlockhash") {
      if (
        value.params?.length &&
        JSON.stringify(value.params) !== '[{"commitment":"finalized"}]'
      )
        throw new ApiError("RPC_PARAMS_REJECTED", 400);
      result = await rpc.getLatestBlockhashAndContext("finalized");
    } else {
      if (value.params?.length) throw new ApiError("RPC_PARAMS_REJECTED", 400);
      result =
        value.method === "getGenesisHash"
          ? await rpc.getGenesisHash()
          : await rpc.getVersion();
    }
    return json({ jsonrpc: "2.0", id: value.id, result });
  });
}
