import "server-only";
import type { IdlAccounts } from "@anchor-lang/core";
import { DELEGATION_PROGRAM_ID } from "@magicblock-labs/ephemeral-rollups-sdk";
import {
  getAssociatedTokenAddressSync,
  unpackAccount,
} from "@solana/spl-token";
import {
  type AccountInfo,
  Connection,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import { z } from "zod";
import { requiredVaultBalance } from "../game/economy";
import { RULES_V1, U64_MAX } from "../game/rules";
import {
  decodeEscrowAccount,
  decodeRunAccount,
  enumTag,
  runAddresses,
} from "../game/run-accounts";
import { DEVNET, LEADERBOARD_SEED } from "../solana/addresses.ts";
import { coder, nonceBytes, pda, program, u64Input } from "../solana/program";
import type { PurrpsGame } from "../solana/purrps-game.ts";
import { type Leaderboard, leaderboardView } from "./leaderboard";
import { ApiError, baseRpcConfig } from "./runtime";
import { providerFetch } from "./telemetry";
import { readWalletFunds } from "./wallet-funds";

export {
  coder,
  idl,
  nonceBytes,
  pda,
  program,
  u64Input,
} from "../solana/program";
export function connection() {
  return new Connection(baseRpcConfig().HELIUS_DEVNET_RPC_URL, {
    commitment: "finalized",
    disableRetryOnRateLimit: true,
    fetch: providerFetch("solana"),
  });
}
export function account<T>(
  name: string,
  value: AccountInfo<Buffer> | null,
): T | null {
  if (value === null) return null;
  if (
    !value.owner.equals(program) ||
    value.executable ||
    value.data.length > 10240
  )
    throw new ApiError("INVALID_CHAIN_ACCOUNT", 502);
  try {
    return coder.accounts.decode<T>(name, value.data);
  } catch {
    throw new ApiError("INVALID_CHAIN_ACCOUNT", 502);
  }
}
export const stateInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("wallet") }).strict(),
  z.object({ kind: z.literal("balances") }).strict(),
  z.object({ kind: z.literal("walletFunds") }).strict(),
  z.object({ kind: z.literal("runEntry") }).strict(),
  z.object({ kind: z.literal("leaderboard") }).strict(),
  z.object({ kind: z.literal("draw"), nonce: u64Input }).strict(),
  z.object({ kind: z.literal("run"), nonce: u64Input }).strict(),
  z
    .object({
      kind: z.literal("history"),
      fromNonce: u64Input.optional(),
      limit: z.number().int().min(1).max(8).default(8),
    })
    .strict(),
]);

type Accounts = IdlAccounts<PurrpsGame>;
const invalidAccount = () => new ApiError("INVALID_CHAIN_ACCOUNT", 502);

function readPlayer(owner: PublicKey, info: AccountInfo<Buffer> | null) {
  const player = account<Accounts["playerAccount"]>("playerAccount", info);
  if (player === null) return null;
  const [, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from("player"), owner.toBytes()],
    program,
  );
  if (
    player.schemaVersion !== 1 ||
    !player.owner.equals(owner) ||
    player.bump !== bump ||
    !player.wins
      .add(player.losses)
      .add(player.technicalRefunds)
      .eq(player.settledRuns) ||
    player.settledRuns.gt(player.nextRunNonce)
  )
    throw invalidAccount();
  return player;
}

function walletView(player: Accounts["playerAccount"] | null) {
  if (player === null) return null;
  return {
    availableBaseUnits: player.availableBaseUnits.toString(),
    lockedStakeBaseUnits: player.lockedStakeBaseUnits.toString(),
    purchaseEscrowBaseUnits: player.purchaseEscrowBaseUnits.toString(),
    nextRunNonce: player.nextRunNonce.toString(),
    settledRuns: player.settledRuns.toString(),
    wins: player.wins.toString(),
    losses: player.losses.toString(),
    technicalRefunds: player.technicalRefunds.toString(),
  };
}

function readResult(
  identity: { owner: string; nonce: bigint },
  addresses: ReturnType<typeof runAddresses>,
  info: AccountInfo<Buffer> | null,
) {
  const receipt = account<Accounts["resultReceipt"]>("resultReceipt", info);
  if (receipt === null) return null;
  if (
    receipt.schemaVersion !== 1 ||
    receipt.bump !== addresses.receipt[1] ||
    receipt.owner.toBase58() !== identity.owner ||
    receipt.nonce.toString() !== identity.nonce.toString() ||
    !receipt.run.equals(addresses.run[0])
  )
    throw invalidAccount();
  return receipt;
}

function resultView(receipt: Accounts["resultReceipt"], address: PublicKey) {
  const { terminal } = receipt;
  const reason = enumTag(terminal.reason);
  const outcome =
    reason === "cashOut" || reason === "autoCashOut"
      ? "win"
      : reason === "technicalAbort"
        ? "technicalRefund"
        : "loss";
  return {
    status:
      outcome === "technicalRefund"
        ? ("refunded" as const)
        : ("settled" as const),
    outcome,
    reason,
    receipt: address.toBase58(),
    run: receipt.run.toBase58(),
    nonce: receipt.nonce.toString(),
    market: enumTag(receipt.market).toUpperCase(),
    cat: enumTag(receipt.cat.definition.id),
    catLevel: receipt.cat.level,
    score: terminal.score.toString(),
    coins: terminal.coins.toString(),
    qualifiedCheckpoints: terminal.qualifiedCheckpoints.toString(),
    activeTicks: terminal.activeTicks.toString(),
    stakeBaseUnits: receipt.stakeBaseUnits.toString(),
    grossPayoutBaseUnits: terminal.grossPayoutBaseUnits.toString(),
    refundBaseUnits: terminal.refundBaseUnits.toString(),
    settledAtSlot: receipt.settledAtSlot.toString(),
    settledAtSeconds: receipt.settledAtSeconds.toString(),
  };
}

export async function finalizedRunState(
  wallet: string,
  nonce: string,
  accounts: readonly (AccountInfo<Buffer> | null)[],
) {
  const identity = { owner: wallet, nonce: BigInt(nonce) };
  const addresses = runAddresses(identity);
  const [escrowInfo, runInfo, receiptInfo, clock] = accounts;
  if (escrowInfo == null) {
    if (runInfo != null || receiptInfo != null) throw invalidAccount();
    return { status: "absent" as const };
  }
  const escrow = await decodeEscrowAccount(
    identity,
    addresses.escrow[0],
    escrowInfo,
  ).catch(() => {
    throw invalidAccount();
  });
  const receipt = readResult(identity, addresses, receiptInfo ?? null);
  if (escrow.receipt !== null) {
    if (
      receipt === null ||
      Buffer.from(receipt.snapshotHash).toString("hex") !== escrow.snapshotHash
    )
      throw invalidAccount();
    const result = resultView(receipt, addresses.receipt[0]);
    const status =
      result.outcome === "technicalRefund"
        ? "refundedTechnical"
        : result.outcome === "win"
          ? "settledWin"
          : "settledLoss";
    if (escrow.status !== status) throw invalidAccount();
    return {
      status: result.status,
      receipt: escrow.receipt,
      grossPayoutBaseUnits: result.grossPayoutBaseUnits,
      refundBaseUnits: result.refundBaseUnits,
      result,
    };
  }
  if (receipt !== null) throw invalidAccount();
  if (runInfo == null || runInfo.owner.equals(DELEGATION_PROGRAM_ID)) {
    if (!escrow.delegationInitiated) throw invalidAccount();
    return { status: "recoveryPending" as const };
  }
  const run = await decodeRunAccount(identity, addresses.run[0], runInfo).catch(
    () => {
      throw invalidAccount();
    },
  );
  if (run.snapshotHash !== escrow.snapshotHash) throw invalidAccount();
  if (escrow.delegationInitiated) {
    const terminal =
      run.observation.phase === "terminalRecorded" ||
      run.observation.phase === "completionRequested";
    if (!terminal) return { status: "recoveryPending" as const };
    const { grossPayoutBaseUnits: gross, refundBaseUnits: refund } =
      run.terminal ?? {};
    if (typeof gross !== "bigint" || typeof refund !== "bigint")
      throw invalidAccount();
    return {
      status: "settlementReady" as const,
      market: escrow.market,
      pending: {
        grossPayoutBaseUnits: gross.toString(),
        refundBaseUnits: refund.toString(),
      },
    };
  }
  if (
    run.observation.phase !== "ready" ||
    clock == null ||
    clock.owner.toBase58() !== DEVNET.sysvarOwner ||
    clock.executable ||
    clock.data.length !== 40
  )
    throw invalidAccount();
  return {
    status:
      clock.data.readBigInt64LE(32) >= BigInt(escrow.activationDeadlineSeconds)
        ? ("refundReady" as const)
        : ("reserved" as const),
  };
}

function uninitialized(info: AccountInfo<Buffer> | null) {
  return (
    info === null ||
    (info.owner.equals(SystemProgram.programId) &&
      !info.executable &&
      info.data.length === 0)
  );
}

function wireAccount(address: PublicKey, info: AccountInfo<Buffer> | null) {
  if (
    info !== null &&
    (!info.owner.equals(program) || info.data.length > 10240 || info.executable)
  )
    throw invalidAccount();
  return {
    address: address.toBase58(),
    account:
      info === null
        ? null
        : {
            owner: info.owner.toBase58(),
            data: info.data.toString("base64"),
            executable: false,
          },
  };
}

function stateContext(slot: number) {
  return {
    network: "solana-devnet" as const,
    commitment: "finalized" as const,
    slot,
    fetchedAt: new Date().toISOString(),
  };
}

async function readFinalizedPlayer(rpc: Connection, owner: PublicKey) {
  const { value, context } = await rpc.getAccountInfoAndContext(
    pda("player", owner.toBytes()),
    "finalized",
  );
  return {
    context,
    player: readPlayer(owner, uninitialized(value) ? null : value),
  };
}

async function readRunEntry(rpc: Connection, owner: PublicKey) {
  const configAddress = pda("game-config");
  const houseAddress = pda("house");
  const clockAddress = new PublicKey(DEVNET.clock);
  const ownerAddress = pda("player", owner.toBytes());
  const mint = new PublicKey(DEVNET.usdcMint);
  const tokenProgram = new PublicKey(DEVNET.tokenProgram);
  const vaultAddress = getAssociatedTokenAddressSync(
    mint,
    houseAddress,
    true,
    tokenProgram,
  );
  const policyAddress = pda("sponsor-policy");
  const state = await rpc.getMultipleAccountsInfoAndContext(
    [configAddress, ownerAddress, policyAddress],
    { commitment: "finalized" },
  );
  const [configInfo, playerInfo, policyInfo] = state.value;
  const context = stateContext(state.context.slot);
  const config = account<Accounts["gameConfig"]>(
    "gameConfig",
    configInfo ?? null,
  );
  if (!config?.allowReservations)
    return { ...context, entry: { status: "closed" } };
  if (
    config.schemaVersion !== 1 ||
    config.rules?.version !== RULES_V1.rulesVersion
  )
    throw invalidAccount();
  const player = readPlayer(owner, playerInfo ?? null);
  const policy = account<Accounts["sponsorPolicy"]>(
    "sponsorPolicy",
    policyInfo ?? null,
  );
  if (player === null || policy === null || policy.paused)
    return { ...context, entry: { status: "budgetUnavailable" } };
  if (policy.schemaVersion !== 1 || !policy.config.equals(configAddress))
    throw invalidAccount();
  const run = runAddresses({
    owner: owner.toBase58(),
    nonce: BigInt(player.nextRunNonce.toString()),
  }).run[0];
  const {
    context: snapshot,
    value: [budgetInfo, houseInfo, vaultInfo, clock],
  } = await rpc.getMultipleAccountsInfoAndContext(
    [pda("sponsor", run.toBytes()), houseAddress, vaultAddress, clockAddress],
    { commitment: "finalized", minContextSlot: state.context.slot },
  );
  const budget = account<Accounts["sponsorBudget"]>(
    "sponsorBudget",
    budgetInfo ?? null,
  );
  if (
    !clock?.owner.equals(new PublicKey(DEVNET.sysvarOwner)) ||
    clock.executable ||
    clock.data.length !== 40
  )
    throw invalidAccount();
  const clockSeconds = clock.data.readBigInt64LE(32);
  if (
    clockSeconds <= 0n ||
    clockSeconds > BigInt(Number.MAX_SAFE_INTEGER - 1800)
  )
    throw invalidAccount();
  const balanceContext = stateContext(snapshot.slot);
  if (budget === null || !budgetInfo)
    return { ...balanceContext, entry: { status: "budgetUnavailable" } };
  const remaining =
    BigInt(budget.limitLamports.toString()) -
    BigInt(budget.spentLamports.toString());
  if (
    budget.schemaVersion !== 1 ||
    !budget.operation.equals(run) ||
    !budget.beneficiary.equals(owner) ||
    !budget.authority.equals(policy.authority) ||
    !budget.feePayer.equals(policy.authority) ||
    enumTag(budget.purpose) !== "runCompletion" ||
    budget.limitLamports.gt(policy.maxOperationLamports) ||
    budget.reservedCompletionLamports.lt(policy.minCompletionLamports) ||
    remaining < BigInt(budget.reservedCompletionLamports.toString()) ||
    budget.maxAttempts > policy.maxAttempts ||
    budget.attempts >= budget.maxAttempts ||
    BigInt(budget.expiresAtSeconds.toString()) <
      clockSeconds + BigInt(RULES_V1.activationTimeoutSeconds)
  )
    return { ...balanceContext, entry: { status: "budgetUnavailable" } };
  const rent = await rpc.getMinimumBalanceForRentExemption(
    budgetInfo.data.length,
    "finalized",
  );
  if (BigInt(budgetInfo.lamports) < BigInt(rent) + remaining)
    return { ...balanceContext, entry: { status: "budgetUnavailable" } };
  const house = account<Accounts["houseState"]>(
    "houseState",
    houseInfo ?? null,
  );
  const vault = unpackAccount(vaultAddress, vaultInfo ?? null, tokenProgram);
  if (
    !house ||
    house.schemaVersion !== 1 ||
    !house.config.equals(configAddress) ||
    !house.usdcMint.equals(mint) ||
    !house.vault.equals(vaultAddress) ||
    !vault.mint.equals(mint) ||
    !vault.owner.equals(houseAddress) ||
    !vault.isInitialized ||
    vault.isFrozen
  )
    throw invalidAccount();
  const obligations = requiredVaultBalance(
    BigInt(house.totalAvailableBaseUnits.toString()),
    BigInt(house.totalPurchaseEscrowBaseUnits.toString()),
    BigInt(house.totalMaxGrossBaseUnits.toString()),
    BigInt(house.bufferBaseUnits.toString()),
  );
  const maxMultiplier = BigInt(RULES_V1.maxMultiplierBps) / 10_000n;
  const headroom =
    vault.amount > obligations
      ? (vault.amount - obligations) / (maxMultiplier - 1n)
      : 0n;
  const maxStake = [
    BigInt(player.availableBaseUnits.toString()),
    headroom,
    U64_MAX / maxMultiplier,
  ].reduce((available, limit) => (available < limit ? available : limit));
  return {
    ...balanceContext,
    entry: {
      status: "ready",
      maxStake: maxStake.toString(),
      nonce: player.nextRunNonce.toString(),
      sessionNonce: player.nextSessionNonce.toString(),
      clockSeconds: Number(clockSeconds),
    },
  };
}

async function readHistory(
  rpc: Connection,
  owner: PublicKey,
  input: Extract<z.infer<typeof stateInput>, { kind: "history" }>,
) {
  const { player, context } = await readFinalizedPlayer(rpc, owner);
  const latest = BigInt(player?.nextRunNonce.toString() ?? "0");
  const requested =
    input.fromNonce === undefined ? latest : BigInt(input.fromNonce);
  const start = requested < latest ? requested : latest;
  const count = start < BigInt(input.limit) ? Number(start) : input.limit;
  const rows = Array.from({ length: count }, (_, i) => {
    const identity = { owner: owner.toBase58(), nonce: start - 1n - BigInt(i) };
    return { identity, addresses: runAddresses(identity) };
  });
  const page =
    count === 0
      ? { context, value: [] }
      : await rpc.getMultipleAccountsInfoAndContext(
          rows.map(({ addresses }) => addresses.receipt[0]),
          {
            commitment: "finalized",
            minContextSlot: context.slot,
          },
        );
  if (page.value.length !== count || page.context.slot < context.slot)
    throw invalidAccount();
  const accounts = rows.map(({ addresses }, i) => {
    const info = page.value[i] ?? null;
    return wireAccount(addresses.receipt[0], uninitialized(info) ? null : info);
  });
  const entries = rows.map(({ identity, addresses }, i) => {
    const info = page.value[i] ?? null;
    const receipt = readResult(
      identity,
      addresses,
      uninitialized(info) ? null : info,
    );
    if (receipt === null)
      return {
        status: "pending" as const,
        nonce: identity.nonce.toString(),
        run: addresses.run[0].toBase58(),
      };
    if (BigInt(receipt.settledAtSlot.toString()) > BigInt(page.context.slot))
      throw invalidAccount();
    return resultView(receipt, addresses.receipt[0]);
  });
  const next = start - BigInt(count);
  return {
    ...stateContext(page.context.slot),
    accounts,
    history: {
      entries,
      fromNonce: start.toString(),
      nextFromNonce: next === 0n ? null : next.toString(),
    },
  };
}

export async function readState(
  wallet: string,
  input: z.infer<typeof stateInput>,
) {
  const owner = new PublicKey(wallet);
  const rpc = connection();
  if ((await rpc.getGenesisHash()) !== DEVNET.genesisHash)
    throw new ApiError("WRONG_NETWORK", 503);
  if (input.kind === "history") return readHistory(rpc, owner, input);
  if (input.kind === "runEntry") return readRunEntry(rpc, owner);
  if (input.kind === "walletFunds") {
    const { slot, ...walletFunds } = await readWalletFunds(rpc, owner);
    return { ...stateContext(slot), walletFunds };
  }
  if (input.kind === "leaderboard") {
    const [address, bump] = PublicKey.findProgramAddressSync(
      [Buffer.from(LEADERBOARD_SEED)],
      program,
    );
    const { value, context } = await rpc.getAccountInfoAndContext(
      address,
      "finalized",
    );
    const isEmpty =
      value?.owner.equals(SystemProgram.programId) &&
      !value.executable &&
      value.data.length === 0;
    const board = account<Leaderboard>("leaderboard", isEmpty ? null : value);
    return {
      ...stateContext(context.slot),
      leaderboard: leaderboardView(board, bump),
    };
  }
  if (input.kind === "balances") {
    const { player, context } = await readFinalizedPlayer(rpc, owner);
    return { ...stateContext(context.slot), balances: walletView(player) };
  }
  let addresses: PublicKey[];
  switch (input.kind) {
    case "wallet":
      addresses = [
        pda("game-config"),
        pda("player", owner.toBytes()),
        pda("collection", owner.toBytes()),
        pda("house"),
      ];
      break;
    case "draw":
      addresses = [pda("draw", owner.toBytes(), nonceBytes(input.nonce))];
      break;
    case "run":
      addresses = [
        pda("run-escrow", owner.toBytes(), nonceBytes(input.nonce)),
        pda("run-game", owner.toBytes(), nonceBytes(input.nonce)),
        pda("result", owner.toBytes(), nonceBytes(input.nonce)),
        new PublicKey(DEVNET.clock),
      ];
      break;
  }
  const values = await rpc.getMultipleAccountsInfoAndContext(addresses, {
    commitment: "finalized",
  });
  if (values.value.length !== addresses.length) throw invalidAccount();
  const run =
    input.kind === "run"
      ? await finalizedRunState(wallet, input.nonce, values.value)
      : null;
  const entries =
    input.kind === "run" ? values.value.slice(0, 3) : values.value;
  const accounts = entries.map((entry, i) => {
    // The delegated base mirror may lag and cannot establish gameplay or payouts.
    const value =
      input.kind === "run" &&
      i === 1 &&
      entry?.owner.equals(DELEGATION_PROGRAM_ID)
        ? null
        : entry;
    const address = addresses[i];
    if (address === undefined) throw invalidAccount();
    return wireAccount(address, value);
  });
  if (input.kind === "wallet") {
    const cfg = account<{
      schemaVersion: number;
      rules: { version: number } | null;
      catalog: { version: number } | null;
    }>("gameConfig", values.value[0] ?? null);
    if (cfg !== null) {
      if (cfg.schemaVersion !== 1)
        throw new ApiError("UNSUPPORTED_CONFIGURATION", 503);
      const bindings = [
        ...(cfg.rules === null
          ? []
          : [{ seed: "rules", version: cfg.rules.version }]),
        ...(cfg.catalog === null
          ? []
          : [{ seed: "catalog", version: cfg.catalog.version }]),
      ];
      if (bindings.length > 0) {
        const keys = bindings.map((binding) => {
          const b = Buffer.alloc(4);
          b.writeUInt32LE(binding.version);
          return pda(binding.seed, b);
        });
        const published = await rpc.getMultipleAccountsInfoAndContext(keys, {
          commitment: "finalized",
          minContextSlot: values.context.slot,
        });
        published.value.forEach((value, i) => {
          const key = keys[i];
          if (value === null || key === undefined) throw invalidAccount();
          accounts.push(wireAccount(key, value));
        });
      }
    }
  }
  return {
    ...stateContext(values.context.slot),
    accounts,
    ...(run === null ? {} : { run }),
  };
}
