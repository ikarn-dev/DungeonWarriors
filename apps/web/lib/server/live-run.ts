import "server-only";

import { DELEGATION_PROGRAM_ID } from "@magicblock-labs/ephemeral-rollups-sdk";
import { PublicKey } from "@solana/web3.js";
import {
  decodeEscrowAccount,
  decodeRunAccount,
  runAddresses,
} from "../game/run-accounts";
import { stalledRunFaultAt } from "../game/run-crank";
import type { PlaySponsor } from "../game/run-transactions";
import { DEVNET } from "../solana/addresses";
import { readState } from "./chain";
import { ApiError, sponsorshipConfig } from "./runtime";
import { checkedConnection } from "./transaction-network";

export async function readLiveRun(wallet: string, nonce: string) {
  const base = await readState(wallet, { kind: "run", nonce });
  if (!("run" in base) || base.run === undefined || !("accounts" in base))
    throw new ApiError("INVALID_CHAIN_ACCOUNT", 502);
  let sponsor: (PlaySponsor & { maxAttempts: number }) | undefined;
  if (
    ["recoveryPending", "refundReady", "settlementReady"].includes(
      base.run.status,
    )
  ) {
    try {
      const settings = sponsorshipConfig();
      sponsor = {
        sponsor: settings.SPONSOR_PUBLIC_KEY,
        floor: settings.SPONSOR_MIN_BALANCE_LAMPORTS.toString(),
        maxAttempts: settings.SPONSOR_MAX_ATTEMPTS,
      };
    } catch (error) {
      if (
        !(error instanceof ApiError && error.code === "SERVICE_NOT_CONFIGURED")
      )
        throw error;
    }
  }
  if (base.run.status !== "recoveryPending")
    return { run: base.run, er: null, sponsor };

  const identity = { owner: wallet, nonce: BigInt(nonce) };
  const addresses = runAddresses(identity);
  const account = base.accounts[0]?.account;
  if (!account) throw new ApiError("INVALID_CHAIN_ACCOUNT", 502);
  const escrow = await decodeEscrowAccount(identity, addresses.escrow[0], {
    owner: new PublicKey(account.owner),
    data: Buffer.from(account.data, "base64"),
    executable: account.executable,
  });
  if (!escrow.delegationInitiated || escrow.status !== "reserved")
    throw new ApiError("INVALID_CHAIN_ACCOUNT", 502);
  const er = await checkedConnection("er", escrow.validator);
  const {
    context,
    value: [value, clock],
  } = await er.getMultipleAccountsInfoAndContext(
    [addresses.run[0], new PublicKey(DEVNET.clock)],
    "confirmed",
  );
  if (!value || value.owner.equals(DELEGATION_PROGRAM_ID))
    return { run: base.run, er: null, sponsor };
  const snapshot = await decodeRunAccount(
    identity,
    addresses.run[0],
    value,
  ).catch(() => {
    throw new ApiError("INVALID_CHAIN_ACCOUNT", 502);
  });
  if (snapshot.snapshotHash !== escrow.snapshotHash)
    throw new ApiError("INVALID_CHAIN_ACCOUNT", 502);
  let activationExpired = false;
  let recoveryAvailable = false;
  const phase = snapshot.observation.phase;
  if (phase === "ready" || phase === "suspended" || phase === "active") {
    if (
      !clock ||
      clock.executable ||
      clock.owner.toBase58() !== DEVNET.sysvarOwner ||
      clock.data.length !== 40
    )
      throw new ApiError("INVALID_CHAIN_ACCOUNT", 502);
    const now = clock.data.readBigInt64LE(32);
    activationExpired =
      phase === "ready" && now >= BigInt(escrow.activationDeadlineSeconds);
    const timeout = BigInt(snapshot.suspensionTimeoutSeconds);
    const faultAt = stalledRunFaultAt(
      snapshot.crank.originSeconds,
      snapshot.crank.consumedMs,
    );
    recoveryAvailable =
      snapshot.suspendedAt !== null
        ? now >= snapshot.suspendedAt + timeout
        : phase === "active" &&
          snapshot.crank.generation !== "0" &&
          now >= faultAt + timeout;
  }
  return {
    run: base.run,
    sponsor,
    er: {
      slot: context.slot,
      data: value.data.toString("base64"),
      owner: value.owner.toBase58(),
      market: escrow.market,
      endpoint: er.rpcEndpoint,
      inputKey: escrow.inputKey,
      activationExpired,
      recoveryAvailable,
    },
  };
}
