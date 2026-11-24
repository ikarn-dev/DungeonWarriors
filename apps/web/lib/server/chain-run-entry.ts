import "server-only";
import type { IdlAccounts } from "@anchor-lang/core";
import {
  getAssociatedTokenAddressSync,
  unpackAccount,
} from "@solana/spl-token";
import { type Connection, PublicKey } from "@solana/web3.js";
import { requiredVaultBalance } from "../game/economy";
import { RULES_V1, rulesForVersion, U64_MAX } from "../game/rules";
import { enumTag, runAddresses } from "../game/run-accounts";
import type { CompletionOffer } from "../game/run-transactions";
import { DEVNET } from "../solana/addresses";
import { coder, pda } from "../solana/program";
import type { PurrpsGame } from "../solana/purrps-game";
import { browserConfigured } from "./browser-config";
import {
  account,
  invalidChainAccount as invalidAccount,
  readPlayer,
  stateContext,
  uninitialized,
} from "./chain-account";
import { sponsorshipConfig } from "./runtime";

type Accounts = IdlAccounts<PurrpsGame>;
export async function readRunEntry(rpc: Connection, owner: PublicKey) {
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
  if (
    !config?.allowReservations ||
    (config.rules?.version === 4 && !browserConfigured())
  )
    return { ...context, entry: { status: "closed" } };
  if (
    config.schemaVersion !== 1 ||
    !config.rules ||
    !rulesForVersion(config.rules.version)
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
  const budget = uninitialized(budgetInfo ?? null)
    ? null
    : account<Accounts["sponsorBudget"]>("sponsorBudget", budgetInfo ?? null);
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
  const sponsor = policy.authority.toBase58();
  const settings = sponsorshipConfig();
  const spend = settings.SPONSOR_COMPLETION_RESERVE_LAMPORTS;
  const attempts = Math.min(settings.SPONSOR_MAX_ATTEMPTS, policy.maxAttempts);
  const unavailable = {
    ...balanceContext,
    entry: { status: "budgetUnavailable" },
  };
  if (settings.SPONSOR_PUBLIC_KEY !== sponsor || attempts < 1)
    return unavailable;
  let completionFunding: CompletionOffer | undefined;
  const expired =
    budget && BigInt(budget.expiresAtSeconds.toString()) <= clockSeconds;
  if (budget && budgetInfo && !expired) {
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
      return unavailable;
    const rent = await rpc.getMinimumBalanceForRentExemption(
      budgetInfo.data.length,
      "finalized",
    );
    if (BigInt(budgetInfo.lamports) < BigInt(rent) + remaining)
      return unavailable;
  } else {
    const rent = await rpc.getMinimumBalanceForRentExemption(
      coder.accounts.size("sponsorBudget"),
      "finalized",
    );
    if (
      spend < BigInt(policy.minCompletionLamports.toString()) ||
      spend > BigInt(policy.maxOperationLamports.toString()) ||
      spend + BigInt(rent) > settings.SPONSOR_OPERATION_LIMIT_LAMPORTS
    )
      return unavailable;
    completionFunding = {
      sponsor,
      lamports: spend.toString(),
      floor: settings.SPONSOR_MIN_BALANCE_LAMPORTS.toString(),
      attempts,
    };
  }
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
      playSponsor: {
        sponsor,
        floor: settings.SPONSOR_MIN_BALANCE_LAMPORTS.toString(),
      },
      maxStake: maxStake.toString(),
      available: player.availableBaseUnits.toString(),
      houseHeadroom: (vault.amount > obligations
        ? vault.amount - obligations
        : 0n
      ).toString(),
      maxMultiplierBps: RULES_V1.maxMultiplierBps,
      nonce: player.nextRunNonce.toString(),
      sessionNonce: player.nextSessionNonce.toString(),
      clockSeconds: Number(clockSeconds),
      completionSponsor: sponsor,
      ...(completionFunding === undefined ? {} : { completionFunding }),
    },
  };
}
