const number = new Intl.NumberFormat("en-US");
export function displayMultiplier(
  returned: string | null,
  stake: string | null,
): string {
  if (
    returned === null ||
    stake === null ||
    !/^\d+$/.test(returned) ||
    !/^\d+$/.test(stake)
  )
    return "--";
  const value = BigInt(returned),
    bet = BigInt(stake);
  if (bet === 0n) return "--";
  if (value === 0n) return "0×";
  const rounded = (value * 100n + bet / 2n) / bet;
  if (rounded === 0n) return "<0.01×";
  const fraction = (rounded % 100n)
    .toString()
    .padStart(2, "0")
    .replace(/0+$/, "");
  return `${number.format(rounded / 100n)}${fraction ? `.${fraction}` : ""}×`;
}
