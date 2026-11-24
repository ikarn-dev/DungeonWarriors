import { readFileSync } from "node:fs";
import {
  BorshAccountsCoder,
  convertIdlToCamelCase,
  type IdlAccounts,
} from "@anchor-lang/core";
import {
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";
import { decodeLobbyState } from "../../../../../apps/web/lib/game/lobby-state";
import { validatePreparedTransaction } from "../../../../../apps/web/lib/game/transaction-intents";
import {
  readWebJson,
  webErrorMessage,
} from "../../../../../apps/web/lib/game/web-api";
import { DEVNET } from "../../../../../apps/web/lib/solana/addresses";
import {
  PURRPS_GAME_IDL,
  type PurrpsGame,
} from "../../../../../apps/web/lib/solana/purrps-game";
import { config, wallet } from "../server/fixtures";

vi.mock(
  "../../../../../apps/web/lib/server/runtime",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../../../../../apps/web/lib/server/runtime")
    >()),
    runtime: () => ({ config }),
    sponsorshipConfig: () => config,
  }),
);

import { instructionFor } from "../../../../../apps/web/lib/server/transactions";

const coder = new BorshAccountsCoder(convertIdlToCamelCase(PURRPS_GAME_IDL));
function fixture(name: string) {
  const lines = readFileSync(
    new URL(`../../../../fixtures/starter-${name}.csv`, import.meta.url),
    "utf8",
  )
    .trim()
    .split("\n");
  const owner = lines.shift()?.split("|")[1];
  if (owner === undefined) throw new Error("fixture");
  return {
    owner,
    response: {
      network: "solana-devnet",
      commitment: "finalized",
      slot: 10,
      fetchedAt: new Date().toISOString(),
      accounts: lines.map((line) => {
        const [, address, hex] = line.split("|");
        return {
          address: address ?? "",
          account: {
            owner: DEVNET.program,
            executable: false,
            data: Buffer.from(hex ?? "", "hex").toString("base64"),
          },
        };
      }),
    },
  };
}
describe("finalized starter presentation", () => {
  it("decodes Rust collection fixtures without inventing ownership or rerolling pending requests", () => {
    const empty = fixture("empty");
    expect(decodeLobbyState(empty.response, empty.owner).cats).toEqual([]);
    const pending = fixture("pending");
    const p = decodeLobbyState(pending.response, pending.owner);
    expect(p.starter).toBe("pending");
    expect(p.pendingDraw).not.toBeNull();
    expect(p.nonce).toBe(1n);
    expect(p.cats).toEqual([]);
    const fulfilled = fixture("fulfilled");
    const f = decodeLobbyState(fulfilled.response, fulfilled.owner);
    expect(f.starter).toBe("fulfilled");
    expect(f.cats).toHaveLength(1);
    expect(f.cats[0]?.level).toBe(1);
    expect(f.selected).toBe(f.cats[0]?.id);
  });
  it("rejects confirmed-only state, foreign owners and inconsistent inventory", async () => {
    const f = fixture("empty");
    expect(() =>
      decodeLobbyState({ ...f.response, commitment: "confirmed" }, f.owner),
    ).toThrow();
    expect(() => decodeLobbyState(f.response, wallet().address)).toThrow();
    const c = f.response.accounts[2];
    if (c === undefined) throw new Error("fixture");
    const decoded = coder.decode<IdlAccounts<PurrpsGame>["collection"]>(
      "collection",
      Buffer.from(c.account.data, "base64"),
    );
    decoded.ownedMask = 1;
    c.account.data = (await coder.encode("collection", decoded)).toString(
      "base64",
    );
    expect(() => decodeLobbyState(f.response, f.owner)).toThrow();
  });
  it("refuses a pending draw ID belonging to another operation", async () => {
    const f = fixture("pending");
    const c = f.response.accounts[2];
    if (c === undefined) throw new Error("fixture");
    const decoded = coder.decode<IdlAccounts<PurrpsGame>["collection"]>(
      "collection",
      Buffer.from(c.account.data, "base64"),
    );
    decoded.pendingDraw = PublicKey.default;
    c.account.data = (await coder.encode("collection", decoded)).toString(
      "base64",
    );
    expect(() => decodeLobbyState(f.response, f.owner)).toThrow();
  });
});
describe("wallet-side transaction checks", () => {
  it("accepts canonical create/starter/selection messages and rejects appended transfers", () => {
    const owner = wallet();
    const intents = [
      { operation: "createPlayer" as const, sponsored: true },
      {
        operation: "claimStarter" as const,
        sponsored: true as const,
        nonce: "0",
        inventoryVersion: "0",
        catalogVersion: 1,
      },
      {
        operation: "selectCat" as const,
        sponsored: false as const,
        inventoryVersion: "1",
        cat: "collector" as const,
      },
    ];
    for (const intent of intents) {
      const built = instructionFor(owner.address, intent);
      const message = new TransactionMessage({
        payerKey: built.payer,
        recentBlockhash: PublicKey.default.toBase58(),
        instructions: [built.instruction],
      }).compileToV0Message();
      expect(() =>
        validatePreparedTransaction(
          new VersionedTransaction(message),
          owner.address,
          intent,
        ),
      ).not.toThrow();
      const bad = new TransactionMessage({
        payerKey: built.payer,
        recentBlockhash: PublicKey.default.toBase58(),
        instructions: [
          built.instruction,
          SystemProgram.transfer({
            fromPubkey: owner.publicKey,
            toPubkey: wallet().publicKey,
            lamports: 1,
          }),
        ],
      }).compileToV0Message();
      expect(() =>
        validatePreparedTransaction(
          new VersionedTransaction(bad),
          owner.address,
          intent,
        ),
      ).toThrow("UNEXPECTED_TRANSACTION");
    }
  });
  it("bounds response bytes even when Content-Length is absent", async () => {
    await expect(readWebJson(new Response("x".repeat(262145)))).rejects.toThrow(
      "RESPONSE_TOO_LARGE",
    );
    await expect(readWebJson(new Response("not JSON"))).rejects.toThrow(
      "INVALID_RESPONSE",
    );
    expect(await readWebJson(Response.json({ ok: true }))).toEqual({
      ok: true,
    });
  });
});

it("gives non-retry guidance for deployment failures", () => {
  expect(webErrorMessage("ORIGIN_REJECTED")).not.toContain("refresh");
  expect(webErrorMessage("SERVICE_NOT_CONFIGURED")).not.toContain("refresh");
  expect(webErrorMessage("TRANSACTION_FAILED")).toContain("didn't go through");
});
