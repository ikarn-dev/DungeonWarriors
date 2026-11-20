import { BN } from "@anchor-lang/core";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { afterEach, expect, it, vi } from "vitest";
import { runAddresses } from "../../../../../apps/web/lib/game/run-accounts";
import {
  type GameIntent,
  gameInstructions,
  validatePreparedGame,
} from "../../../../../apps/web/lib/game/run-transactions";
import { coder, program } from "../../../../../apps/web/lib/solana/program";
import { config } from "./fixtures";

const mock = vi.hoisted(() => ({ rpc: vi.fn(), admit: vi.fn() }));
vi.mock("../../../../../apps/web/lib/server/transaction-network", () => ({
  checkedConnection: mock.rpc,
}));
vi.mock(
  "../../../../../apps/web/lib/server/runtime",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../../../../../apps/web/lib/server/runtime")
    >()),
    runtime: () => ({ prefix: "test", redis: { eval: mock.admit } }),
  }),
);

import {
  prepare,
  submit,
  validateTransaction,
} from "../../../../../apps/web/lib/server/transactions";

function launch() {
  const owner = Keypair.generate();
  const play = Keypair.generate();
  const sponsor = Keypair.generate();
  vi.stubEnv("SPONSOR_PUBLIC_KEY", sponsor.publicKey.toBase58());
  vi.stubEnv(
    "SPONSOR_SECRET_KEY",
    Buffer.from(sponsor.secretKey).toString("base64"),
  );
  vi.stubEnv("SPONSOR_HOURLY_BUDGET_LAMPORTS", "100000000");
  vi.stubEnv(
    "SPONSOR_MIN_BALANCE_LAMPORTS",
    config.SPONSOR_MIN_BALANCE_LAMPORTS.toString(),
  );
  vi.stubEnv(
    "SPONSOR_OPERATION_LIMIT_LAMPORTS",
    config.SPONSOR_OPERATION_LIMIT_LAMPORTS.toString(),
  );
  vi.stubEnv(
    "SPONSOR_COMPLETION_RESERVE_LAMPORTS",
    config.SPONSOR_COMPLETION_RESERVE_LAMPORTS.toString(),
  );
  vi.stubEnv("SPONSOR_MAX_ATTEMPTS", String(config.SPONSOR_MAX_ATTEMPTS));
  const wallet = owner.publicKey.toBase58();
  const nonce = "4";
  const action = {
    kind: "reserveRun",
    nonce,
    sessionNonce: "3",
    inputKey: play.publicKey.toBase58(),
    inventoryVersion: "2",
    rulesVersion: 1,
    catalogVersion: 1,
    definingCatalogVersion: 1,
    cat: "acrobat",
    market: "SOL",
    stake: "1000000",
    maxGross: "2000000",
    expiresAtSeconds: 1_800_000_000,
    completionFunding: {
      sponsor: sponsor.publicKey.toBase58(),
      lamports: config.SPONSOR_COMPLETION_RESERVE_LAMPORTS.toString(),
      floor: config.SPONSOR_MIN_BALANCE_LAMPORTS.toString(),
      attempts: config.SPONSOR_MAX_ATTEMPTS,
    },
  } as const;
  const intent = { operation: "game", sponsored: false, action } as const;
  const run = runAddresses({ owner: wallet, nonce: BigInt(nonce) }).run[0];
  return { owner, play, sponsor, wallet, intent, run };
}

function instructionNames(tx: VersionedTransaction) {
  return TransactionMessage.decompile(tx.message).instructions.map((ix) =>
    ix.programId.equals(program)
      ? coder.instruction.decode(ix.data)?.name
      : ix.programId.toBase58(),
  );
}

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});

it("adds the budget and the SOL floor to the player-signed reservation within the wallet packet limit", async () => {
  const { owner, play, sponsor, wallet, intent, run } = launch();
  const loader = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
  const programData = Buffer.alloc(45);
  programData.writeUInt32LE(3);
  programData[12] = 1;
  owner.publicKey.toBuffer().copy(programData, 13);
  const player = await coder.accounts.encode("playerAccount", {
    schemaVersion: 1,
    bump: 255,
    owner: owner.publicKey,
    availableBaseUnits: new BN(1_000_000),
    lockedStakeBaseUnits: new BN(0),
    purchaseEscrowBaseUnits: new BN(0),
    nextRunNonce: new BN(intent.action.nonce),
    nextDrawNonce: new BN(1),
    nextSessionNonce: new BN(intent.action.sessionNonce),
    settledRuns: new BN(intent.action.nonce),
    wins: new BN(intent.action.nonce),
    losses: new BN(0),
    technicalRefunds: new BN(0),
  });
  const send = vi.fn().mockResolvedValue("sent");
  const simulate = vi.fn().mockResolvedValue({ value: { err: null } });
  const rent = 1_544_320;
  mock.rpc.mockResolvedValue({
    getMultipleAccountsInfo: async () => [
      { owner: program, data: player },
      null,
      null,
    ],
    getAccountInfo: async () => ({ owner: loader, data: programData }),
    getLatestBlockhash: async () => ({
      blockhash: PublicKey.default.toBase58(),
      lastValidBlockHeight: 100,
    }),
    getBalance: async () => 1_100_000_000,
    getMinimumBalanceForRentExemption: async () => rent,
    getFeeForMessage: async () => ({ value: 15_000 }),
    simulateTransaction: simulate,
    sendRawTransaction: send,
  });
  mock.admit.mockResolvedValue(1);
  const prepared = await prepare(wallet, intent);
  const tx = VersionedTransaction.deserialize(
    Buffer.from(prepared.transaction, "base64"),
  );
  validatePreparedGame(tx, wallet, intent, prepared);
  const message = TransactionMessage.decompile(tx.message);
  expect(instructionNames(tx)).toEqual([
    "fundSponsorship",
    SystemProgram.programId.toBase58(),
    "KeyspM2ssCJbqUhQ4k7sveSiY4WjnYsrXkC8oDbwde5",
    "authorizeSession",
    "reserveQuotedRun",
  ]);
  expect(prepared.operationId).toBe(run.toBase58());
  expect(message.payerKey.equals(owner.publicKey)).toBe(true);
  message.instructions.unshift(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }),
  );
  const withWalletFees = new VersionedTransaction(message.compileToV0Message());
  withWalletFees.sign([owner, play]);
  expect(withWalletFees.serialize().length).toBeLessThanOrEqual(1232);
  const encoded = Buffer.from(withWalletFees.serialize()).toString("base64");
  const moreFunds = {
    ...intent,
    action: {
      ...intent.action,
      completionFunding: {
        ...intent.action.completionFunding,
        lamports: "90000000",
      },
    },
  };
  expect(() => validateTransaction(wallet, moreFunds, encoded)).toThrow(
    "INVALID_RUN_SPONSOR",
  );
  await expect(submit(wallet, intent, encoded)).resolves.toMatchObject({
    network: "base",
  });
  expect(mock.admit).toHaveBeenCalledWith(
    expect.any(String),
    expect.arrayContaining([`test:sponsor:attempt:${run.toBase58()}`]),
    [3, "51544320", "100000000"],
  );
  const sent = VersionedTransaction.deserialize(send.mock.calls[0]?.[0]);
  expect(sent.message.staticAccountKeys).toContainEqual(sponsor.publicKey);
  expect(sent.signatures.every((sig) => sig.some(Boolean))).toBe(true);
});

it("moves the existing budget into the action account before delegating the same nonce", () => {
  const { sponsor, owner, wallet, intent, run } = launch();
  const delegation = {
    operation: "game",
    sponsored: false,
    action: {
      kind: "delegateRun",
      nonce: intent.action.nonce,
      delegationEpoch: "1",
      completionSponsor: sponsor.publicKey.toBase58(),
    },
  } satisfies GameIntent;
  const built = gameInstructions(wallet, delegation);
  const tx = new VersionedTransaction(
    new TransactionMessage({
      payerKey: built.payer,
      recentBlockhash: PublicKey.default.toBase58(),
      instructions: built.instructions,
    }).compileToV0Message(),
  );
  tx.sign([owner]);
  expect(instructionNames(tx)).toEqual(["fundRunCompletion", "delegateRun"]);
  expect(built.operationId).toBe(run.toBase58());
  expect(() =>
    validateTransaction(
      wallet,
      delegation,
      Buffer.from(tx.serialize()).toString("base64"),
    ),
  ).not.toThrow();
});

it("omits the writable Hydra accounts when settling a run that never activated", () => {
  const { wallet, intent } = launch();
  const completion = {
    operation: "game",
    sponsored: false,
    action: {
      kind: "requestCompletion",
      nonce: intent.action.nonce,
      market: "SOL",
      hasCrank: false,
    },
  } satisfies GameIntent;
  const [ix] = gameInstructions(wallet, completion).instructions;
  expect(ix?.keys.slice(-3)).toEqual(
    Array.from({ length: 3 }, () => ({
      pubkey: program,
      isSigner: false,
      isWritable: false,
    })),
  );
});

it("launches atomically with the scoped play key and the sponsor as the sole SOL payer", async () => {
  const { owner, play, sponsor, wallet, intent } = launch();
  const { sponsor: address, floor } = intent.action.completionFunding;
  const value = { ...intent, playSponsor: { sponsor: address, floor } };
  const built = gameInstructions(wallet, value);
  const msg = new TransactionMessage({
    payerKey: built.payer,
    recentBlockhash: PublicKey.default.toBase58(),
    instructions: built.instructions,
  }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  expect(instructionNames(tx)).toEqual([
    "fundSponsorship",
    "reserveQuotedRun",
    "fundRunCompletion",
    "delegateRun",
    SystemProgram.programId.toBase58(),
  ]);
  expect(tx.serialize().length).toBeLessThanOrEqual(1232);
  expect(
    msg.staticAccountKeys.slice(0, msg.header.numRequiredSignatures),
  ).toEqual([sponsor.publicKey, play.publicKey]);
  const encoded = () => Buffer.from(tx.serialize()).toString("base64");
  expect(() => validateTransaction(wallet, value, encoded())).toThrow(
    "INVALID_SIGNATURE",
  );
  tx.sign([play]);
  const programData = Buffer.alloc(45);
  programData.writeUInt32LE(3);
  programData[12] = 1;
  owner.publicKey.toBuffer().copy(programData, 13);
  const send = vi.fn().mockResolvedValue("sent");
  const simulate = vi.fn().mockResolvedValue({
    context: { slot: 30 },
    value: { err: null, accounts: [{ lamports: 1_100_000_000 }] },
  });
  mock.rpc.mockResolvedValue({
    getAccountInfo: async () => ({
      owner: new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111"),
      data: programData,
    }),
    getSignatureStatuses: async () => ({ value: [null] }),
    getBalanceAndContext: async () => ({
      context: { slot: 30 },
      value: 1_195_000_000,
    }),
    getBalance: async () => 1_195_000_000,
    simulateTransaction: simulate,
    sendRawTransaction: send,
  });
  mock.admit.mockResolvedValue(1);
  await expect(submit(wallet, value, encoded())).resolves.toMatchObject({
    network: "base",
  });
  expect(
    VersionedTransaction.deserialize(send.mock.calls[0]?.[0]).signatures.every(
      (sig) => sig.some(Boolean),
    ),
  ).toBe(true);
  expect(mock.admit).toHaveBeenCalledWith(
    expect.any(String),
    expect.any(Array),
    [3, "95000000", "100000000"],
  );
});
