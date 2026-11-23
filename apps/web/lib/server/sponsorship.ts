import "server-only";
import { BN, type IdlAccounts, utils } from "@anchor-lang/core";
import {
  DELEGATION_PROGRAM_ID,
  escrowPdaFromEscrowAuthority,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import {
  type Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  type TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { enumTag, runAddresses } from "../game/run-accounts";
import {
  type CompletionOffer,
  sessionToken,
  sessionTokenSpace,
} from "../game/run-transactions";
import { DEVNET } from "../solana/addresses";
import type { PurrpsGame } from "../solana/purrps-game";
import { account, coder, pda, program, u64Input } from "./chain";
import {
  type GameIntent,
  gameInstructions,
  gameNetwork,
  programInstruction,
} from "./game-transactions";
import { ApiError, runtime, sponsorshipConfig } from "./runtime";
import { observeSponsorReservation } from "./telemetry";
import { checkedConnection } from "./transaction-network";

export function checkSponsorHeadroom(
  balance: number,
  floor: bigint,
  cost: bigint,
) {
  if (!Number.isSafeInteger(balance) || balance < 0)
    throw new ApiError("INVALID_CHAIN_AMOUNT", 502);
  if (BigInt(balance) - cost < floor)
    throw new ApiError("SPONSOR_BUDGET_UNAVAILABLE", 503);
}

export async function runSponsorCost(
  rpc: Connection,
  funding: CompletionOffer,
) {
  const [rent, balance] = await Promise.all([
    rpc.getMinimumBalanceForRentExemption(
      coder.accounts.size("sponsorBudget"),
      "confirmed",
    ),
    rpc.getBalance(new PublicKey(funding.sponsor), "confirmed"),
  ]);
  if (!Number.isSafeInteger(rent) || rent < 0)
    throw new ApiError("INVALID_CHAIN_AMOUNT", 502);
  const cost = BigInt(rent) + BigInt(funding.lamports);
  if (cost > sponsorshipConfig().SPONSOR_OPERATION_LIMIT_LAMPORTS)
    throw new ApiError("SPONSOR_BUDGET_UNAVAILABLE", 503);
  checkSponsorHeadroom(balance, BigInt(funding.floor), cost);
  return cost;
}

function sponsorKey() {
  const { SPONSOR_SECRET_KEY: value } = process.env;
  if (value === undefined) throw new ApiError("SPONSOR_NOT_CONFIGURED", 503);
  let key: Keypair;
  try {
    const bytes = Buffer.from(value, "base64");
    if (bytes.length !== 64 || bytes.toString("base64") !== value)
      throw new Error();
    key = Keypair.fromSecretKey(bytes);
  } catch {
    throw new ApiError("SPONSOR_NOT_CONFIGURED", 503);
  }
  if (key.publicKey.toBase58() !== sponsorshipConfig().SPONSOR_PUBLIC_KEY)
    throw new ApiError("SPONSOR_KEY_MISMATCH", 503);
  return key;
}
const chargeBudget = `local n=tonumber(redis.call('GET',KEYS[1]) or '0'); local spent=tonumber(redis.call('GET',KEYS[2]) or '0'); if KEYS[3] and redis.call('EXISTS',KEYS[3]) == 1 then return 2 end; if n>=tonumber(ARGV[1]) or spent+tonumber(ARGV[2])>tonumber(ARGV[3]) then return 0 end; redis.call('INCR',KEYS[1]); redis.call('EXPIRE',KEYS[1],3600); redis.call('INCRBY',KEYS[2],ARGV[2]); redis.call('EXPIRE',KEYS[2],3600); if KEYS[3] then redis.call('SET',KEYS[3],'1','EX',3600) end; return 1`;
export async function admitSponsorCost(
  operation: string,
  cost: bigint,
  signature?: string,
) {
  const policy = sponsorshipConfig();
  if (cost > policy.SPONSOR_OPERATION_LIMIT_LAMPORTS)
    throw new ApiError("SPONSOR_BUDGET_UNAVAILABLE", 503);
  const { SPONSOR_HOURLY_BUDGET_LAMPORTS: hourly } = process.env;
  if (
    hourly === undefined ||
    !u64Input.safeParse(hourly).success ||
    BigInt(hourly) === 0n ||
    BigInt(hourly) > BigInt(Number.MAX_SAFE_INTEGER)
  )
    throw new ApiError("SPONSOR_NOT_CONFIGURED", 503);
  const r = runtime();
  const admitted = await r.redis.eval(
    chargeBudget,
    [
      `${r.prefix}:sponsor:attempt:${operation}`,
      `${r.prefix}:sponsor:cost:${Math.floor(Date.now() / 3600000)}`,
      ...(signature ? [`${r.prefix}:sponsor:signature:${signature}`] : []),
    ],
    [policy.SPONSOR_MAX_ATTEMPTS, cost.toString(), hourly],
  );
  if (admitted === 2) return;
  if (admitted !== 1) throw new ApiError("SPONSOR_LIMITED", 429);
  observeSponsorReservation(cost);
}

export async function dedicatedSponsor(rpc: Connection) {
  const key = sponsorKey();
  const loaderProgram = new PublicKey(
    "BPFLoaderUpgradeab1e11111111111111111111111",
  );
  const loader = PublicKey.findProgramAddressSync(
    [program.toBytes()],
    loaderProgram,
  )[0];
  const programData = await rpc.getAccountInfo(loader, {
    commitment: "finalized",
    dataSlice: { offset: 0, length: 45 },
  });
  if (
    programData === null ||
    programData.data.length < 45 ||
    programData.data.readUInt32LE(0) !== 3 ||
    programData.data[12] !== 1 ||
    !programData.owner.equals(loaderProgram)
  )
    throw new ApiError("INVALID_UPGRADE_AUTHORITY", 503);
  if (new PublicKey(programData.data.subarray(13, 45)).equals(key.publicKey))
    throw new ApiError("UPGRADE_KEY_CANNOT_SPONSOR", 503);
  return key;
}

type Accounts = IdlAccounts<PurrpsGame>;
type Reserve = Extract<GameIntent["action"], { kind: "reserveRun" }>;

export async function playSessionRent(
  rpc: Connection,
  owner: PublicKey,
  key: PublicKey,
  nonce: string,
) {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(BigInt(nonce));
  const [states, tokenRent, authorizationRent] = await Promise.all([
    rpc.getMultipleAccountsInfo(
      [sessionToken(owner, key), pda("session", owner.toBytes(), bytes)],
      "confirmed",
    ),
    rpc.getMinimumBalanceForRentExemption(sessionTokenSpace, "confirmed"),
    rpc.getMinimumBalanceForRentExemption(
      coder.accounts.size("sessionAuthorization"),
      "confirmed",
    ),
  ]);
  const rent = (minimum: number, balance: number) => {
    if (![minimum, balance].every((n) => Number.isSafeInteger(n) && n >= 0))
      throw new ApiError("INVALID_CHAIN_AMOUNT", 502);
    return String(Math.max(0, minimum - balance));
  };
  return {
    token: rent(tokenRent, states[0]?.lamports ?? 0),
    authorization: rent(authorizationRent, states[1]?.lamports ?? 0),
  };
}

export async function checkPlaySpend(
  rpc: Connection,
  tx: VersionedTransaction,
  sponsor: PublicKey,
  network: "base" | "er",
  verify: boolean,
) {
  const balance =
    network === "base"
      ? await rpc.getBalanceAndContext(sponsor, "confirmed")
      : null;
  const preview = await rpc.simulateTransaction(tx, {
    sigVerify: verify,
    commitment: "confirmed",
    ...(balance
      ? {
          minContextSlot: balance.context.slot,
          accounts: {
            encoding: "base64" as const,
            addresses: [sponsor.toBase58()],
          },
        }
      : {}),
  });
  if (preview.value.err === "BlockhashNotFound")
    throw new ApiError("BLOCKHASH_EXPIRED", 409);
  if (preview.value.err !== null)
    throw new ApiError("SIMULATION_REJECTED", 409);
  if (!balance) return 0n;
  const current = await rpc.getBalance(sponsor, {
    commitment: "confirmed",
    minContextSlot: preview.context.slot,
  });
  if (balance.value !== current) throw new ApiError("RUN_BUDGET_CHANGED", 409);
  const after = preview.value.accounts?.[0]?.lamports;
  if (
    after === undefined ||
    ![balance.value, after].every((n) => Number.isSafeInteger(n) && n >= 0) ||
    after > balance.value
  )
    throw new ApiError("INVALID_CHAIN_AMOUNT", 502);
  const policy = sponsorshipConfig();
  const cost = BigInt(balance.value - after);
  checkSponsorHeadroom(
    balance.value,
    policy.SPONSOR_MIN_BALANCE_LAMPORTS,
    cost,
  );
  if (cost > policy.SPONSOR_OPERATION_LIMIT_LAMPORTS)
    throw new ApiError("SPONSOR_BUDGET_UNAVAILABLE", 503);
  return cost;
}

// Return SOL left by the previous settled run, or close an unused legacy budget.
export async function recycleRunBudget(
  rpc: Connection,
  wallet: string,
  action: Reserve,
) {
  const funding = action.completionFunding;
  if (!funding) return;
  const owner = new PublicKey(wallet);
  const sponsor = new PublicKey(funding.sponsor);
  const nonce = BigInt(action.nonce);
  const addresses = runAddresses({ owner: wallet, nonce });
  const previous =
    nonce === 0n
      ? undefined
      : runAddresses({ owner: wallet, nonce: nonce - 1n });
  const run = addresses.run[0];
  const budgetAddress = pda("sponsor", run.toBytes());
  const current = [
    pda("player", owner.toBytes()),
    budgetAddress,
    new PublicKey(DEVNET.clock),
  ];
  const priorBudget = previous && pda("sponsor", previous.run[0].toBytes());
  const actionBalance =
    previous && escrowPdaFromEscrowAuthority(previous.run[0], 255);
  const [playerInfo, budgetInfo, clock, priorInfo, receipt, refund] =
    await rpc.getMultipleAccountsInfo(
      previous && priorBudget && actionBalance
        ? [...current, priorBudget, previous.receipt[0], actionBalance]
        : current,
      "confirmed",
    );
  const player = account<Accounts["playerAccount"]>(
    "playerAccount",
    playerInfo ?? null,
  );
  if (
    !player?.owner.equals(owner) ||
    player.schemaVersion !== 1 ||
    player.nextRunNonce.toString() !== action.nonce ||
    !player.nextRunNonce.eq(player.settledRuns)
  )
    throw new ApiError("RUN_SCOPE_MISMATCH", 409);
  const instructions: TransactionInstruction[] = [];
  if (budgetInfo?.owner.equals(program)) {
    const budget = account<Accounts["sponsorBudget"]>(
      "sponsorBudget",
      budgetInfo,
    );
    if (
      !clock?.owner.equals(new PublicKey(DEVNET.sysvarOwner)) ||
      clock.executable ||
      clock.data.length !== 40 ||
      !budget ||
      budget.schemaVersion !== 1 ||
      !budget.operation.equals(run) ||
      !budget.beneficiary.equals(owner) ||
      !budget.authority.equals(sponsor) ||
      !budget.spentLamports.isZero() ||
      budget.attempts !== 0 ||
      enumTag(budget.purpose) !== "runCompletion" ||
      BigInt(budget.expiresAtSeconds.toString()) > clock.data.readBigInt64LE(32)
    )
      throw new ApiError("RUN_BUDGET_CHANGED", 409);
    instructions.push(
      programInstruction(
        "reclaimExpiredRunBudget",
        { budget: budgetAddress, sponsor, run, runEscrow: addresses.escrow[0] },
        { nonce: new BN(action.nonce) },
      ),
    );
  }
  if (
    previous &&
    priorBudget &&
    actionBalance &&
    priorInfo &&
    receipt?.owner.equals(program)
  ) {
    const prior = account<Accounts["sponsorBudget"]>(
      "sponsorBudget",
      priorInfo,
    );
    const rent = await rpc.getMinimumBalanceForRentExemption(
      coder.accounts.size("sponsorBudget"),
      "confirmed",
    );
    if (
      prior?.operation.equals(previous.run[0]) &&
      prior.beneficiary.equals(owner) &&
      prior.authority.equals(sponsor) &&
      (priorInfo.lamports > rent || (refund?.lamports ?? 0) > 0)
    )
      instructions.push(
        programInstruction(
          "reclaimCompletionBalance",
          {
            runEscrow: previous.escrow[0],
            budget: priorBudget,
            run: previous.run[0],
            sponsor,
            actionBalance,
            delegationProgram: DELEGATION_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          },
          {},
        ),
      );
  }
  if (instructions.length === 0) return;

  const [key, block] = await Promise.all([
    dedicatedSponsor(rpc),
    rpc.getLatestBlockhash("confirmed"),
  ]);
  const tx = new VersionedTransaction(
    new TransactionMessage({
      payerKey: sponsor,
      recentBlockhash: block.blockhash,
      instructions,
    }).compileToV0Message(),
  );
  const [fee, simulation] = await Promise.all([
    rpc.getFeeForMessage(tx.message, "confirmed"),
    rpc.simulateTransaction(tx, { commitment: "confirmed", sigVerify: false }),
  ]);
  if (
    fee.value === null ||
    !Number.isSafeInteger(fee.value) ||
    fee.value < 0 ||
    simulation.value.err !== null
  )
    throw new ApiError("RUN_BUDGET_CHANGED", 409);
  tx.sign([key]);
  const signature = utils.bytes.bs58.encode(
    tx.signatures[0] ?? new Uint8Array(),
  );
  await admitSponsorCost(
    `reclaim:${run.toBase58()}`,
    BigInt(fee.value),
    signature,
  );
  try {
    await rpc.sendRawTransaction(tx.serialize(), {
      maxRetries: 0,
      preflightCommitment: "confirmed",
    });
  } catch {
    // An unknown response still belongs to this signed reclaim transaction.
  }
  const result = await rpc
    .confirmTransaction(
      {
        ...block,
        signature,
        abortSignal: AbortSignal.timeout(8000),
      },
      "confirmed",
    )
    .catch(() => {
      throw new ApiError("SPONSOR_RECLAIM_PENDING", 409);
    });
  if (result.value.err !== null) throw new ApiError("RUN_BUDGET_CHANGED", 409);
}

export async function verifyPlayAuthorization(
  wallet: string,
  action: GameIntent["action"],
  rpc: Connection,
) {
  if (action.kind === "authorizeSession") {
    const { nonce, inputKey, rent, expiresAtSeconds } = action;
    const expected = await playSessionRent(
      rpc,
      new PublicKey(wallet),
      new PublicKey(inputKey),
      nonce,
    );
    if (
      rent?.token !== expected.token ||
      rent.authorization !== expected.authorization ||
      expiresAtSeconds > Math.floor(Date.now() / 1000) + 30 * 60 + 60
    )
      throw new ApiError("RUN_BUDGET_CHANGED", 409);
  }
}

export async function submitPlay(
  wallet: string,
  intent: GameIntent,
  tx: VersionedTransaction,
  verifyScope: () => Promise<Connection>,
) {
  const network = gameNetwork(intent.action);
  const operationId = gameInstructions(wallet, intent).operationId;
  const base = checkedConnection("base");
  const [rpc, sponsor] = await Promise.all([
    network === "base" ? base : checkedConnection("er"),
    base.then(dedicatedSponsor),
  ]);
  tx.sign([sponsor]);
  const signature = utils.bytes.bs58.encode(
    tx.signatures[0] ?? new Uint8Array(),
  );
  const prior = (
    await rpc.getSignatureStatuses([signature], {
      searchTransactionHistory: true,
    })
  ).value[0];
  if (prior)
    return {
      status: "requested",
      signature,
      network,
      unknownResponse: false,
    };
  const scopedRpc = network === "er" ? await verifyScope() : rpc;
  await verifyPlayAuthorization(wallet, intent.action, scopedRpc);
  const cost = await checkPlaySpend(
    scopedRpc,
    tx,
    sponsor.publicKey,
    network,
    true,
  ).catch((error: unknown) => {
    if (error instanceof ApiError && error.code === "BLOCKHASH_EXPIRED")
      return null;
    throw error;
  });
  // An RPC can reject an old hash even if this signature was already sent.
  // Give the client the exact signature to reconcile before re-signing.
  if (cost === null)
    return { status: "requested", signature, network, unknownResponse: true };
  if (cost > 0n) await admitSponsorCost(operationId, cost, signature);
  return sendReviewed(scopedRpc, tx, network, signature, true);
}

export async function sendReviewed(
  rpc: Connection,
  tx: VersionedTransaction,
  network: "base" | "er",
  signature: string,
  simulated = false,
) {
  try {
    await rpc.sendRawTransaction(tx.serialize(), {
      // Sponsored submissions have just simulated these exact signed bytes.
      skipPreflight: simulated,
      preflightCommitment: "confirmed",
      maxRetries: 2,
    });
    return { status: "requested", signature, network, unknownResponse: false };
  } catch {
    return { status: "requested", signature, network, unknownResponse: true };
  }
}
