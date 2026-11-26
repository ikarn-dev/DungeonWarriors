import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { IdlAccounts } from "@anchor-lang/core";
import {
  DELEGATION_PROGRAM_ID,
  EPHEMERAL_VAULT_ID,
  MAGIC_CONTEXT_ID,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  type AccountInfo,
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  displayUsdc,
  parseUsdc,
  validatePreparedPlayerAction,
} from "../../../../../apps/web/lib/game/custody-client";
import {
  decodeEscrowAccount,
  runAddresses,
} from "../../../../../apps/web/lib/game/run-accounts";
import {
  crankInstructions,
  stalledRunFaultAt,
} from "../../../../../apps/web/lib/game/run-crank";
import { validatePreparedGame } from "../../../../../apps/web/lib/game/run-transactions";
import {
  DEVNET,
  LEADERBOARD_SEED,
} from "../../../../../apps/web/lib/solana/addresses.ts";
import type { DungeonWarriors } from "../../../../../apps/web/lib/solana/dungeon-warriors.ts";
import {
  crankAddress,
  hydraProgram,
  program,
} from "../../../../../apps/web/lib/solana/program";

const rpc = vi.hoisted(() => ({
  base: vi.fn(),
  er: vi.fn(),
  network: vi.fn(),
}));
vi.mock("../../../../../apps/web/lib/server/transaction-network", () => ({
  checkedConnection: rpc.network,
}));

import {
  coder,
  finalizedRunState,
} from "../../../../../apps/web/lib/server/chain";
import {
  type GameIntent,
  gameInstructions,
  gameNetwork,
} from "../../../../../apps/web/lib/server/game-transactions";
import {
  intentSchema,
  prepare,
  submit,
  validateTransaction,
} from "../../../../../apps/web/lib/server/transactions";

afterEach(() => vi.resetAllMocks());

it("builds an adjacent Hydra trigger and onchain advance for the pinned run", () => {
  const run = Keypair.generate().publicKey;
  const payer = Keypair.generate().publicKey;
  const oracle = Keypair.generate().publicKey;
  const [compute, memo, trigger, advance] = crankInstructions(
    run,
    payer,
    oracle,
    "7",
    "3",
    "driver:1",
  );
  const task = crankAddress(run);
  expect(compute?.programId).toEqual(ComputeBudgetProgram.programId);
  const second = crankInstructions(run, payer, oracle, "7", "3", "driver:2");
  expect(memo?.data.toString()).toBe("driver:1");
  expect(second[1]?.data).not.toEqual(memo?.data);
  expect(second.slice(-2)).toEqual([trigger, advance]);
  expect(trigger?.programId).toEqual(hydraProgram);
  expect(trigger?.data).toEqual(Buffer.from([1]));
  expect(trigger?.keys).toEqual([
    { pubkey: task, isWritable: true, isSigner: false },
    { pubkey: payer, isWritable: true, isSigner: true },
    { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isWritable: false, isSigner: false },
  ]);
  expect(advance?.programId).toEqual(program);
  expect(advance?.keys.map((key) => key.pubkey)).toEqual([
    run,
    oracle,
    task,
    MAGIC_CONTEXT_ID,
    SYSVAR_INSTRUCTIONS_PUBKEY,
  ]);
  const data = advance?.data ?? Buffer.alloc(0);
  expect(coder.instruction.decode(data)?.name).toBe("advanceRun");
  expect(data.readBigUInt64LE(8)).toBe(7n);
  expect(data.readBigUInt64LE(16)).toBe(3n);
});

it("waits until trusted clock credit exceeds the two-second backlog", () => {
  expect(stalledRunFaultAt(100n, 0n)).toBe(104n);
  expect(stalledRunFaultAt(100n, 1_000n)).toBe(105n);
  expect(stalledRunFaultAt(100n, 1_900n)).toBe(105n);
});

function intent(action: GameIntent["action"]): GameIntent {
  return { operation: "game", action, sponsored: false };
}

function assemble(owner: Keypair, play: Keypair, value: GameIntent) {
  const built = gameInstructions(owner.publicKey.toBase58(), value);
  const message = new TransactionMessage({
    payerKey: built.payer,
    recentBlockhash: PublicKey.default.toBase58(),
    instructions: built.instructions,
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  const signers = message.staticAccountKeys
    .slice(0, message.header.numRequiredSignatures)
    .map((key) => (key.equals(owner.publicKey) ? owner : play));
  tx.sign(signers);
  return { built, tx, encoded: Buffer.from(tx.serialize()).toString("base64") };
}

const runNonce = {
  nonce: "9007199254740993",
  delegationEpoch: "1",
} as const;

describe("game transaction intents", () => {
  it("reviews a single atomic authorization and reservation with an exact gross cap", () => {
    const owner = Keypair.generate();
    const play = Keypair.generate();
    const wallet = owner.publicKey.toBase58();
    const value = intent({
      kind: "reserveRun",
      nonce: "0",
      sessionNonce: "0",
      inputKey: play.publicKey.toBase58(),
      expiresAtSeconds: 1800000000,
      inventoryVersion: "2",
      rulesVersion: 1,
      catalogVersion: 1,
      definingCatalogVersion: 1,
      cat: "acrobat",
      market: "SOL",
      stake: "5000000",
      maxGross: "25000000",
    });
    const { built, encoded, tx } = assemble(owner, play, value);
    expect(built.instructions).toHaveLength(3);
    expect(tx.serialize().length).toBeLessThan(1232);
    expect(tx.message.header.numRequiredSignatures).toBe(2);
    expect(() => validateTransaction(wallet, value, encoded)).not.toThrow();
    if (value.action.kind !== "reserveRun") throw new Error("Invalid fixture");
    const changed = intent({ ...value.action, maxGross: "24999999" });
    expect(() => validateTransaction(wallet, changed, encoded)).toThrow(
      "TRANSACTION_REJECTED",
    );
  });
  it("validates wallet custody bytes on the client and preserves exact USDC amounts", () => {
    const owner = Keypair.generate();
    const wallet = owner.publicKey.toBase58();
    const amount = parseUsdc("9007199254.740993").toString();
    expect(amount).toBe("9007199254740993");
    expect(displayUsdc(amount)).toBe("9,007,199,254.740993");
    expect(() => parseUsdc("1.0000001")).toThrow();
    for (const kind of ["deposit", "withdraw"] as const) {
      const value = {
        operation: "game",
        sponsored: false,
        action: { kind, amount },
      } as const;
      const { tx } = assemble(owner, Keypair.generate(), value);
      expect(() =>
        validatePreparedPlayerAction(tx, wallet, value),
      ).not.toThrow();
      expect(() =>
        validatePreparedPlayerAction(tx, wallet, {
          ...value,
          action: { kind, amount: "1" },
        }),
      ).toThrow("UNEXPECTED_TRANSACTION");
    }
  });
  it("builds and checks all wallet-signed messages through the deployed IDL", () => {
    const owner = Keypair.generate();
    const play = Keypair.generate();
    const inputKey = play.publicKey.toBase58();
    const wallet = owner.publicKey.toBase58();
    const variants = [
      { kind: "deposit", amount: "1" },
      { kind: "withdraw", amount: "9007199254740993" },
      {
        kind: "purchaseCapsule",
        capsule: "paidCat",
        nonce: "2",
        inventoryVersion: "3",
        catalogVersion: 1,
      },
      { kind: "refundCapsule", nonce: "2" },
      {
        kind: "applyUpgrade",
        cat: "collector",
        grade: "epic",
        level: 1,
        definingCatalogVersion: 1,
        inventoryVersion: "3",
      },
      {
        kind: "authorizeSession",
        nonce: "1",
        inputKey,
        expiresAtSeconds: 1800000000,
        allowance: "1000000",
      },
      { kind: "revokeSession", nonce: "1" },
      {
        kind: "reserveRun",
        nonce: runNonce.nonce,
        inputKey,
        sessionNonce: "1",
        inventoryVersion: "2",
        rulesVersion: 1,
        catalogVersion: 2,
        definingCatalogVersion: 1,
        cat: "collector",
        market: "SOL",
        stake: "1000000",
      },
      { kind: "delegateRun", ...runNonce },
      { kind: "activateRun", ...runNonce, market: "SOL", inputKey },
      { kind: "revokeRunInputKey", nonce: runNonce.nonce },
      { kind: "suspendOrResumeRun", nonce: runNonce.nonce, market: "SOL" },
      {
        kind: "resumeRun",
        nonce: runNonce.nonce,
        market: "SOL",
        inputKey,
        suspendedAt: "1800000000",
      },
      { kind: "expireDelegatedActivation", nonce: runNonce.nonce },
      { kind: "abortUndelegatedReservation", nonce: runNonce.nonce },
      { kind: "requestCompletion", nonce: runNonce.nonce, market: "SOL" },
      { kind: "settleReturnedRun", nonce: runNonce.nonce, market: "SOL" },
    ] as const satisfies readonly GameIntent["action"][];
    const addresses = runAddresses({
      owner: wallet,
      nonce: BigInt(runNonce.nonce),
    });
    for (const action of variants) {
      const reviewed = intent(action);
      const value = intentSchema.parse(reviewed);
      const { built, encoded, tx } = assemble(owner, play, reviewed);
      const programInstruction = built.instructions.at(-1);
      expect(programInstruction).toBeDefined();
      expect(
        coder.instruction.decode(programInstruction?.data ?? Buffer.alloc(0))
          ?.name,
      ).toBe(action.kind);
      expect(
        validateTransaction(wallet, value, encoded).serialize().length,
      ).toBeLessThan(1232);
      const prepared = {
        operationId: built.operationId,
        blockhash: tx.message.recentBlockhash,
        network: gameNetwork(action),
      };
      const unsigned = new VersionedTransaction(tx.message);
      expect(() =>
        validatePreparedGame(unsigned, wallet, reviewed, prepared),
      ).not.toThrow();
      expect(() =>
        validatePreparedGame(unsigned, wallet, reviewed, {
          ...prepared,
          network: prepared.network === "base" ? "er" : "base",
        }),
      ).toThrow("UNEXPECTED_TRANSACTION");
      if ("nonce" in action && action.nonce === runNonce.nonce)
        expect(built.operationId).toBe(addresses.run[0].toBase58());
      if (gameNetwork(action) === "er")
        expect(
          programInstruction?.keys.some((key) =>
            key.pubkey.equals(MAGIC_CONTEXT_ID),
          ),
        ).toBe(true);
      if (action.kind === "requestCompletion" || action.kind === "activateRun")
        expect(
          programInstruction?.keys.some((key) =>
            key.pubkey.equals(EPHEMERAL_VAULT_ID),
          ),
        ).toBe(true);
      if (
        action.kind === "requestCompletion" ||
        action.kind === "settleReturnedRun"
      ) {
        const [board] = PublicKey.findProgramAddressSync(
          [Buffer.from(LEADERBOARD_SEED)],
          new PublicKey(DEVNET.program),
        );
        expect(
          programInstruction?.keys.some((key) => key.pubkey.equals(board)),
        ).toBe(true);
      }
      if (action.kind === "withdraw") {
        expect(
          built.instructions[0]?.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID),
        ).toBe(true);
        const destination = getAssociatedTokenAddressSync(
          new PublicKey(DEVNET.usdcMint),
          owner.publicKey,
        );
        expect(built.instructions[0]?.keys[1]?.pubkey.equals(destination)).toBe(
          true,
        );
        expect(
          programInstruction?.keys.some((key) =>
            key.pubkey.equals(destination),
          ),
        ).toBe(true);
      }
      if (action.kind === "authorizeSession") {
        expect(tx.message.header.numRequiredSignatures).toBe(2);
        expect(built.instructions[0]?.data.readBigInt64LE(11)).toBe(
          BigInt(action.expiresAtSeconds),
        );
        tx.signatures[1]?.fill(0);
        expect(() =>
          validateTransaction(
            wallet,
            value,
            Buffer.from(tx.serialize()).toString("base64"),
          ),
        ).toThrow("INVALID_SIGNATURE");
      }
    }
  });

  it("binds the owner's reviewed amount and refuses unbounded or extra fields", () => {
    const owner = Keypair.generate();
    const value = intent({ kind: "withdraw", amount: "1" });
    const { encoded } = assemble(owner, owner, value);
    expect(() =>
      validateTransaction(
        owner.publicKey.toBase58(),
        intent({ kind: "withdraw", amount: "2" }),
        encoded,
      ),
    ).toThrow("TRANSACTION_REJECTED");
    for (const amount of ["0", "1.0", "18446744073709551616"]) {
      expect(
        intentSchema.safeParse(intent({ kind: "withdraw", amount })).success,
      ).toBe(false);
    }
    expect(intentSchema.safeParse({ ...value, network: "er" }).success).toBe(
      false,
    );
  });

  it("accepts wallet fee instructions while preserving both withdrawal instructions", () => {
    const owner = Keypair.generate();
    const wallet = owner.publicKey.toBase58();
    const value = intent({ kind: "withdraw", amount: "1" });
    const built = gameInstructions(wallet, value);
    const signed = (price: number, reverse = false) => {
      const instructions = reverse
        ? [...built.instructions].reverse()
        : built.instructions;
      const msg = new TransactionMessage({
        payerKey: owner.publicKey,
        recentBlockhash: PublicKey.default.toBase58(),
        instructions: [
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: price }),
          ...instructions,
        ],
      }).compileToV0Message();
      const tx = new VersionedTransaction(msg);
      tx.sign([owner]);
      return Buffer.from(tx.serialize()).toString("base64");
    };
    expect(() =>
      validateTransaction(wallet, value, signed(250_000)),
    ).not.toThrow();
    expect(() => validateTransaction(wallet, value, signed(250_001))).toThrow(
      "TRANSACTION_REJECTED",
    );
    expect(() =>
      validateTransaction(wallet, value, signed(250_000, true)),
    ).toThrow("TRANSACTION_REJECTED");
  });

  it("returns the original signature when a wallet transaction response is lost", async () => {
    const owner = Keypair.generate();
    const wallet = owner.publicKey.toBase58();
    const sendRawTransaction = vi.fn().mockRejectedValue(new Error("timeout"));
    const connection = {
      getLatestBlockhash: vi.fn().mockResolvedValue({
        blockhash: PublicKey.default.toBase58(),
        lastValidBlockHeight: 12,
      }),
      getFeeForMessage: vi.fn().mockResolvedValue({ value: 5000 }),
      simulateTransaction: vi.fn().mockResolvedValue({ value: { err: null } }),
      sendRawTransaction,
    };
    rpc.network.mockResolvedValue(connection);
    const value = intent({ kind: "deposit", amount: "1" });
    const out = await prepare(wallet, value);
    expect(out).toMatchObject({ network: "base", lastValidBlockHeight: 12 });
    const tx = VersionedTransaction.deserialize(
      Buffer.from(out.transaction, "base64"),
    );
    tx.sign([owner]);
    const result = await submit(
      wallet,
      value,
      Buffer.from(tx.serialize()).toString("base64"),
    );
    expect(result).toMatchObject({
      status: "requested",
      unknownResponse: true,
      network: "base",
    });
    expect(result.signature.length).toBeGreaterThanOrEqual(64);
    expect(sendRawTransaction).toHaveBeenCalledTimes(1);
    expect(
      Buffer.from(sendRawTransaction.mock.calls[0]?.[0]).equals(
        Buffer.from(tx.serialize()),
      ),
    ).toBe(true);
  });
});

const identity = {
  owner: new PublicKey(new Uint8Array(32).fill(1)).toBase58(),
  nonce: 1n,
};
const addresses = runAddresses(identity);
const fixture = (name: string): AccountInfo<Buffer> => ({
  owner: new PublicKey(DEVNET.program),
  data: Buffer.from(
    readFileSync(
      new URL(`../../../../fixtures/run-delivery/${name}.hex`, import.meta.url),
      "utf8",
    ).trim(),
    "hex",
  ),
  lamports: 1,
  executable: false,
});

describe("recovery from finalized base state", () => {
  it("pins ER activation to the frozen regional validator and play key", async () => {
    const info = fixture("reserved");
    const decoded = coder.accounts.decode<
      IdlAccounts<DungeonWarriors>["runEscrow"]
    >("runEscrow", info.data);
    const snapshot = {
      ...decoded.snapshot,
      inputPermission: {
        ...decoded.snapshot.inputPermission,
        inputKey: Keypair.generate().publicKey,
      },
    };
    const snapshotHash = createHash("sha256")
      .update("purrps:run:v1")
      .update(new PublicKey(DEVNET.program).toBytes())
      .update(coder.types.encode("runSnapshot", snapshot))
      .digest();
    info.data = await coder.accounts.encode("runEscrow", {
      ...decoded,
      snapshot,
      snapshotHash: [...snapshotHash],
    });
    const escrow = await decodeEscrowAccount(
      identity,
      addresses.escrow[0],
      info,
    );
    const base = { getAccountInfo: vi.fn().mockResolvedValue(info) };
    const er = {
      getLatestBlockhash: vi.fn().mockResolvedValue({
        blockhash: PublicKey.default.toBase58(),
        lastValidBlockHeight: 7,
      }),
    };
    rpc.network.mockImplementation(async (network) =>
      network === "base" ? base : er,
    );
    const action = {
      kind: "activateRun",
      nonce: "1",
      delegationEpoch: escrow.delegationEpoch,
      inputKey: escrow.inputKey,
      market: escrow.market,
    };
    const value = intentSchema.parse({
      operation: "game",
      sponsored: false,
      action,
    });
    await expect(prepare(identity.owner, value)).resolves.toMatchObject({
      network: "er",
    });
    expect(rpc.network).toHaveBeenCalledWith("er", escrow.validator);
    expect(base.getAccountInfo).toHaveBeenCalledWith(
      addresses.escrow[0],
      "finalized",
    );
    const wrongKey = intentSchema.parse({
      ...value,
      action: { ...action, inputKey: Keypair.generate().publicKey.toBase58() },
    });
    await expect(prepare(identity.owner, wrongKey)).rejects.toThrow(
      "RUN_SCOPE_MISMATCH",
    );
    expect(er.getLatestBlockhash).toHaveBeenCalledTimes(1);
  });

  it("treats delegated mirrors and missing ER state as pending, then flags a returned terminal", async () => {
    const check = (run: AccountInfo<Buffer> | null) =>
      finalizedRunState(identity.owner, "1", [
        fixture("reserved"),
        run,
        null,
        null,
      ]);
    await expect(check(null)).resolves.toEqual({ status: "recoveryPending" });
    await expect(
      check({ ...fixture("terminal"), owner: DELEGATION_PROGRAM_ID }),
    ).resolves.toEqual({ status: "recoveryPending" });
    await expect(check(fixture("terminal"))).resolves.toEqual({
      status: "settlementReady",
      market: "BTC",
      pending: { grossPayoutBaseUnits: "0", refundBaseUnits: "1" },
    });
    await expect(
      finalizedRunState(identity.owner, "1", [
        fixture("refunded"),
        fixture("terminal"),
        null,
        null,
      ]),
    ).rejects.toThrow("INVALID_CHAIN_ACCOUNT");
  });

  it("uses the finalized Clock boundary for base refunds and matches the retained receipt", async () => {
    const escrowAccount = fixture("reserved");
    const e = coder.accounts.decode<IdlAccounts<DungeonWarriors>["runEscrow"]>(
      "runEscrow",
      escrowAccount.data,
    );
    escrowAccount.data = await coder.accounts.encode("runEscrow", {
      ...e,
      delegationInitiated: false,
    });
    const clock = {
      ...fixture("ready"),
      owner: new PublicKey(DEVNET.sysvarOwner),
      data: Buffer.alloc(40),
    };
    const deadline = BigInt(e.snapshot.activationDeadlineSeconds.toString());
    clock.data.writeBigInt64LE(deadline - 1n, 32);
    const ready = [escrowAccount, fixture("ready"), null, clock];
    await expect(
      finalizedRunState(identity.owner, "1", ready),
    ).resolves.toEqual({ status: "reserved" });
    clock.data.writeBigInt64LE(deadline, 32);
    await expect(
      finalizedRunState(identity.owner, "1", ready),
    ).resolves.toEqual({ status: "refundReady" });

    const terminal = coder.accounts.decode<
      IdlAccounts<DungeonWarriors>["runGameState"]
    >("runGameState", fixture("terminal").data);
    const receipt = {
      ...fixture("refunded"),
      data: await coder.accounts.encode("resultReceipt", {
        schemaVersion: 1,
        bump: addresses.receipt[1],
        run: e.snapshot.run,
        owner: e.snapshot.owner,
        nonce: e.snapshot.nonce,
        market: e.snapshot.market,
        snapshotHash: e.snapshotHash,
        rules: e.snapshot.rulesBinding,
        cat: e.snapshot.cat,
        oracle: e.snapshot.oracle,
        startObservation: null,
        stakeBaseUnits: e.snapshot.stakeBaseUnits,
        terminal: terminal.terminal,
        settledAtSlot: e.snapshot.nonce,
        settledAtSeconds: e.snapshot.activationDeadlineSeconds,
      }),
    };
    await expect(
      finalizedRunState(identity.owner, "1", [
        fixture("refunded"),
        fixture("terminal"),
        receipt,
        null,
      ]),
    ).resolves.toMatchObject({
      status: "refunded",
      receipt: addresses.receipt[0].toBase58(),
      refundBaseUnits: e.snapshot.stakeBaseUnits.toString(),
    });
  });
});
