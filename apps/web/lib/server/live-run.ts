import "server-only";

import { PublicKey } from "@solana/web3.js";
import {
  decodeEscrowAccount,
  decodeRunAccount,
  runAddresses,
} from "../game/run-accounts";
import { stalledRunFaultAt } from "../game/run-crank";
import { DEVNET } from "../solana/addresses";
import { readState } from "./chain";
import { ApiError } from "./runtime";
import { checkedConnection } from "./transaction-network";

export async function readLiveRun(wallet: string, nonce: string) {
  const base = await readState(wallet, { kind: "run", nonce });
  if (!("run" in base) || base.run === undefined || !("accounts" in base))
    throw new ApiError("INVALID_CHAIN_ACCOUNT", 502);
  if (base.run.status !== "recoveryPending") return { run: base.run, er: null };

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
  const { context, value } = await er.getAccountInfoAndContext(
    addresses.run[0],
    "confirmed",
  );
  if (value === null) return { run: base.run, er: null };
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
    const clock = await er.getAccountInfo(
      new PublicKey(DEVNET.clock),
      "confirmed",
    );
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
