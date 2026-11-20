import { BN } from "@anchor-lang/core";
import { MAGIC_CONTEXT_ID } from "@magicblock-labs/ephemeral-rollups-sdk";
import {
  ComputeBudgetProgram,
  type PublicKey,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  TransactionInstruction,
} from "@solana/web3.js";
import { crankAddress, hydraProgram } from "../solana/program";
import { programInstruction } from "./run-transactions";

const triggerDiscriminator = 1;
const crankComputeLimit = 600_000;

export function crankInstructions(
  run: PublicKey,
  payer: PublicKey,
  priceUpdate: PublicKey,
  delegationEpoch: string,
  generation: string,
) {
  const crank = crankAddress(run);
  return [
    ComputeBudgetProgram.setComputeUnitLimit({ units: crankComputeLimit }),
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
