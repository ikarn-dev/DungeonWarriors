import assert from "node:assert/strict";
import { test } from "node:test";
import { waitForFinalized } from "../../../scripts/program/publication-status.mjs";

function client(statuses) {
  let reads = 0;
  return {
    get reads() {
      return reads;
    },
    async getSignatureStatuses(signatures, options) {
      assert.deepEqual(signatures, ["original-signature"]);
      assert.equal(options.searchTransactionHistory, true);
      const status = statuses[reads++];
      if (status instanceof Error) throw status;
      return { value: [status ?? null] };
    },
  };
}
const options = { attempts: 3, pause: async () => {} };

test("publication waits for finality over HTTP and preserves the original signature", async () => {
  const rpc = client([
    null,
    { confirmationStatus: "confirmed" },
    { confirmationStatus: "finalized", slot: 123 },
  ]);
  assert.equal(
    (await waitForFinalized(rpc, "original-signature", options)).slot,
    123,
  );
  assert.equal(rpc.reads, 3);
});
test("failed publication stops without waiting or resubmitting", async () => {
  const rpc = client([{ err: { InstructionError: [0, "Custom"] } }]);
  await assert.rejects(
    waitForFinalized(rpc, "original-signature", options),
    /PUBLICATION_FAILED:original-signature/,
  );
  assert.equal(rpc.reads, 1);
});
test("unknown finality is bounded and identifies the signature for reconciliation", async () => {
  const rpc = client([]);
  await assert.rejects(
    waitForFinalized(rpc, "original-signature", options),
    /PUBLICATION_NOT_FINALIZED:original-signature/,
  );
  assert.equal(rpc.reads, 3);
});
test("RPC errors remain unknown rather than causing a duplicate publication", async () => {
  const rpc = client([new Error("network unavailable")]);
  await assert.rejects(
    waitForFinalized(rpc, "original-signature", options),
    /PUBLICATION_STATUS_UNKNOWN:original-signature/,
  );
  assert.equal(rpc.reads, 1);
});
