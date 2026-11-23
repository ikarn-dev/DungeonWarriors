// Renders rows of pixel cells as a crisp inline SVG. Each row is a string;
// `fill` maps a cell key to a colour, or null for an empty cell.
export type Fill = (key: string, x: number, y: number) => string | null;

export function PixelMark({
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
