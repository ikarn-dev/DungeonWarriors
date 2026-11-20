import { readFileSync } from "node:fs";
import { BN, type IdlAccounts } from "@anchor-lang/core";
import {
  AccountLayout,
  AccountState,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  displaySol,
  displayUsdc,
} from "../../../../../apps/web/lib/game/custody-client";
import { runAddresses } from "../../../../../apps/web/lib/game/run-accounts";
import {
  coder,
  pda,
  readState,
  stateInput,
} from "../../../../../apps/web/lib/server/chain";
import {
  DEVNET,
  LEADERBOARD_SEED,
} from "../../../../../apps/web/lib/solana/addresses";
import type { PurrpsGame } from "../../../../../apps/web/lib/solana/purrps-game";

const owner = Keypair.generate().publicKey;
const wallet = owner.toBase58();
const playerSeed = [Buffer.from("player"), owner.toBytes()];
const program = new PublicKey(DEVNET.program);
const playerAddress = pda("player", owner.toBytes());
const slot = 200;
type Accounts = IdlAccounts<PurrpsGame>;

async function player(
  nextRunNonce = "10",
  overrides: Partial<Accounts["playerAccount"]> = {},
) {
  return {
    owner: program,
    data: await coder.accounts.encode("playerAccount", {
      schemaVersion: 1,
      bump: PublicKey.findProgramAddressSync(playerSeed, program)[1],
      owner,
      availableBaseUnits: new BN("9007199254740993"),
      lockedStakeBaseUnits: new BN("4000000"),
      purchaseEscrowBaseUnits: new BN("2000000"),
      nextRunNonce: new BN(nextRunNonce),
      nextDrawNonce: new BN(0),
      nextSessionNonce: new BN(0),
      settledRuns: new BN(3),
      wins: new BN(1),
      losses: new BN(1),
      technicalRefunds: new BN(1),
      ...overrides,
    }),
    executable: false,
    lamports: 1_000_000,
  };
}

const noData = {
  owner: SystemProgram.programId,
  data: Buffer.alloc(0),
  executable: false,
  lamports: 1,
};

async function result(
  nonce: bigint,
  refund = false,
  aliases: Partial<Accounts["resultReceipt"]> = {},
) {
  const addresses = runAddresses({ owner: wallet, nonce });
  const path = new URL(
    "../../../../fixtures/run-delivery/terminal.hex",
    import.meta.url,
  );
  const fixture = coder.accounts.decode<Accounts["runGameState"]>(
    "runGameState",
    Buffer.from(readFileSync(path, "utf8").trim(), "hex"),
  );
  return {
    owner: program,
    data: await coder.accounts.encode("resultReceipt", {
      schemaVersion: 1,
      bump: addresses.receipt[1],
      run: addresses.run[0],
      owner,
      nonce: new BN(nonce.toString()),
      market: { sol: {} },
      snapshotHash: fixture.snapshotHash,
      rules: fixture.snapshot.rulesBinding,
      cat: fixture.snapshot.cat,
      oracle: fixture.snapshot.oracle,
      startObservation: null,
      stakeBaseUnits: new BN("1000000"),
      terminal: {
        ...fixture.terminal,
        reason: refund ? { technicalAbort: {} } : { cashOut: {} },
        score: new BN(22),
        refundBaseUnits: new BN(refund ? "1000000" : "0"),
        grossPayoutBaseUnits: new BN(refund ? "0" : "1100000"),
      },
      settledAtSeconds: new BN(1_700_000_000),
      settledAtSlot: new BN(slot - 1),
      ...aliases,
    }),
    executable: false,
    lamports: 1_000_000,
  };
}

beforeEach(() => {
  vi.stubEnv(
    "HELIUS_DEVNET_RPC_URL",
    "https://devnet.helius-rpc.com/?api-key=unit-test",
  );
  vi.spyOn(Connection.prototype, "getGenesisHash").mockResolvedValue(
    DEVNET.genesisHash,
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it("reads the wallet SOL and official USDC account at the same finalized slot", async () => {
  const mint = new PublicKey(DEVNET.usdcMint);
  const tokenProgram = new PublicKey(DEVNET.tokenProgram);
  const data = Buffer.alloc(AccountLayout.span);
  AccountLayout.encode(
    {
      mint,
      owner,
      amount: 9007199254740993n,
      state: AccountState.Initialized,
      delegateOption: 0,
      delegate: PublicKey.default,
      isNativeOption: 0,
      isNative: 0n,
      delegatedAmount: 0n,
      closeAuthorityOption: 0,
      closeAuthority: PublicKey.default,
    },
    data,
  );
  const usdc = { ...noData, owner: tokenProgram, data };
  const query = vi.spyOn(
    Connection.prototype,
    "getMultipleAccountsInfoAndContext",
  );
  query.mockResolvedValueOnce({
    context: { slot },
    value: [{ ...noData, lamports: 1_000_000_001 }, usdc],
  });
  query.mockResolvedValueOnce({ context: { slot }, value: [null, noData] });
  query.mockResolvedValueOnce({
    context: { slot },
    value: [null, { ...usdc, owner: program }],
  });
  const input = stateInput.parse({ kind: "walletFunds" });
  await expect(readState(wallet, input)).resolves.toMatchObject({
    slot,
    commitment: "finalized",
    walletFunds: {
      solLamports: "1000000001",
      usdcBaseUnits: "9007199254740993",
    },
  });
  await expect(readState(wallet, input)).resolves.toMatchObject({
    walletFunds: { solLamports: "0", usdcBaseUnits: "0" },
  });
  await expect(readState(wallet, input)).rejects.toThrow(
    "INVALID_CHAIN_ACCOUNT",
  );
  expect(query).toHaveBeenCalledWith(
    [owner, getAssociatedTokenAddressSync(mint, owner)],
    { commitment: "finalized" },
  );
  expect(displaySol("1000000001")).toBe("1.000000001");
  expect(displayUsdc("9007199254740993")).toBe("9,007,199,254.740993");
});

describe("finalized shared leaderboard", () => {
  const [address, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from(LEADERBOARD_SEED)],
    program,
  );
  const input = stateInput.parse({ kind: "leaderboard" });

  it("returns an empty board before the first settlement", async () => {
    const base = vi.spyOn(Connection.prototype, "getAccountInfoAndContext");
    for (const value of [null, noData]) {
      base.mockResolvedValueOnce({ context: { slot }, value });
      await expect(readState(wallet, input)).resolves.toMatchObject({
        commitment: "finalized",
        slot,
        leaderboard: [],
      });
    }
    expect(base).toHaveBeenCalledWith(address, "finalized");
    expect(stateInput.safeParse({ ...input, market: "SOL" }).success).toBe(
      false,
    );
  });

  it("preserves score precision and rejects duplicate wallets and wrong tie order", async () => {
    const score = new BN("9007199254740993");
    const entries = [owner, Keypair.generate().publicKey]
      .map((owner) => ({
        owner,
        nonce: new BN(0),
        run: runAddresses({ owner: owner.toBase58(), nonce: 0n }).run[0],
        score,
      }))
      .sort((a, b) => Buffer.compare(a.run.toBuffer(), b.run.toBuffer()));
    const base = vi.spyOn(Connection.prototype, "getAccountInfoAndContext");
    async function setBoard(rows: typeof entries) {
      const value = {
        ...noData,
        owner: program,
        data: await coder.accounts.encode("leaderboard", {
          schemaVersion: 1,
          bump,
          count: rows.length,
          entries: [...rows, ...Array(20 - rows.length).fill(null)],
        }),
      };
      base.mockResolvedValueOnce({ context: { slot }, value });
    }
    await setBoard(entries);
    await expect(
      readState(Keypair.generate().publicKey.toBase58(), input),
    ).resolves.toMatchObject({
      commitment: "finalized",
      slot,
      leaderboard: entries.map((entry, i) => ({
        rank: i + 1,
        wallet: entry.owner.toBase58(),
        score: score.toString(),
      })),
    });
    const [first] = entries;
    if (first === undefined) throw new Error("Missing leaderboard fixture.");
    await setBoard([
      first,
      {
        ...first,
        nonce: new BN(1),
        run: runAddresses({ owner: first.owner.toBase58(), nonce: 1n }).run[0],
        score: new BN(0),
      },
    ]);
    await expect(readState(wallet, input)).rejects.toThrow(
      "INVALID_CHAIN_ACCOUNT",
    );
    await setBoard(entries.slice().reverse());
    await expect(readState(wallet, input)).rejects.toThrow(
      "INVALID_CHAIN_ACCOUNT",
    );
  });
});

describe("finalized wallet and receipt records", () => {
  it("preserves credit precision and reads the authenticated player's PDA", async () => {
    const base = vi
      .spyOn(Connection.prototype, "getAccountInfoAndContext")
      .mockResolvedValue({
        context: { slot },
        value: await player(),
      });
    await expect(
      readState(wallet, stateInput.parse({ kind: "balances" })),
    ).resolves.toMatchObject({
      commitment: "finalized",
      slot,
      balances: {
        availableBaseUnits: "9007199254740993",
        lockedStakeBaseUnits: "4000000",
        purchaseEscrowBaseUnits: "2000000",
        nextRunNonce: "10",
        settledRuns: "3",
        wins: "1",
        losses: "1",
        technicalRefunds: "1",
      },
    });
    expect(base).toHaveBeenCalledWith(playerAddress, "finalized");
    base.mockResolvedValue({ context: { slot }, value: noData });
    await expect(
      readState(wallet, stateInput.parse({ kind: "balances" })),
    ).resolves.toMatchObject({ balances: null });
    base.mockResolvedValue({
      context: { slot },
      value: await player("10", { owner: Keypair.generate().publicKey }),
    });
    await expect(
      readState(wallet, stateInput.parse({ kind: "balances" })),
    ).rejects.toThrow("INVALID_CHAIN_ACCOUNT");
  });

  it("starts at the onchain nonce, retains pending gaps, and advances by the scanned page", async () => {
    vi.spyOn(
      Connection.prototype,
      "getAccountInfoAndContext",
    ).mockResolvedValue({
      context: { slot },
      value: await player(),
    });
    const pages = vi
      .spyOn(Connection.prototype, "getMultipleAccountsInfoAndContext")
      .mockResolvedValueOnce({
        context: { slot: slot + 1 },
        value: [await result(9n), noData, await result(7n, true)],
      })
      .mockResolvedValueOnce({
        context: { slot: slot + 2 },
        value: [null, null, null],
      });
    await expect(
      readState(wallet, stateInput.parse({ kind: "history", limit: 3 })),
    ).resolves.toMatchObject({
      commitment: "finalized",
      slot: slot + 1,
      history: {
        fromNonce: "10",
        nextFromNonce: "7",
        entries: [
          {
            nonce: "9",
            status: "settled",
            outcome: "win",
            market: "SOL",
            score: "22",
            grossPayoutBaseUnits: "1100000",
          },
          {
            nonce: "8",
            status: "pending",
            run: runAddresses({ owner: wallet, nonce: 8n }).run[0].toBase58(),
          },
          {
            nonce: "7",
            status: "refunded",
            outcome: "technicalRefund",
            refundBaseUnits: "1000000",
          },
        ],
      },
    });
    expect(pages).toHaveBeenNthCalledWith(
      1,
      [9n, 8n, 7n].map(
        (nonce) => runAddresses({ owner: wallet, nonce }).receipt[0],
      ),
      { commitment: "finalized", minContextSlot: slot },
    );
    await expect(
      readState(
        wallet,
        stateInput.parse({ kind: "history", fromNonce: "7", limit: 3 }),
      ),
    ).resolves.toMatchObject({
      history: {
        fromNonce: "7",
        nextFromNonce: "4",
        entries: [{ nonce: "6" }, { nonce: "5" }, { nonce: "4" }],
      },
    });
  });

  it("clamps the cursor at the full-width nonce and skips RPC batches for an empty history", async () => {
    const base = vi
      .spyOn(Connection.prototype, "getAccountInfoAndContext")
      .mockResolvedValue({
        context: { slot },
        value: await player("9007199254740995"),
      });
    const pages = vi
      .spyOn(Connection.prototype, "getMultipleAccountsInfoAndContext")
      .mockResolvedValue({ context: { slot }, value: [null] });
    await expect(
      readState(
        wallet,
        stateInput.parse({
          kind: "history",
          fromNonce: "18446744073709551615",
          limit: 1,
        }),
      ),
    ).resolves.toMatchObject({
      history: {
        fromNonce: "9007199254740995",
        nextFromNonce: "9007199254740994",
        entries: [{ nonce: "9007199254740994", status: "pending" }],
      },
    });
    base.mockResolvedValue({ context: { slot }, value: null });
    await expect(
      readState(wallet, stateInput.parse({ kind: "history" })),
    ).resolves.toMatchObject({
      accounts: [],
      history: { entries: [], fromNonce: "0", nextFromNonce: null },
    });
    expect(pages).toHaveBeenCalledTimes(1);
  });

  it("rejects a wrong receipt identity or a page older than its finalized player anchor", async () => {
    vi.spyOn(
      Connection.prototype,
      "getAccountInfoAndContext",
    ).mockResolvedValue({
      context: { slot },
      value: await player(),
    });
    const pages = vi
      .spyOn(Connection.prototype, "getMultipleAccountsInfoAndContext")
      .mockResolvedValueOnce({
        context: { slot },
        value: [
          await result(9n, false, { owner: Keypair.generate().publicKey }),
        ],
      })
      .mockResolvedValueOnce({ context: { slot: slot - 1 }, value: [null] });
    const input = stateInput.parse({ kind: "history", limit: 1 });
    await expect(readState(wallet, input)).rejects.toThrow(
      "INVALID_CHAIN_ACCOUNT",
    );
    await expect(readState(wallet, input)).rejects.toThrow(
      "INVALID_CHAIN_ACCOUNT",
    );
    expect(pages).toHaveBeenCalledTimes(2);
  });
});
