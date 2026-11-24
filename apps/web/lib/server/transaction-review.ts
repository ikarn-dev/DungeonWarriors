import "server-only";
import {
  ComputeBudgetProgram,
  type MessageV0,
  type TransactionInstruction,
} from "@solana/web3.js";
import { ApiError } from "./runtime";

const MAX_SPONSORED_COMPUTE_UNITS = 200000;
const SPONSORED_FEE_LIMIT_LAMPORTS = 100000n;
export function reviewedInstructions(
  message: MessageV0,
  expected: readonly TransactionInstruction[],
) {
  let units: number | undefined;
  let price: bigint | undefined;
  let nextApplicationInstruction = 0;
  const instructions = message.compiledInstructions.map((ix) => {
    if (
      !message.staticAccountKeys[ix.programIdIndex]?.equals(
        ComputeBudgetProgram.programId,
      )
    ) {
      const application = expected[nextApplicationInstruction++];
      if (application === undefined)
        throw new ApiError("TRANSACTION_REJECTED", 400);
      return application;
    }
    if (ix.accountKeyIndexes.length !== 0)
      throw new ApiError("TRANSACTION_REJECTED", 400);
    const data = Buffer.from(ix.data);
    if (data[0] === 2 && data.length === 5 && units === undefined) {
      units = data.readUInt32LE(1);
      if (units > 0 && units <= MAX_SPONSORED_COMPUTE_UNITS)
        return ComputeBudgetProgram.setComputeUnitLimit({ units });
    }
    if (data[0] === 3 && data.length === 9 && price === undefined) {
      price = data.readBigUInt64LE(1);
      return ComputeBudgetProgram.setComputeUnitPrice({ microLamports: price });
    }
    throw new ApiError("TRANSACTION_REJECTED", 400);
  });
  if (
    nextApplicationInstruction !== expected.length ||
    (price ?? 0n) *
      BigInt(units ?? expected.length * MAX_SPONSORED_COMPUTE_UNITS) >
      SPONSORED_FEE_LIMIT_LAMPORTS * 1_000_000n
  )
    throw new ApiError("TRANSACTION_REJECTED", 400);
  return instructions;
}
