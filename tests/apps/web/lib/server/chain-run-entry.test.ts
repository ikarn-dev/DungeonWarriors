import { readFileSync } from "node:fs";
import { BN } from "@anchor-lang/core";
import {
  AccountLayout,
  AccountState,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { runAddresses } from "../../../../../apps/web/lib/game/run-accounts";
import {
  coder,
  pda,
  readState,
  stateInput,
} from "../../../../../apps/web/lib/server/chain";
import { DEVNET } from "../../../../../apps/web/lib/solana/addresses";

import {
  type Accounts,
  noData,
  owner,
  player,
  program,
  slot,
  wallet,
} from "./chain-state-fixtures";

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

it("offers automatic budget funding while quoting against unencumbered vault credit", async () => {
  const fixture = coder.accounts.decode<Accounts["runGameState"]>(
    "runGameState",
    Buffer.from(
      readFileSync(
        new URL(
          "../../../../fixtures/run-delivery/active.hex",
          import.meta.url,
        ),
        "utf8",
      ).trim(),
      "hex",
    ),
  );
  const configAddress = pda("game-config");
  const house = pda("house");
  const mint = new PublicKey(DEVNET.usdcMint);
  const tokenProgram = new PublicKey(DEVNET.tokenProgram);
  const vault = getAssociatedTokenAddressSync(mint, house, true, tokenProgram);
  const authority = Keypair.generate().publicKey;
  vi.stubEnv("SPONSOR_PUBLIC_KEY", authority.toBase58());
  vi.stubEnv("SPONSOR_MIN_BALANCE_LAMPORTS", "1000000000");
  vi.stubEnv("SPONSOR_OPERATION_LIMIT_LAMPORTS", "2000000");
  vi.stubEnv("SPONSOR_COMPLETION_RESERVE_LAMPORTS", "30000");
  vi.stubEnv("SPONSOR_MAX_ATTEMPTS", "3");
  const run = runAddresses({ owner: wallet, nonce: 10n }).run[0];
  const account = async (
    name: string,
    state: object,
    lamports = 1_000_000,
  ) => ({
    ...noData,
    owner: program,
    data: await coder.accounts.encode(name, state),
    lamports,
  });
  const common = { schemaVersion: 1, bump: 255 };
  const config = (allowReservations: boolean) =>
    account("gameConfig", {
      ...common,
      admin: authority,
      usdcMint: mint,
      tokenProgram,
      usdcDecimals: 6,
      rules: fixture.snapshot.rulesBinding,
      catalog: fixture.snapshot.cat.definingCatalog,
      oracleBindings: Array.from({ length: 3 }, () => fixture.snapshot.oracle),
      vrfProgram: PublicKey.default,
      vrfQueue: PublicKey.default,
      vrfCallbackAuthority: PublicKey.default,
      allowStarter: true,
      allowPurchases: false,
      allowReservations,
    });
  const policy = await account("sponsorPolicy", {
    ...common,
    config: configAddress,
    authority,
    maxOperationLamports: new BN(100_000),
    minCompletionLamports: new BN(20_000),
    maxAttempts: 2,
    paused: false,
  });
  const budget = await account("sponsorBudget", {
    ...common,
    operation: run,
    beneficiary: owner,
    authority,
    feePayer: authority,
    purpose: { runCompletion: {} },
    limitLamports: new BN(60_000),
    spentLamports: new BN(0),
    reservedCompletionLamports: new BN(30_000),
    maxAttempts: 2,
    attempts: 0,
    expiresAtSeconds: new BN(1_700_000_301),
  });
  const houseInfo = await account("houseState", {
    ...common,
    config: configAddress,
    usdcMint: mint,
    vault,
    totalAvailableBaseUnits: new BN(1_000_000),
    totalPurchaseEscrowBaseUnits: new BN(200_000),
    totalMaxGrossBaseUnits: new BN(300_000),
    bufferBaseUnits: new BN(400_000),
  });
  const tokenData = Buffer.alloc(AccountLayout.span);
  AccountLayout.encode(
    {
      mint,
      owner: house,
      amount: 9_999_999n,
      state: AccountState.Initialized,
      delegateOption: 0,
      delegate: PublicKey.default,
      isNativeOption: 0,
      isNative: 0n,
      delegatedAmount: 0n,
      closeAuthorityOption: 0,
      closeAuthority: PublicKey.default,
    },
    tokenData,
  );
  const clockData = Buffer.alloc(40);
  clockData.writeBigInt64LE(1_700_000_000n, 32);
  const clock = {
    ...noData,
    owner: new PublicKey(DEVNET.sysvarOwner),
    data: clockData,
  };
  const usdc = { ...noData, owner: tokenProgram, data: tokenData };
  const input = stateInput.parse({ kind: "runEntry" });
  const query = vi.spyOn(
    Connection.prototype,
    "getMultipleAccountsInfoAndContext",
  );
  const initial = {
    context: { slot },
    value: [await config(true), await player(), policy],
  };
  const ready = {
    context: { slot: slot + 1 },
    value: [budget, houseInfo, usdc, clock],
  };
  vi.spyOn(
    Connection.prototype,
    "getMinimumBalanceForRentExemption",
  ).mockResolvedValue(900_000);
  query.mockResolvedValueOnce({
    ...initial,
    value: [await config(false), null, null],
  });
  await expect(readState(wallet, input)).resolves.toMatchObject({
    entry: { status: "closed" },
  });
  expect(query).toHaveBeenCalledTimes(1);
  query
    .mockResolvedValueOnce(initial)
    .mockResolvedValueOnce({ ...ready, value: [null, houseInfo, usdc, clock] });
  await expect(readState(wallet, input)).resolves.toMatchObject({
    entry: {
      status: "ready",
      completionFunding: {
        sponsor: authority.toBase58(),
        lamports: "30000",
        floor: "1000000000",
        attempts: 2,
      },
    },
  });
  query.mockResolvedValueOnce(initial).mockResolvedValueOnce(ready);
  await expect(readState(wallet, input)).resolves.toMatchObject({
    slot: slot + 1,
    entry: {
      status: "ready",
      maxStake: "899999",
      nonce: "10",
      sessionNonce: "0",
      clockSeconds: 1_700_000_000,
      completionSponsor: authority.toBase58(),
    },
  });
  clockData.writeBigInt64LE(1_700_000_301n, 32);
  query.mockResolvedValueOnce(initial).mockResolvedValueOnce(ready);
  await expect(readState(wallet, input)).resolves.toMatchObject({
    entry: {
      status: "ready",
      completionFunding: { lamports: "30000" },
    },
  });
});
