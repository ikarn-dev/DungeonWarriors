import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  DEVNET,
  LEADERBOARD_SEED,
} from "../../../apps/web/lib/solana/addresses.ts";
import { PURRPS_GAME_IDL } from "../../../apps/web/lib/solana/purrps-game.ts";
import { execute } from "../../../scripts/program/run-sponsor.mjs";
import {
  existingBudgetPlan,
  provisionPlan,
  readErProgress,
  requireWeb,
  runScope,
  statusFor,
} from "../../../scripts/program/run-sponsor-state.mjs";

const { BN, BorshCoder, convertIdlToCamelCase } =
  requireWeb("@anchor-lang/core");
const { Keypair, PublicKey } = requireWeb("@solana/web3.js");
const coder = new BorshCoder(convertIdlToCamelCase(PURRPS_GAME_IDL));
const owner = Keypair.generate().publicKey;
const sponsor = Keypair.generate();
const scope = runScope(owner.toBase58(), "9007199254740993");
const settings = {
  SPONSOR_PUBLIC_KEY: sponsor.publicKey.toBase58(),
  SPONSOR_COMPLETION_RESERVE_LAMPORTS: 50_000_000n,
  SPONSOR_MAX_ATTEMPTS: 3,
};
const now = 1_700_000_000n;

function initial() {
  return {
    config: { allowReservations: true },
    policy: {
      paused: false,
      authority: sponsor.publicKey,
      maxOperationLamports: new BN(100_000_000),
      minCompletionLamports: new BN(50_000_000),
      maxAttempts: 2,
    },
    now,
    player: { nextRunNonce: new BN(scope.nonce) },
    escrow: null,
    budget: null,
    run: null,
    settled: false,
    delegated: false,
  };
}

function budget(expires = now + 3600n) {
  return {
    expiresAtSeconds: new BN(expires.toString()),
    authority: sponsor.publicKey,
    maxAttempts: 2,
    limitLamports: new BN(50_000_000),
    reservedCompletionLamports: new BN(50_000_000),
    spentLamports: new BN(0),
  };
}

test("provision plans only one current canonical run within the active sponsor policy", () => {
  const state = initial();
  const plan = provisionPlan(scope, state, settings);
  const {
    name,
    data: { args },
  } = coder.instruction.decode(plan.instruction.data);
  assert.equal(name, "fundSponsorship");
  assert.equal(args.operation.toBase58(), scope.run.toBase58());
  assert.equal(args.beneficiary.toBase58(), owner.toBase58());
  assert.equal(plan.payer.toBase58(), sponsor.publicKey.toBase58());
  assert.equal(args.limitLamports.toString(), "50000000");
  assert.equal(args.reservedCompletionLamports.toString(), "50000000");
  assert.equal(args.maxAttempts, 2);
  assert.equal(args.expiresAtSeconds.toString(), (now + 3600n).toString());
  assert.equal(
    provisionPlan(scope, { ...state, budget: budget() }, settings),
    null,
  );
  assert.throws(
    () =>
      provisionPlan(
        scope,
        { ...state, config: { allowReservations: false } },
        settings,
      ),
    /RUN_SPONSORSHIP_PAUSED/,
  );
  assert.throws(
    () => provisionPlan(runScope(owner.toBase58(), "7"), state, settings),
    /RUN_NONCE_NOT_CURRENT/,
  );
  assert.throws(
    () =>
      provisionPlan(scope, { ...state, budget: budget(now + 299n) }, settings),
    /BUDGET_EXPIRED_OR_TOO_CLOSE/,
  );
  assert.throws(
    () =>
      provisionPlan(scope, state, {
        ...settings,
        SPONSOR_COMPLETION_RESERVE_LAMPORTS: 100_000_001n,
      }),
    /SPONSOR_POLICY_CAP_MISMATCH/,
  );
});

test("reclaim distinguishes expired unused funds from an open run or a proved receipt", () => {
  const state = { ...initial(), budget: budget(now) };
  assert.equal(statusFor(state), "budget-expired");
  const plan = existingBudgetPlan("reclaim", scope, state);
  assert.equal(
    coder.instruction.decode(plan.instruction.data).name,
    "reclaimExpiredRunBudget",
  );
  assert.equal(
    coder.instruction.decode(plan.instruction.data).data.nonce.toString(),
    scope.nonce,
  );
  assert.deepEqual(
    plan.instruction.keys.map(({ pubkey }) => pubkey.toBase58()),
    [scope.budget, sponsor.publicKey, scope.run, scope.runEscrow].map((key) =>
      key.toBase58(),
    ),
  );
  const open = {
    ...state,
    escrow: { delegationInitiated: false },
    budget: budget(),
  };
  assert.equal(
    coder.instruction.decode(
      existingBudgetPlan("fund-completion", scope, open).instruction.data,
    ).name,
    "fundRunCompletion",
  );
  assert.equal(
    existingBudgetPlan("fund-completion", scope, {
      ...open,
      budget: { ...open.budget, spentLamports: new BN(50_000_000) },
    }),
    null,
  );
  assert.throws(
    () => existingBudgetPlan("reclaim", scope, open),
    /RUN_SETTLEMENT_PENDING/,
  );
  assert.equal(
    coder.instruction.decode(
      existingBudgetPlan("reclaim", scope, { ...open, settled: true, run: {} })
        .instruction.data,
    ).name,
    "reclaimCompletionBalance",
  );
});

test("completion retry uses the terminal's own attempt and stops when it returns or exhausts", async () => {
  const path = new URL(
    "../../fixtures/run-delivery/terminal.hex",
    import.meta.url,
  );
  const fixture = Buffer.from(readFileSync(path, "utf8").trim(), "hex");
  const original = coder.accounts.decode("runGameState", fixture);
  const scope = runScope(
    original.snapshot.owner.toBase58(),
    original.snapshot.nonce.toString(),
  );
  const program = new PublicKey(PURRPS_GAME_IDL.address);
  const crankOffset = fixture.indexOf(
    coder.types.encode("crankState", original.crank),
  );
  assert.ok(crankOffset > 0);
  const hydra = new PublicKey("eHyd5BU8QffvHi4GnXwxrK4WpS7pM2x9UGKHBWii7mf");
  const seed = createHash("sha256")
    .update("purrps:crank:v1")
    .update(scope.run.toBytes())
    .digest();
  const crank = PublicKey.findProgramAddressSync(
    [Buffer.from("crank"), scope.run.toBytes(), seed],
    hydra,
  )[0];
  const info = (attempt) => {
    const data = Buffer.from(fixture);
    coder.types
      .encode("crankState", {
        ...original.crank,
        task: crank,
        cancelAuthority: scope.run,
        completionAttempts: attempt,
      })
      .copy(data, crankOffset);
    assert.equal(
      coder.accounts.decode("runGameState", data).crank.completionAttempts,
      attempt,
    );
    return { owner: program, data, executable: false };
  };
  const state = {
    ...initial(),
    budget: budget(),
    escrow: {
      snapshot: original.snapshot,
      snapshotHash: original.snapshotHash,
      delegationInitiated: true,
    },
    delegated: true,
  };
  const plan = existingBudgetPlan("retry", scope, state, info(1));
  const clock = {
    owner: new PublicKey(DEVNET.sysvarOwner),
    data: Buffer.alloc(40),
    executable: false,
  };
  clock.data.writeBigInt64LE(1_700_000_002n, 32);
  const rpc = {
    async getMultipleAccountsInfoAndContext(addresses, commitment) {
      assert.equal(commitment, "confirmed");
      assert.ok(addresses[0].equals(scope.run));
      assert.ok(addresses[1].equals(new PublicKey(DEVNET.clock)));
      return { context: { slot: 200 }, value: [info(1), clock] };
    },
  };
  const progress = await readErProgress(rpc, scope, state.escrow);
  assert.equal(progress.slot, 200);
  assert.equal(progress.network, "er");
  assert.equal(progress.completionAttempts, 1);
  assert.equal(progress.activeTicks, original.activeTicks.toString());
  await assert.rejects(
    readErProgress(rpc, scope, {
      ...state.escrow,
      snapshotHash: Buffer.alloc(32),
    }),
    /INVALID_RUN_SCOPE/,
  );
  assert.equal(plan.expectedAttempt, 1);
  assert.ok(plan.instruction.keys.some(({ pubkey }) => pubkey.equals(crank)));
  assert.equal(
    coder.instruction.decode(plan.instruction.data).data.expectedAttempt,
    1,
  );
  assert.equal(
    existingBudgetPlan("retry", scope, { ...state, run: original }),
    null,
  );
  assert.equal(statusFor({ ...state, run: original }), "settlement-ready");
  const settle = existingBudgetPlan("settle", scope, {
    ...state,
    run: original,
  });
  const [leaderboard] = PublicKey.findProgramAddressSync(
    [Buffer.from(LEADERBOARD_SEED)],
    new PublicKey(DEVNET.program),
  );
  assert.equal(
    plan.instruction.keys.find(({ pubkey }) => pubkey.equals(leaderboard))
      ?.isWritable,
    false,
  );
  assert.equal(
    settle.instruction.keys.find(({ pubkey }) => pubkey.equals(leaderboard))
      ?.isWritable,
    true,
  );
  assert.equal(
    coder.instruction.decode(settle.instruction.data).name,
    "settleReturnedRun",
  );
  assert.ok(
    settle.instruction.keys.some(({ pubkey }) => pubkey.equals(scope.receipt)),
  );
  assert.throws(
    () => existingBudgetPlan("retry", scope, state, info(2)),
    /COMPLETION_ATTEMPTS_EXHAUSTED/,
  );
  assert.throws(
    () => existingBudgetPlan("retry", scope, state),
    /RUN_RECOVERY_PENDING/,
  );
});

test("preview simulates without a signer and an ambiguous send preserves the original signature", async () => {
  const plan = existingBudgetPlan("reclaim", scope, {
    ...initial(),
    budget: budget(now),
  });
  const mockedRpc = {
    getLatestBlockhash: async () => ({
      blockhash: PublicKey.default.toBase58(),
      lastValidBlockHeight: 1,
    }),
    simulateTransaction: async (tx, { sigVerify }) => {
      assert.equal(tx.signatures[0].some(Boolean), sigVerify);
      return { value: { err: null, unitsConsumed: 234 } };
    },
    sendRawTransaction: async () => {
      sent += 1;
      throw new Error("transport lost response");
    },
  };
  let sent = 0;
  assert.deepEqual(await execute(plan, "base", mockedRpc, false, {}), {
    network: "base",
    result: "simulated",
    computeUnits: 234,
  });
  assert.equal(sent, 0);
  await assert.rejects(
    execute(plan, "base", mockedRpc, true, {}),
    /SPONSOR_SIGNER_REQUIRED/,
  );
  const env = {
    SPONSOR_SECRET_KEY: Buffer.from(sponsor.secretKey).toString("base64"),
  };
  const result = await execute(plan, "base", mockedRpc, true, env);
  assert.equal(result.result, "submission-unknown");
  assert.match(result.signature, /^[1-9A-HJ-NP-Za-km-z]{64,88}$/);
  assert.equal(sent, 1);
});

test("provision accounts for chain rent and fees before spending the sponsor balance floor", async () => {
  const plan = provisionPlan(scope, initial(), settings);
  let balance = 1_051_004_999;
  const rpc = {
    getLatestBlockhash: async () => ({
      blockhash: PublicKey.default.toBase58(),
      lastValidBlockHeight: 1,
    }),
    getMinimumBalanceForRentExemption: async (space) => {
      assert.equal(space, coder.accounts.size("sponsorBudget"));
      return 1_000_000;
    },
    getBalance: async () => balance,
    getFeeForMessage: async () => ({ value: 5000 }),
    simulateTransaction: async () => ({
      value: { err: null, unitsConsumed: 100 },
    }),
  };
  const env = {
    SPONSOR_PUBLIC_KEY: sponsor.publicKey.toBase58(),
    SPONSOR_MIN_BALANCE_LAMPORTS: "1000000000",
    SPONSOR_OPERATION_LIMIT_LAMPORTS: "100000000",
    SPONSOR_COMPLETION_RESERVE_LAMPORTS: "50000000",
    SPONSOR_MAX_ATTEMPTS: "3",
  };
  await assert.rejects(
    execute(plan, "base", rpc, false, env),
    /SPONSOR_BALANCE_FLOOR/,
  );
  balance += 1;
  assert.equal(
    (await execute(plan, "base", rpc, false, env)).result,
    "simulated",
  );
});
