import { expect, it } from "vitest";
import { assertCurrentEntry } from "../../../../../apps/web/lib/server/entry-admission";
import {
  intentSchema,
  prepare,
  submit,
} from "../../../../../apps/web/lib/server/transactions";
import { owner } from "../dungeon/fixtures";

it("rejects legacy new wagers and upgrade purchases before RPC or wallet debit", async () => {
  for (const action of [
    {
      kind: "purchaseCapsule",
      capsule: "upgrade",
      nonce: "0",
      inventoryVersion: "0",
      catalogVersion: 1,
    },
  ]) {
    const intent = intentSchema.parse({
      operation: "game",
      sponsored: false,
      action,
    });
    expect(() => assertCurrentEntry(intent)).toThrow("ADMISSION_CLOSED");
    await expect(prepare(owner, intent)).rejects.toThrow("ADMISSION_CLOSED");
    await expect(submit(owner, intent, "unused")).rejects.toThrow(
      "ADMISSION_CLOSED",
    );
  }
  const intent = intentSchema.parse({
    operation: "owner",
    instruction: "reserveRun",
    sponsored: false,
  });
  await expect(prepare(owner, intent)).rejects.toThrow("ADMISSION_CLOSED");
  expect(() =>
    assertCurrentEntry(
      intentSchema.parse({
        operation: "game",
        sponsored: false,
        action: { kind: "refundCapsule", nonce: "0" },
      }),
    ),
  ).not.toThrow();
  expect(() =>
    assertCurrentEntry(
      intentSchema.parse({
        operation: "game",
        sponsored: false,
        action: {
          kind: "purchaseCapsule",
          capsule: "paidCat",
          nonce: "0",
          inventoryVersion: "0",
          catalogVersion: 1,
        },
      }),
    ),
  ).not.toThrow();
});
