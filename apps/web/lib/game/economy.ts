import { checkedU64, earnedMultiplierBps, RULES_V1 } from "./rules";

export const USDC_DECIMALS = 6;

export function maxGrossReservation(stakeBaseUnits: bigint): bigint {
  checkedU64(stakeBaseUnits);
  if (stakeBaseUnits === 0n) throw new RangeError("Stake must be positive");
  return checkedU64(
    (stakeBaseUnits * BigInt(RULES_V1.maxMultiplierBps)) / 10_000n,
  );
}

export function grossPayout(
  stakeBaseUnits: bigint,
  qualifiedCheckpoints: bigint,
): bigint {
  maxGrossReservation(stakeBaseUnits);
  const multiplierBps = earnedMultiplierBps(qualifiedCheckpoints);
  if (multiplierBps === 0)
    throw new RangeError("Cash-out requires a qualified checkpoint");
  return checkedU64((stakeBaseUnits * BigInt(multiplierBps)) / 10_000n);
}

export function requiredVaultBalance(
  availableCredits: bigint,
  purchaseEscrows: bigint,
  maxGrossReservations: bigint,
  houseBuffer: bigint,
): bigint {
  // Reservations already include their stakes; do not add locked stakes again.
  return checkedU64(
    checkedU64(availableCredits) +
      checkedU64(purchaseEscrows) +
      checkedU64(maxGrossReservations) +
      checkedU64(houseBuffer),
  );
}
