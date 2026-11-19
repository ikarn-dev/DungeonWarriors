import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { guardRunLayout } from "../../apps/web/lib/game/run-layout.ts";
import { DEVNET, MARKETS } from "../../apps/web/lib/solana/addresses.ts";
import { PURRPS_GAME_IDL } from "../../apps/web/lib/solana/purrps-game.ts";

export const requireWeb = createRequire(
  new URL("../../apps/web/package.json", import.meta.url),
);
const { BN, BorshCoder, convertIdlToCamelCase } =
  requireWeb("@anchor-lang/core");
const {
  DELEGATION_PROGRAM_ID,
  EPHEMERAL_VAULT_ID,
  escrowPdaFromEscrowAuthority,
  MAGIC_CONTEXT_ID,
  MAGIC_PROGRAM_ID,
} = requireWeb("@magicblock-labs/ephemeral-rollups-sdk");
const { PublicKey, SystemProgram, TransactionInstruction } =
  requireWeb("@solana/web3.js");
const { getAssociatedTokenAddressSync } = requireWeb("@solana/spl-token");

const idl = convertIdlToCamelCase(PURRPS_GAME_IDL);
const coder = new BorshCoder(idl);
const program = new PublicKey(DEVNET.program);
const hydra = new PublicKey("eHyd5BU8QffvHi4GnXwxrK4WpS7pM2x9UGKHBWii7mf");
const pda = (seed, ...parts) =>
  PublicKey.findProgramAddressSync([Buffer.from(seed), ...parts], program)[0];
const tag = (value) => Object.keys(value)[0];
const amount = (value) => BigInt(value.toString());

export function check(condition, code) {
  if (!condition) throw new Error(code);
}

export function runScope(ownerValue, nonce) {
  const owner = new PublicKey(ownerValue);
  check(
    owner.toBase58() === ownerValue && PublicKey.isOnCurve(owner.toBytes()),
    "INVALID_OWNER",
  );
  check(
    typeof nonce === "string" && /^(0|[1-9][0-9]{0,19})$/.test(nonce),
    "INVALID_NONCE",
  );
  const n = BigInt(nonce);
  check(n <= 0xffffffffffffffffn, "INVALID_NONCE");
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(n);
  const run = pda("run-game", owner.toBytes(), bytes);
  return {
    nonce,
    owner,
    run,
    budget: pda("sponsor", run.toBytes()),
    runEscrow: pda("run-escrow", owner.toBytes(), bytes),
    receipt: pda("result", owner.toBytes(), bytes),
    actionBalance: escrowPdaFromEscrowAuthority(run, 255),
    player: pda("player", owner.toBytes()),
    config: pda("game-config"),
    policy: pda("sponsor-policy"),
  };
}

function emptySystemAccount(info) {
  return (
    info === null ||
    (!info.executable &&
      info.data.length === 0 &&
      info.owner.equals(SystemProgram.programId))
  );
}

function account(info, name) {
  if (emptySystemAccount(info)) return null;
  check(
    info.owner.equals(program) &&
      !info.executable &&
      info.data.length <= 10_240,
    "INVALID_RUN_ACCOUNT",
  );
  if (name === "runGameState") guardRunLayout(info.data);
  const result = coder.accounts.decode(name, info.data);
  check(result.schemaVersion === 1, "UNSUPPORTED_RUN_SCHEMA");
  return result;
}

function snapshotMatches(snapshot, hash, scope) {
  const actual = createHash("sha256")
    .update("purrps:run:v1")
    .update(program.toBytes())
    .update(coder.types.encode("runSnapshot", snapshot))
    .digest();
  return (
    snapshot.owner.equals(scope.owner) &&
    snapshot.run.equals(scope.run) &&
    snapshot.nonce.toString() === scope.nonce &&
    actual.equals(Buffer.from(hash))
  );
}

function readEscrow(info, scope) {
  const e = account(info, "runEscrow");
  if (e === null) return null;
  const open = tag(e.status) === "reserved";
  check(
    e.gameState.equals(scope.run) &&
      e.sponsorBudget.equals(scope.budget) &&
      snapshotMatches(e.snapshot, e.snapshotHash, scope) &&
      (open ? e.receipt === null : e.receipt?.equals(scope.receipt)),
    "INVALID_ESCROW_SCOPE",
  );
  return e;
}

function readRun(info, escrow, scope) {
  const data = account(info, "runGameState");
  check(
    data !== null &&
      escrow !== null &&
      data.escrow.equals(scope.runEscrow) &&
      snapshotMatches(data.snapshot, data.snapshotHash, scope) &&
      Buffer.from(data.snapshotHash).equals(Buffer.from(escrow.snapshotHash)),
    "INVALID_RUN_SCOPE",
  );
  return data;
}

export async function readBaseRun(rpc, scope) {
  const names = [
    "config",
    "policy",
    "player",
    "budget",
    "runEscrow",
    "run",
    "receipt",
    "actionBalance",
  ];
  const result = await rpc.getMultipleAccountsInfoAndContext(
    [...names.map((name) => scope[name]), new PublicKey(DEVNET.clock)],
    "finalized",
  );
  const [
    configInfo,
    policyInfo,
    playerInfo,
    budgetInfo,
    escrowInfo,
    runInfo,
    receiptInfo,
    balanceInfo,
    clock,
  ] = result.value;
  const config = account(configInfo, "gameConfig");
  const policy = account(policyInfo, "sponsorPolicy");
  const player = account(playerInfo, "playerAccount");
  const budget = account(budgetInfo, "sponsorBudget");
  const escrow = readEscrow(escrowInfo, scope);
  const receipt = account(receiptInfo, "resultReceipt");
  check(
    config !== null && policy?.config.equals(scope.config),
    "SPONSOR_POLICY_UNAVAILABLE",
  );
  check(
    player === null || player.owner.equals(scope.owner),
    "INVALID_PLAYER_SCOPE",
  );
  check(
    budget === null ||
      (budget.operation.equals(scope.run) &&
        budget.beneficiary.equals(scope.owner) &&
        budget.authority.equals(budget.feePayer) &&
        tag(budget.purpose) === "runCompletion"),
    "INVALID_BUDGET_SCOPE",
  );
  const delegated = runInfo?.owner.equals(DELEGATION_PROGRAM_ID) ?? false;
  const run =
    emptySystemAccount(runInfo) || delegated
      ? null
      : readRun(runInfo, escrow, scope);
  const settled = escrow?.receipt != null;
  check(
    settled
      ? receipt?.owner.equals(scope.owner) &&
          receipt.run.equals(scope.run) &&
          receipt.nonce.toString() === scope.nonce &&
          Buffer.from(receipt.snapshotHash).equals(
            Buffer.from(escrow.snapshotHash),
          )
      : receipt === null,
    "INVALID_RECEIPT_SCOPE",
  );
  check(
    balanceInfo === null ||
      (!balanceInfo.executable &&
        balanceInfo.data.length === 0 &&
        balanceInfo.owner.equals(SystemProgram.programId) &&
        Number.isSafeInteger(balanceInfo.lamports)),
    "INVALID_ACTION_BALANCE",
  );
  check(
    clock?.owner.toBase58() === DEVNET.sysvarOwner &&
      clock.data.length === 40 &&
      !clock.executable,
    "INVALID_BASE_CLOCK",
  );
  check(!delegated || escrow?.delegationInitiated, "INVALID_RUN_SCOPE");
  return {
    config,
    policy,
    player,
    budget,
    escrow,
    settled,
    delegated,
    run,
    slot: result.context.slot,
    now: clock.data.readBigInt64LE(32),
    budgetLamports: budgetInfo?.lamports ?? 0,
    budgetSize: budgetInfo?.data.length ?? 0,
    actionLamports: balanceInfo?.lamports ?? 0,
  };
}

export function statusFor(state) {
  const { budget, escrow, run } = state;
  if (state.settled) return tag(escrow.status);
  if (terminalRun(run)) return "settlement-ready";
  if (escrow !== null)
    return escrow.delegationInitiated ? "recovery-pending" : "reserved";
  if (budget === null) return "unfunded";
  return amount(budget.expiresAtSeconds) <= state.now
    ? "budget-expired"
    : "provisioned";
}

function terminalRun(run) {
  return (
    run?.terminal != null &&
    ["terminalRecorded", "completionRequested"].includes(tag(run.phase))
  );
}

function instruction(name, keys, args = {}) {
  const definition = idl.instructions.find((item) => item.name === name);
  check(definition !== undefined, "SPONSOR_INSTRUCTION_MISSING");
  return new TransactionInstruction({
    programId: program,
    keys: accountMetas(definition.accounts, keys),
    data: coder.instruction.encode(name, args),
  });
}

function accountMetas(accounts, keys) {
  return accounts.flatMap((account) => {
    if (account.accounts) return accountMetas(account.accounts, keys);
    const pubkey = keys[account.name];
    check(pubkey instanceof PublicKey, "INVALID_SPONSOR_ACCOUNT_LAYOUT");
    return [
      {
        pubkey,
        isSigner: account.signer === true,
        isWritable: account.writable === true,
      },
    ];
  });
}

export function provisionPlan(scope, state, settings) {
  if (state.escrow !== null) return null;
  check(
    state.config.allowReservations && !state.policy.paused,
    "RUN_SPONSORSHIP_PAUSED",
  );
  check(
    state.player?.nextRunNonce.toString() === scope.nonce,
    "RUN_NONCE_NOT_CURRENT",
  );
  const reserve = settings.SPONSOR_COMPLETION_RESERVE_LAMPORTS;
  const attempts = Math.min(
    state.policy.maxAttempts,
    settings.SPONSOR_MAX_ATTEMPTS,
  );
  check(
    reserve >= amount(state.policy.minCompletionLamports) &&
      reserve <= amount(state.policy.maxOperationLamports) &&
      attempts > 0,
    "SPONSOR_POLICY_CAP_MISMATCH",
  );
  const payer = new PublicKey(settings.SPONSOR_PUBLIC_KEY);
  check(state.policy.authority.equals(payer), "SPONSOR_AUTHORITY_MISMATCH");
  const expires = state.now + 3600n;
  if (state.budget !== null) {
    check(
      amount(state.budget.expiresAtSeconds) >= state.now + 300n,
      "BUDGET_EXPIRED_OR_TOO_CLOSE",
    );
    check(
      state.budget.authority.equals(payer) &&
        amount(state.budget.reservedCompletionLamports) >= reserve &&
        amount(state.budget.limitLamports) <=
          amount(state.policy.maxOperationLamports) &&
        amount(state.budget.spentLamports) === 0n &&
        state.budget.maxAttempts <= state.policy.maxAttempts &&
        state.budget.maxAttempts > 0,
      "EXISTING_BUDGET_MISMATCH",
    );
    return null;
  }
  return {
    payer,
    instruction: instruction(
      "fundSponsorship",
      { ...scope, funder: payer, systemProgram: SystemProgram.programId },
      {
        args: {
          operation: scope.run,
          beneficiary: scope.owner,
          purpose: { runCompletion: {} },
          limitLamports: new BN(reserve.toString()),
          reservedCompletionLamports: new BN(reserve.toString()),
          maxAttempts: attempts,
          expiresAtSeconds: new BN(expires.toString()),
        },
      },
    ),
    reserve,
    expires,
    space: coder.accounts.size("sponsorBudget"),
  };
}

export function existingBudgetPlan(command, scope, state, erInfo = null) {
  const { budget, escrow } = state;
  if (command === "reclaim" && budget === null) return null;
  if ((command === "settle" || command === "retry") && state.settled)
    return null;
  check(budget !== null, "RUN_BUDGET_UNAVAILABLE");
  const payer = budget.authority;
  const keys = {
    ...scope,
    payer,
    sponsor: payer,
    delegationProgram: DELEGATION_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  };
  const build = (name, args = {}) => ({
    payer,
    instruction: instruction(name, keys, args),
  });
  if (command === "fund-completion") {
    check(escrow !== null, "RUN_ESCROW_UNAVAILABLE");
    if (
      state.settled ||
      terminalRun(state.run) ||
      amount(budget.spentLamports) !== 0n
    )
      return null;
    return build("fundRunCompletion");
  }
  if (command === "reclaim") {
    if (escrow === null) {
      check(
        state.now >= amount(budget.expiresAtSeconds),
        "RUN_BUDGET_STILL_VALID",
      );
      return build("reclaimExpiredRunBudget", { nonce: new BN(scope.nonce) });
    }
    check(state.settled && state.run !== null, "RUN_SETTLEMENT_PENDING");
    return build("reclaimCompletionBalance");
  }
  if (command === "settle") {
    check(
      escrow?.delegationInitiated && terminalRun(state.run),
      "RUN_SETTLEMENT_PENDING",
    );
    const house = pda("house");
    Object.assign(keys, {
      escrow: scope.runEscrow,
      house,
      vault: getAssociatedTokenAddressSync(
        new PublicKey(DEVNET.usdcMint),
        house,
        true,
      ),
      leaderboard: leaderboard(escrow),
    });
    return build("settleReturnedRun");
  }
  check(command === "retry", "INVALID_SPONSOR_COMMAND");
  if (state.settled || terminalRun(state.run)) return null;
  check(state.delegated && erInfo !== null, "RUN_RECOVERY_PENDING");
  const run = readRun(erInfo, escrow, scope);
  check(terminalRun(run), "RUN_TERMINAL_PENDING");
  const expectedAttempt = run.crank.completionAttempts;
  check(expectedAttempt < budget.maxAttempts, "COMPLETION_ATTEMPTS_EXHAUSTED");
  const seed = createHash("sha256")
    .update("purrps:crank:v1")
    .update(scope.run.toBytes())
    .digest();
  const crank = PublicKey.findProgramAddressSync(
    [Buffer.from("crank"), scope.run.toBytes(), seed],
    hydra,
  )[0];
  check(
    run.crank.cancelAuthority.equals(scope.run) &&
      (run.crank.task.equals(PublicKey.default) ||
        run.crank.task.equals(crank)),
    "INVALID_HYDRA_TASK",
  );
  Object.assign(keys, {
    leaderboard: leaderboard(escrow),
    magicContext: MAGIC_CONTEXT_ID,
    magicProgram: MAGIC_PROGRAM_ID,
    crank,
    rentVault: EPHEMERAL_VAULT_ID,
    hydraProgram: hydra,
  });
  return {
    ...build("requestCompletion", { expectedAttempt }),
    expectedAttempt,
  };
}

function leaderboard(escrow) {
  const market = MARKETS.findIndex(
    (entry) => entry.market.toLowerCase() === tag(escrow.snapshot.market),
  );
  check(market >= 0, "INVALID_RUN_MARKET");
  return pda("leaderboard", Buffer.from([market]));
}
