// Pixel versions of the Solana and MagicBlock marks, drawn on a cell grid so
// they match the game art. Rows use "." for empty cells.
type Fill = (key: string, x: number, y: number) => string | null;

const SOLANA_ROWS = [
  "..ooooooooooo",
  ".ooooooooooo.",
  "ooooooooooo..",
  ".............",
  "ooooooooooo..",
  ".ooooooooooo.",
  "..ooooooooooo",
  ".............",
  "..ooooooooooo",
  ".ooooooooooo.",
  "ooooooooooo..",
] as const;
// Solana's purple-to-green gradient, banded into pixel steps from the
// bottom-left corner to the top-right.
const SOLANA_STEPS = [
  "#9945ff",
  "#8752f3",
  "#5497d5",
  "#43b4ca",
  "#28e0b9",
  "#19fb9b",
] as const;
const solanaFill: Fill = (key, x, y) => {
  if (key !== "o") return null;
  const t = (x + (SOLANA_ROWS.length - 1 - y)) / (12 + SOLANA_ROWS.length - 1);
  return (
    SOLANA_STEPS[Math.min(SOLANA_STEPS.length - 1, Math.floor(t * 6))] ?? null
  );
};

// Wizard-hat cube; the eyes are cut out so the badge shows through.
const MAGICBLOCK_ROWS = [
  "...w..........",
  "...ww.........",
  "...www........",
  "...wwwwwwwww..",
  "wwwwwwwwwwwww.",
  "..wwwwwwwwwww.",
  "..wwewwewwwww.",
  "..wwewwewwwww.",
  "..wwwwwwwwwww.",
  "...wwwwwwwwww.",
  "....wwwwwwww..",
] as const;
const magicBlockFill: Fill = (key) => (key === "w" ? "#ffffff" : null);

function PixelMark({
  rows,
  fill,
}: {
  readonly rows: readonly string[];
  readonly fill: Fill;
}) {
  const width = Math.max(...rows.map((row) => row.length));
  const cells: { x: number; y: number; w: number; color: string }[] = [];
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const color = fill(row[x] ?? ".", x, y);
      if (color === null) {
        x++;
        continue;
      }
      let end = x + 1;
      while (end < row.length && fill(row[end] ?? ".", end, y) === color) end++;
      cells.push({ x, y, w: end - x, color });
      x = end;
    }
  });
  return (
    <svg
      viewBox={`0 0 ${width} ${rows.length}`}
      width={width * 2}
      height={rows.length * 2}
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      {cells.map(({ x, y, w, color }) => (
        <rect key={`${x}-${y}`} x={x} y={y} width={w} height={1} fill={color} />
      ))}
    </svg>
  );
}

export default function BrandBadges() {
  return (
    <ul className="lobby-brands">
      <li className="lobby-brand" data-brand="solana">
        <PixelMark rows={SOLANA_ROWS} fill={solanaFill} />
        <span>
          Built on <strong>Solana</strong>
        </span>
      </li>
      <li className="lobby-brand" data-brand="magicblock">
        <PixelMark rows={MAGICBLOCK_ROWS} fill={magicBlockFill} />
        <span>
          Powered by <strong>MagicBlock</strong>
        </span>
      </li>
    </ul>
  );
}
