import { PublicKey } from "@solana/web3.js";
import { z } from "zod";
import { authenticate } from "../../../../lib/server/auth";
import { readState, stateInput, u64Input } from "../../../../lib/server/chain";
import {
  assertOrigin,
  body,
  clientIp,
  json,
  route,
  sessionToken,
} from "../../../../lib/server/http";
import { readLiveRun } from "../../../../lib/server/live-run";
import { rateLimit } from "../../../../lib/server/runtime";
import { playSessionRent } from "../../../../lib/server/sponsorship";
import { checkedConnection } from "../../../../lib/server/transaction-network";
import { publicKeySchema } from "../../../../lib/solana/addresses";

const input = z.union([
  stateInput,
  z.strictObject({ kind: z.literal("liveRun"), nonce: u64Input }),
  z.strictObject({
    kind: z.literal("playSessionRent"),
    nonce: u64Input,
    inputKey: publicKeySchema,
  }),
]);
export async function POST(request: Request) {
  return route("chain.state", async () => {
    assertOrigin(request);
    await rateLimit("state", clientIp(request));
    const session = await authenticate(sessionToken(request));
    await rateLimit("state-wallet", clientIp(request), session.wallet);
    const requestState = await body(request, input);
    if (requestState.kind === "playSessionRent")
      return json(
        await playSessionRent(
          await checkedConnection("base"),
          new PublicKey(session.wallet),
          new PublicKey(requestState.inputKey),
          requestState.nonce,
        ),
      );
    return json(
      requestState.kind === "liveRun"
        ? await readLiveRun(session.wallet, requestState.nonce)
        : await readState(session.wallet, requestState),
    );
  });
}
