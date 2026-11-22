import { BN } from "@anchor-lang/core";
import { MAGIC_CONTEXT_ID } from "@magicblock-labs/ephemeral-rollups-sdk";
import {
  ComputeBudgetProgram,
  PublicKey,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  TransactionInstruction,
} from "@solana/web3.js";
import { crankAddress, hydraProgram } from "../solana/program";
import { programInstruction } from "./run-transactions";

const triggerDiscriminator = 1;
const crankComputeLimit = 600_000;
const memoProgram = new PublicKey(
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
);

export function stalledRunFaultAt(originSeconds: bigint, consumedMs: bigint) {
  // Mirrors Rust: discard one opening second and require a backlog above two seconds.
  return originSeconds + 2n + (consumedMs + 2_000n) / 1_000n;
}

export function crankInstructions(
  run: PublicKey,
  payer: PublicKey,
  priceUpdate: PublicKey,
  delegationEpoch: string,
  generation: string,
  attempt: string,
) {
  const crank = crankAddress(run);
  return [
    ComputeBudgetProgram.setComputeUnitLimit({ units: crankComputeLimit }),
    // Distinguish due triggers under the same recent blockhash.
    new TransactionInstruction({
      programId: memoProgram,
      keys: [],
      data: Buffer.from(attempt, "utf8"),
    }),
    new TransactionInstruction({
      programId: hydraProgram,
      keys: [
        { pubkey: crank, isSigner: false, isWritable: true },
        { pubkey: payer, isSigner: true, isWritable: true },
        {
          pubkey: SYSVAR_INSTRUCTIONS_PUBKEY,
          isSigner: false,
          isWritable: false,
        },
      ],
      data: Buffer.from([triggerDiscriminator]),
    }),
    programInstruction(
      "advanceRun",
      {
        run,
        priceUpdate,
        crank,
        magicContext: MAGIC_CONTEXT_ID,
        instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
      },
      {
        args: {
          delegationEpoch: new BN(delegationEpoch),
          taskGeneration: new BN(generation),
        },
      },
    ),
  ];
}
