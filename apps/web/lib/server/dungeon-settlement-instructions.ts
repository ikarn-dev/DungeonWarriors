import "server-only";
import { createHash } from "node:crypto";
import {
  DELEGATION_PROGRAM_ID,
  delegateBufferPdaFromDelegatedAccountAndOwnerProgram,
  delegationMetadataPdaFromDelegatedAccount,
  delegationRecordPdaFromDelegatedAccount,
  MAGIC_CONTEXT_ID,
  MAGIC_PROGRAM_ID,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import {
  type AccountInfo,
  ComputeBudgetProgram,
  type Connection,
  PublicKey,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  TransactionInstruction,
} from "@solana/web3.js";
import { dungeonAccounts, expeditionAddress } from "../dungeon/transactions";
import { programInstruction } from "../solana/instruction";
import { coder, pda, program } from "../solana/program";
import { dungeonSecret } from "./dungeon-randomness";
import type { DungeonRecord } from "./dungeon-store";
import { ApiError, erRpcConfig } from "./runtime";

const hydra = new PublicKey("Hydra17i1feui9deaxu6d1TzSQMRNHeBRkDR1Awy7zea");
type Stage = NonNullable<DungeonRecord["delivery"]>["stage"];
export function settlementAddress(owner: string, nonce: string) {
  return pda("dungeon-result", expeditionAddress(owner, nonce).toBytes());
}

export async function settlementInstructions(
  rpc: Connection,
  record: DungeonRecord,
  payer: PublicKey,
  verifier: PublicKey,
  receipt: AccountInfo<Buffer> | null,
): Promise<{ stage: Stage; instructions: TransactionInstruction[] } | null> {
  const accounts = dungeonAccounts(record.owner, record.nonce);
  if (!record.randomness) {
    if (record.reason !== "vrfTimeout") return null;
    return {
      stage: undefined,
      instructions: [
        programInstruction("refundDungeonRandomness", accounts, {}),
      ],
    };
  }

  const gates = [...record.gates];
  while (gates.length < 5) gates.push(255);
  const { outcome } = record;
  if (outcome === null) return null;
  const result = {
    secret: Array.from(dungeonSecret(record.owner, record.nonce)),
    gates,
    gateCount: record.gates.length,
    outcome,
  };
  const leaderboard = pda("dungeon-leaderboard");
  const direct = {
    stage: undefined,
    instructions: [
      programInstruction(
        "settleDungeon",
        { ...accounts, verifier, payer, leaderboard },
        { args: result },
      ),
    ],
  };
  const settlement = settlementAddress(record.owner, record.nonce);
  if (receipt?.owner.equals(program)) {
    const saved = coder.accounts.decode("dungeonSettlement", receipt.data);
    if (
      !saved.expedition.equals(accounts.expedition) ||
      !saved.verifier.equals(verifier) ||
      saved.outcome !== result.outcome
    )
      throw new ApiError("INVALID_DUNGEON_ACCOUNT", 503);
    // If delegation was forcibly returned without the result, or Hydra has
    // already closed the task, the original verifier can deliver the proof.
    if (saved.result === null) return direct;
    const task = await rpc.getAccountInfo(saved.crank, "confirmed");
    if (!task?.owner.equals(hydra)) return direct;
    return {
      stage: "trigger",
      instructions: [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }),
        new TransactionInstruction({
          programId: hydra,
          keys: [
            { pubkey: saved.crank, isSigner: false, isWritable: true },
            { pubkey: payer, isSigner: true, isWritable: true },
            {
              pubkey: SYSVAR_INSTRUCTIONS_PUBKEY,
              isSigner: false,
              isWritable: false,
            },
          ],
          data: Buffer.from([1]), // Hydra Trigger
        }),
        programInstruction(
          "finalizeDungeonSettlement",
          {
            ...accounts,
            settlement,
            leaderboard,
            instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
          },
          { outcome: result.outcome },
        ),
      ],
    };
  }
  if (receipt?.owner.equals(DELEGATION_PROGRAM_ID)) {
    return {
      stage: "commit",
      instructions: [
        programInstruction(
          "recordDungeonSettlement",
          {
            settlement,
            verifier,
            payer,
            magicContext: MAGIC_CONTEXT_ID,
            magicProgram: MAGIC_PROGRAM_ID,
          },
          { result },
        ),
      ],
    };
  }
  if (receipt && receipt.data.length > 0)
    throw new ApiError("INVALID_DUNGEON_ACCOUNT", 503);
  const proofHash = createHash("sha256")
    .update("dungeon-warriors:terminal-proof:v1")
    .update(accounts.expedition.toBytes())
    .update(Buffer.from(result.secret))
    .update(Buffer.from(gates))
    .update(Buffer.from([result.gateCount, outcome]))
    .digest();
  const validator = new PublicKey(erRpcConfig().MAGICBLOCK_VALIDATOR_IDENTITY);
  const [crank] = PublicKey.findProgramAddressSync(
    [Buffer.from("crank"), payer.toBytes(), settlement.toBytes()],
    hydra,
  );
  return {
    stage: "schedule",
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
      programInstruction(
        "prepareDungeonSettlement",
        {
          ...accounts,
          settlement,
          verifier,
          payer,
          leaderboard,
          crank,
          hydraProgram: hydra,
          ownerProgram: program,
          buffer: delegateBufferPdaFromDelegatedAccountAndOwnerProgram(
            settlement,
            program,
          ),
          delegationRecord: delegationRecordPdaFromDelegatedAccount(settlement),
          delegationMetadata:
            delegationMetadataPdaFromDelegatedAccount(settlement),
          delegationProgram: DELEGATION_PROGRAM_ID,
        },
        { validator, outcome, proofHash: Array.from(proofHash) },
      ),
    ],
  };
}
