import { utils } from "@anchor-lang/core";
import { z } from "zod";
import { authenticate } from "../../../../lib/server/auth";
import {
  assertOrigin,
  body,
  clientIp,
  json,
  route,
  sessionToken,
} from "../../../../lib/server/http";
import { ApiError, rateLimit } from "../../../../lib/server/runtime";
import { observeTransactionStatus } from "../../../../lib/server/telemetry";
import {
  checkedConnection,
  networkSchema,
} from "../../../../lib/server/transaction-network";

const input = z
  .object({
    network: networkSchema.default("base"),
    lastValidBlockHeight: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER)
      .optional(),
    signature: z
      .string()
      .min(64)
      .max(88)
      .regex(/^[1-9A-HJ-NP-Za-km-z]+$/),
  })
  .strict();
export async function POST(request: Request) {
  return route("tx.status", async () => {
    assertOrigin(request);
    await rateLimit("status", clientIp(request));
    const session = await authenticate(sessionToken(request));
    await rateLimit("status-wallet", clientIp(request), session.wallet);
    const value = await body(request, input);
    if (utils.bytes.bs58.decode(value.signature).length !== 64)
      throw new ApiError("INVALID_SIGNATURE", 400);
    const rpc = await checkedConnection(value.network);
    const readSignature = () =>
      rpc.getSignatureStatuses([value.signature], {
        searchTransactionHistory: true,
      });
    let result = await readSignature();
    const pastValidity =
      result.value[0] == null &&
      value.lastValidBlockHeight !== undefined &&
      (await rpc.getBlockHeight("finalized")) > value.lastValidBlockHeight;
    // Reconcile after the finalized height read so an earlier null cannot
    // declare expiry while the transaction is landing.
    if (pastValidity) result = await readSignature();
    const status = result.value[0] ?? null;
    const expired = status === null && pastValidity;
    const resolution =
      status === null
        ? expired
          ? "expired"
          : "unknown"
        : status.confirmationStatus === "finalized"
          ? status.err === null
            ? "finalized"
            : "failed"
          : "pending";
    observeTransactionStatus(value.network, resolution);
    return json({
      slot: result.context.slot,
      network: value.network,
      status,
      resolution,
    });
  });
}
