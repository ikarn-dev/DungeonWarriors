import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  erConfigSchema,
  rpcConfigSchema,
  sponsorConfigSchema,
} from "../../apps/web/lib/providers/config.ts";
import { DEVNET } from "../../apps/web/lib/solana/addresses.ts";
import {
  check,
  existingBudgetPlan,
  provisionPlan,
  readBaseRun,
  requireWeb,
  runScope,
  statusFor,
} from "./run-sponsor-state.mjs";

const { utils } = requireWeb("@anchor-lang/core");
const {
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} = requireWeb("@solana/web3.js");
const actions = [
  "status",
  "provision",
  "fund-completion",
  "retry",
  "settle",
  "reclaim",
];

const timedFetch = (url, init) =>
  fetch(url, {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(8000),
  });
const rpc = (url, commitment) =>
  new Connection(url, {
    commitment,
    disableRetryOnRateLimit: true,
    fetch: timedFetch,
  });

async function rollup(validator, env) {
  const settings = erConfigSchema.parse(env);
  const url = settings.MAGICBLOCK_ER_HTTP_URL;
  check(
    validator?.equals(new PublicKey(settings.MAGICBLOCK_VALIDATOR_IDENTITY)),
    "ER_VALIDATOR_MISMATCH",
  );
  const response = await timedFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getIdentity" }),
  });
  check(response.ok, "ER_UNAVAILABLE");
  const data = await response.json();
  check(
    data.result?.identity === validator.toBase58(),
    "ER_VALIDATOR_MISMATCH",
  );
  return rpc(url, "confirmed");
}

function signerFor(payer, env) {
  const raw = env.SPONSOR_SECRET_KEY;
  check(typeof raw === "string", "SPONSOR_SIGNER_REQUIRED");
  const bytes = Buffer.from(raw, "base64");
  check(
    bytes.length === 64 && bytes.toString("base64") === raw,
    "INVALID_SPONSOR_SIGNER",
  );
  let key;
  try {
    key = Keypair.fromSecretKey(bytes);
  } catch {
    throw new Error("INVALID_SPONSOR_SIGNER");
  }
  check(key.publicKey.equals(payer), "SPONSOR_AUTHORITY_MISMATCH");
  return key;
}

export async function execute(plan, network, chain, send, env) {
  const commitment = network === "base" ? "finalized" : "confirmed";
  const block = await chain.getLatestBlockhash(commitment);
  const tx = new VersionedTransaction(
    new TransactionMessage({
      payerKey: plan.payer,
      recentBlockhash: block.blockhash,
      instructions: [plan.instruction],
    }).compileToV0Message(),
  );
  if (plan.reserve !== undefined) {
    const { SPONSOR_MIN_BALANCE_LAMPORTS: floor } =
      sponsorConfigSchema.parse(env);
    const [rent, balance, fee] = await Promise.all([
      chain.getMinimumBalanceForRentExemption(plan.space, commitment),
      chain.getBalance(plan.payer, commitment),
      chain.getFeeForMessage(tx.message, commitment),
    ]);
    check(
      [rent, balance, fee.value].every(
        (value) => Number.isSafeInteger(value) && value >= 0,
      ),
      "INVALID_SPONSOR_BALANCE",
    );
    check(
      BigInt(balance) - BigInt(rent) - BigInt(fee.value) - plan.reserve >=
        floor,
      "SPONSOR_BALANCE_FLOOR",
    );
  }
  if (send) tx.sign([signerFor(plan.payer, env)]);
  const simulation = await chain.simulateTransaction(tx, {
    commitment,
    sigVerify: send,
  });
  check(simulation.value.err === null, "SPONSOR_SIMULATION_REJECTED");
  const result = { network, computeUnits: simulation.value.unitsConsumed };
  if (!send) return { ...result, result: "simulated" };
  const signature = utils.bytes.bs58.encode(tx.signatures[0]);
  try {
    const accepted = await chain.sendRawTransaction(tx.serialize(), {
      preflightCommitment: commitment,
      maxRetries: 0,
    });
    return {
      ...result,
      result: accepted === signature ? "submitted" : "submission-unknown",
      signature,
    };
  } catch {
    return { ...result, result: "submission-unknown", signature };
  }
}

async function assertPriorSignature(rpc, signature) {
  check(
    /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature) &&
      utils.bytes.bs58.decode(signature).length === 64,
    "INVALID_PRIOR_SIGNATURE",
  );
  const result = await rpc.getSignatureStatuses([signature], {
    searchTransactionHistory: true,
  });
  const status = result.value[0];
  check(
    status?.confirmationStatus === "finalized",
    "PRIOR_COMPLETION_UNRESOLVED",
  );
}

async function operate(command, scope, base, state, values, env) {
  let chain = base;
  let network = "base";
  let plan;
  if (command === "provision") {
    const settings = sponsorConfigSchema.parse(env);
    plan = provisionPlan(scope, state, settings);
  } else {
    if (
      command === "retry" &&
      !state.settled &&
      statusFor(state) !== "settlement-ready"
    ) {
      check(state.delegated, "RUN_RECOVERY_PENDING");
      chain = await rollup(state.escrow?.snapshot.oracle.validator, env);
      network = "er";
      if (values["prior-signature"] !== undefined)
        await assertPriorSignature(chain, values["prior-signature"]);
    }
    const info =
      network === "er"
        ? await chain.getAccountInfo(scope.run, "confirmed")
        : null;
    plan = existingBudgetPlan(command, scope, state, info);
    if (
      command === "reclaim" &&
      state.settled &&
      state.actionLamports === 0 &&
      plan !== null
    ) {
      const rent = await base.getMinimumBalanceForRentExemption(
        state.budgetSize,
        "finalized",
      );
      if (state.budgetLamports <= rent) plan = null;
    }
  }
  if (plan === null) return { network, result: "no-change" };
  const result = await execute(plan, network, chain, values.send ?? false, env);
  return {
    ...result,
    ...(plan.expectedAttempt === undefined
      ? {}
      : { expectedAttempt: plan.expectedAttempt }),
    ...(plan.reserve === undefined
      ? {}
      : {
          reservedLamports: plan.reserve.toString(),
          expiresAtSeconds: plan.expires.toString(),
        }),
  };
}

export async function main(args, env) {
  const { positionals, values } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      send: { type: "boolean" },
      "prior-signature": { type: "string" },
    },
  });
  const [command, owner, nonce] = positionals;
  check(
    actions.includes(command) &&
      positionals.length === 3 &&
      (command === "retry" || values["prior-signature"] === undefined) &&
      (command !== "status" || values.send !== true),
    "INVALID_SPONSOR_COMMAND",
  );
  const scope = runScope(owner, nonce);
  const { HELIUS_DEVNET_RPC_URL } = rpcConfigSchema.parse(env);
  const base = rpc(HELIUS_DEVNET_RPC_URL, "finalized");
  check((await base.getGenesisHash()) === DEVNET.genesisHash, "WRONG_NETWORK");
  const state = await readBaseRun(base, scope);
  const summary = {
    command,
    run: scope.run.toBase58(),
    nonce,
    slot: state.slot,
    status: statusFor(state),
    admissionOpen: state.config.allowReservations && !state.policy.paused,
    budgetLamports: state.budgetLamports,
    actionLamports: state.actionLamports,
    maxAttempts: state.budget?.maxAttempts ?? null,
  };
  return command === "status"
    ? summary
    : {
        ...summary,
        ...(await operate(command, scope, base, state, values, env)),
      };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const result = await main(process.argv.slice(2), process.env);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.result === "submission-unknown") process.exitCode = 2;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const code = /^[A-Z][A-Z_]{3,63}$/.test(message)
      ? message
      : "SPONSOR_COMMAND_FAILED";
    process.stderr.write(`${JSON.stringify({ error: code })}\n`);
    process.exitCode = 1;
  }
}
