import { readFileSync } from "node:fs";
import { BorshCoder, convertIdlToCamelCase } from "@anchor-lang/core";
import { PublicKey } from "@solana/web3.js";
import { beforeEach, expect, it, vi } from "vitest";
import { runAddresses } from "../../../../../apps/web/lib/game/run-accounts";
import { readLiveRun } from "../../../../../apps/web/lib/server/live-run";
import { DEVNET } from "../../../../../apps/web/lib/solana/addresses";
import { DUNGEON_WARRIORS_IDL } from "../../../../../apps/web/lib/solana/dungeon-warriors";

const rpc = vi.hoisted(() => ({
  base: vi.fn(),
  er: vi.fn(),
  account: vi.fn(),
  sponsor: vi.fn(),
}));
vi.mock("../../../../../apps/web/lib/server/runtime", async (original) => ({
  ...(await original<
    typeof import("../../../../../apps/web/lib/server/runtime")
  >()),
  sponsorshipConfig: rpc.sponsor,
}));
vi.mock("../../../../../apps/web/lib/server/chain", () => ({
  readState: rpc.base,
}));
vi.mock("../../../../../apps/web/lib/server/transaction-network", () => ({
  checkedConnection: rpc.er,
}));

const coder = new BorshCoder(convertIdlToCamelCase(DUNGEON_WARRIORS_IDL));
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

beforeEach(() => {
  vi.resetAllMocks();
  rpc.sponsor.mockReturnValue({
    SPONSOR_PUBLIC_KEY: wallet,
    SPONSOR_MIN_BALANCE_LAMPORTS: 1000n,
    SPONSOR_MAX_ATTEMPTS: 3,
  });
});

it("uses finalized absence directly and avoids an ER request", async () => {
  rpc.base.mockResolvedValue({ run: { status: "absent" }, accounts: [] });
  await expect(readLiveRun(wallet, "1")).resolves.toEqual({
    run: { status: "absent" },
    er: null,
  });
  expect(rpc.er).not.toHaveBeenCalled();
});

it("returns sponsorship for a returned run even without an ER account", async () => {
  const run = { status: "settlementReady", market: "SOL" };
  rpc.base.mockResolvedValue({ run, accounts: [] });
  await expect(readLiveRun(wallet, "1")).resolves.toEqual({
    run,
    er: null,
    sponsor: { sponsor: wallet, floor: "1000", maxAttempts: 3 },
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
  const clock = {
    owner: new PublicKey(DEVNET.sysvarOwner),
    executable: false,
    data: Buffer.alloc(40),
  };
  rpc.account.mockResolvedValue({
    context: { slot: 800 },
    value: [account, clock],
  });
  rpc.er.mockResolvedValue({
    getMultipleAccountsInfoAndContext: rpc.account,
    rpcEndpoint: "https://devnet-as.magicblock.app/",
  });
  await expect(readLiveRun(wallet, "1")).resolves.toMatchObject({
    er: {
      slot: 800,
      owner: DEVNET.program,
      data: data.toString("base64"),
      market: "BTC",
      endpoint: "https://devnet-as.magicblock.app/",
      inputKey: original.snapshot.inputPermission.inputKey.toBase58(),
      recoveryAvailable: false,
    },
  });
  expect(rpc.er).toHaveBeenCalledWith(
    "er",
    original.snapshot.oracle.validator.toBase58(),
  );
  expect(rpc.account).toHaveBeenCalledWith(
    [addresses.run[0], new PublicKey(DEVNET.clock)],
    "confirmed",
  );
  rpc.account.mockResolvedValue({
    context: { slot: 801 },
    value: [{ ...account, owner: PublicKey.default }, clock],
  });
  await expect(readLiveRun(wallet, "1")).rejects.toThrow(
    "INVALID_CHAIN_ACCOUNT",
  );
});
