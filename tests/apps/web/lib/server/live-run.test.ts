import { readFileSync } from "node:fs";
import { BorshCoder, convertIdlToCamelCase } from "@anchor-lang/core";
import { PublicKey } from "@solana/web3.js";
import { beforeEach, expect, it, vi } from "vitest";
import { runAddresses } from "../../../../../apps/web/lib/game/run-accounts";
import { readLiveRun } from "../../../../../apps/web/lib/server/live-run";
import { DEVNET } from "../../../../../apps/web/lib/solana/addresses";
import { PURRPS_GAME_IDL } from "../../../../../apps/web/lib/solana/purrps-game";

const rpc = vi.hoisted(() => ({
  base: vi.fn(),
  er: vi.fn(),
  account: vi.fn(),
}));
vi.mock("../../../../../apps/web/lib/server/chain", () => ({
  readState: rpc.base,
}));
vi.mock("../../../../../apps/web/lib/server/transaction-network", () => ({
  checkedConnection: rpc.er,
}));

const coder = new BorshCoder(convertIdlToCamelCase(PURRPS_GAME_IDL));
const program = new PublicKey(DEVNET.program);
const wallet = new PublicKey(new Uint8Array(32).fill(1)).toBase58();
const addresses = runAddresses({ owner: wallet, nonce: 1n });
const fixture = (name: string) =>
  Buffer.from(
    readFileSync(
      new URL(`../../../../fixtures/run-delivery/${name}.hex`, import.meta.url),
      "utf8",
    ).trim(),
    "hex",
  );

beforeEach(() => vi.resetAllMocks());

it("uses finalized absence directly and avoids an ER request", async () => {
  rpc.base.mockResolvedValue({ run: { status: "absent" }, accounts: [] });
  await expect(readLiveRun(wallet, "1")).resolves.toEqual({
    run: { status: "absent" },
    er: null,
  });
  expect(rpc.er).not.toHaveBeenCalled();
});

it("returns a decoded snapshot pinned to the finalized escrow and rejects incompatible bytes", async () => {
  const original = coder.accounts.decode("runEscrow", fixture("reserved"));
  const escrow = await coder.accounts.encode("runEscrow", {
    ...original,
    delegationInitiated: true,
  });
  rpc.base.mockResolvedValue({
    run: { status: "recoveryPending" },
    accounts: [
      {
        account: {
          owner: DEVNET.program,
          executable: false,
          data: escrow.toString("base64"),
        },
      },
    ],
  });
  const data = fixture("active");
  const account = { owner: program, executable: false, data };
  rpc.account.mockResolvedValue({ context: { slot: 800 }, value: account });
  rpc.er.mockResolvedValue({ getAccountInfoAndContext: rpc.account });
  await expect(readLiveRun(wallet, "1")).resolves.toMatchObject({
    er: {
      slot: 800,
      owner: DEVNET.program,
      data: data.toString("base64"),
      market: "BTC",
    },
  });
  expect(rpc.er).toHaveBeenCalledWith(
    "er",
    original.snapshot.oracle.validator.toBase58(),
  );
  expect(rpc.account).toHaveBeenCalledWith(addresses.run[0], "confirmed");
  rpc.account.mockResolvedValue({
    context: { slot: 801 },
    value: { ...account, owner: PublicKey.default },
  });
  await expect(readLiveRun(wallet, "1")).rejects.toThrow(
    "INVALID_CHAIN_ACCOUNT",
  );
});
