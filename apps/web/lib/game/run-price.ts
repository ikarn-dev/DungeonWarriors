export type RunPrice = { sequence: bigint; price: bigint; exponent: number };
const chartLength = 60;
const priceDigits = new Intl.NumberFormat("en-US");

export function mergeRunPrices(
  history: readonly RunPrice[],
  samples: readonly RunPrice[],
) {
  const last = history.at(-1);
  return [
    ...history,
    ...samples.filter((point) => !last || point.sequence > last.sequence),
  ].slice(-chartLength);
}

export function formatRunPrice(price: RunPrice) {
  if (price.exponent >= 0)
    return priceDigits.format(price.price * 10n ** BigInt(price.exponent));
  const scale = 10n ** BigInt(-price.exponent);
  const decimal = (price.price % scale)
    .toString()
    .padStart(-price.exponent, "0")
    .replace(/0+$/, "");
  return (
    priceDigits.format(price.price / scale) + (decimal ? `.${decimal}` : "")
  );
}

export function runPricePath(points: readonly RunPrice[]) {
  const first = points[0];
  if (!first) return "";
  let low = first.price;
  let high = first.price;
  for (const { price } of points) {
    if (price < low) low = price;
    if (price > high) high = price;
  }
  const span = (points.at(-1)?.sequence ?? first.sequence) - first.sequence;
  return points
    .map((point, i) => {
      const previous = points[i - 1];
      const command =
        previous && point.sequence === previous.sequence + 1n ? "L" : "M";
      const x =
        2 +
        (span === 0n
          ? 0
          : Number(((point.sequence - first.sequence) * 156n) / span));
      const y =
        high === low
          ? 18
          : 34 - Number(((point.price - low) * 32n) / (high - low));
      return `${command}${x} ${y}`;
    })
    .join(" ");
}
