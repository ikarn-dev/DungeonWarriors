import "server-only";
import {
  BorshCoder,
  convertIdlToCamelCase,
  type IdlAccounts,
} from "@anchor-lang/core";
import { DELEGATION_PROGRAM_ID } from "@magicblock-labs/ephemeral-rollups-sdk";
import { type AccountInfo, Connection, PublicKey } from "@solana/web3.js";
import { z } from "zod";
import {
  decodeEscrowAccount,
  decodeRunAccount,
  runAddresses,
} from "../game/run-accounts";
import { DEVNET } from "../solana/addresses.ts";
import { PURRPS_GAME_IDL, type PurrpsGame } from "../solana/purrps-game.ts";
import { ApiError, baseRpcConfig } from "./runtime";

export const program = new PublicKey(DEVNET.program);
export const idl = convertIdlToCamelCase(PURRPS_GAME_IDL);
export const coder = new BorshCoder(idl);
export const u64Input = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,19})$/)
  .pipe(z.string().refine((n) => BigInt(n) <= 0xffffffffffffffffn));
export function nonceBytes(value: string | bigint) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(value));
  return b;
}
export function pda(seed: string, ...parts: Uint8Array[]) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(seed), ...parts],
    program,
  )[0];
}
export function connection() {
  return new Connection(baseRpcConfig().HELIUS_DEVNET_RPC_URL, {
    commitment: "finalized",
    disableRetryOnRateLimit: true,
    fetch: (url, init) =>
      fetch(url, {
        ...init,
        signal: AbortSignal.timeout(8000),
        redirect: "error",
      }),
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
  z.object({ kind: z.literal("draw"), nonce: u64Input }).strict(),
  z.object({ kind: z.literal("run"), nonce: u64Input }).strict(),
  z
    .object({
      kind: z.literal("history"),
      fromNonce: u64Input,
      limit: z.number().int().min(1).max(8),
    })
    .strict(),
]);
export async function finalizedRunState(
  wallet: string,
  nonce: string,
  accounts: readonly (AccountInfo<Buffer> | null)[],
) {
  const identity = { owner: wallet, nonce: BigInt(nonce) };
  const addresses = runAddresses(identity);
  const [escrowInfo, runInfo, receiptInfo, clock] = accounts;
  const invalid = () => new ApiError("INVALID_CHAIN_ACCOUNT", 502);
  if (escrowInfo == null) {
    if (runInfo != null || receiptInfo != null) throw invalid();
    return { status: "absent" as const };
  }
  const escrow = await decodeEscrowAccount(
    identity,
    addresses.escrow[0],
    escrowInfo,
  ).catch(() => {
    throw invalid();
  });
  const receipt = account<IdlAccounts<PurrpsGame>["resultReceipt"]>(
    "resultReceipt",
    receiptInfo ?? null,
  );
  if (escrow.receipt !== null) {
    if (
      receipt === null ||
      receipt.schemaVersion !== 1 ||
      receipt.bump !== addresses.receipt[1] ||
      receipt.owner.toBase58() !== wallet ||
      receipt.nonce.toString() !== nonce ||
      !receipt.run.equals(addresses.run[0]) ||
      Buffer.from(receipt.snapshotHash).toString("hex") !== escrow.snapshotHash
    )
      throw invalid();
    return {
      status:
        escrow.status === "refundedTechnical"
          ? ("refunded" as const)
          : ("settled" as const),
      receipt: escrow.receipt,
      grossPayoutBaseUnits: receipt.terminal.grossPayoutBaseUnits.toString(),
      refundBaseUnits: receipt.terminal.refundBaseUnits.toString(),
    };
  }
  if (receipt !== null) throw invalid();
  if (runInfo == null || runInfo.owner.equals(DELEGATION_PROGRAM_ID)) {
    if (!escrow.delegationInitiated) throw invalid();
    return { status: "recoveryPending" as const };
  }
  const run = await decodeRunAccount(identity, addresses.run[0], runInfo).catch(
    () => {
      throw invalid();
    },
  );
  if (run.snapshotHash !== escrow.snapshotHash) throw invalid();
  if (escrow.delegationInitiated) {
    const terminal =
      run.observation.phase === "terminalRecorded" ||
      run.observation.phase === "completionRequested";
    return {
      status: terminal
        ? ("settlementReady" as const)
        : ("recoveryPending" as const),
    };
  }
  if (
    run.observation.phase !== "ready" ||
    clock == null ||
    clock.owner.toBase58() !== DEVNET.sysvarOwner ||
    clock.executable ||
    clock.data.length !== 40
  )
    throw invalid();
  return {
    status:
      clock.data.readBigInt64LE(32) >= BigInt(escrow.activationDeadlineSeconds)
        ? ("refundReady" as const)
        : ("reserved" as const),
  };
}

export async function readState(
  wallet: string,
  input: z.infer<typeof stateInput>,
) {
  const owner = new PublicKey(wallet);
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
    case "history": {
      const start = BigInt(input.fromNonce);
      addresses = Array.from(
        { length: Math.min(input.limit, Number(start > 8n ? 8n : start)) },
        (_, i) =>
          pda("result", owner.toBytes(), nonceBytes(start - 1n - BigInt(i))),
      );
      break;
    }
  }
  const rpc = connection();
  if ((await rpc.getGenesisHash()) !== DEVNET.genesisHash)
    throw new ApiError("WRONG_NETWORK", 503);
  const values = await rpc.getMultipleAccountsInfoAndContext(addresses, {
    commitment: "finalized",
  });
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
    if (
      value !== null &&
      (!value.owner.equals(program) ||
        value.data.length > 10240 ||
        value.executable)
    )
      throw new ApiError("INVALID_CHAIN_ACCOUNT", 502);
    return {
      address: addresses[i]?.toBase58(),
      account:
        value === null
          ? null
          : {
              owner: value.owner.toBase58(),
              data: value.data.toString("base64"),
              executable: false,
            },
    };
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
          if (
            value === null ||
            !value.owner.equals(program) ||
            value.data.length > 10240
          )
            throw new ApiError("INVALID_CHAIN_ACCOUNT", 502);
          accounts.push({
            address: keys[i]?.toBase58(),
            account: {
              owner: value.owner.toBase58(),
              data: value.data.toString("base64"),
              executable: false,
            },
          });
        });
      }
    }
  }
  return {
    network: "solana-devnet",
    commitment: "finalized",
    slot: values.context.slot,
    fetchedAt: new Date().toISOString(),
    accounts,
    ...(run === null ? {} : { run }),
  };
}
