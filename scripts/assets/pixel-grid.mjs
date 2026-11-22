// Pixel canvas for authored SVG art. Every cell becomes a crisp square of
// `scale` logical pixels; runs of one color merge into a single path segment.
export class Grid {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.cells = new Array(width * height).fill(null);
  }
  inside(x, y) {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }
  get(x, y) {
    return this.inside(x, y) ? this.cells[y * this.width + x] : null;
  }
  set(x, y, color) {
    const px = Math.round(x);
    const py = Math.round(y);
    if (color !== undefined && this.inside(px, py))
      this.cells[py * this.width + px] = color;
    return this;
  }
  // Horizontal wrap keeps background layers seamless when tiled.
  wrapSet(x, y, color) {
    const px = ((Math.round(x) % this.width) + this.width) % this.width;
    return this.set(px, y, color);
  }
  rect(x, y, w, h, color, wrap = false) {
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++)
        if (wrap) this.wrapSet(x + i, y + j, color);
        else this.set(x + i, y + j, color);
    return this;
  }
  ellipse(cx, cy, rx, ry, color, wrap = false) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1)
          if (wrap) this.wrapSet(x, y, color);
          else this.set(x, y, color);
      }
    return this;
  }
  // Rows of characters; "." is transparent, other keys index the palette.
  stamp(x, y, rows, palette, mirror = false) {
    rows.forEach((row, j) => {
      [...row].forEach((key, i) => {
        if (key === "." || key === " ") return;
        const color = palette[key];
        if (color === undefined) throw new Error(`Unknown pixel key ${key}`);
        this.set(mirror ? x + row.length - 1 - i : x + i, y + j, color);
      });
    });
    return this;
  }
  line(x0, y0, x1, y1, color, thickness = 1) {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let s = 0; s <= steps; s++) {
      const x = Math.round(x0 + ((x1 - x0) * s) / steps);
      const y = Math.round(y0 + ((y1 - y0) * s) / steps);
      this.rect(x, y, thickness, thickness, color);
    }
    return this;
  }
  replace(from, to) {
    for (let i = 0; i < this.cells.length; i++)
      if (this.cells[i] === from) this.cells[i] = to;
    return this;
  }
  // Adds a 1-cell ink border around every filled region, never over fills.
  outline(ink, { diagonal = false, skip = [] } = {}) {
    const filled = (x, y) => {
      const c = this.get(x, y);
      return c !== null && c !== ink && !skip.includes(c);
    };
    const marks = [];
    for (let y = 0; y < this.height; y++)
      for (let x = 0; x < this.width; x++) {
        if (this.get(x, y) !== null) continue;
        const near =
          filled(x - 1, y) ||
          filled(x + 1, y) ||
          filled(x, y - 1) ||
          filled(x, y + 1) ||
          (diagonal &&
            (filled(x - 1, y - 1) ||
              filled(x + 1, y - 1) ||
              filled(x - 1, y + 1) ||
              filled(x + 1, y + 1)));
        if (near) marks.push([x, y]);
      }
    for (const [x, y] of marks) this.set(x, y, ink);
    return this;
  }
  copy() {
    const next = new Grid(this.width, this.height);
    next.cells = [...this.cells];
    return next;
  }
}

// Row-merged rectangles grouped by color: compact, crisp at integer zoom.
export function gridPaths(grid, scale = 2, offsetX = 0, offsetY = 0) {
  const byColor = new Map();
  for (let y = 0; y < grid.height; y++) {
    let x = 0;
    while (x < grid.width) {
      const color = grid.get(x, y);
      if (color === null) {
        x++;
        continue;
      }
      let end = x + 1;
      while (end < grid.width && grid.get(end, y) === color) end++;
      const run = `M${offsetX + x * scale} ${offsetY + y * scale}h${(end - x) * scale}v${scale}h-${(end - x) * scale}z`;
      byColor.set(color, (byColor.get(color) ?? "") + run);
      x = end;
    }
  }
  return [...byColor]
    .map(([color, d]) => `<path fill="${color}" d="${d}"/>`)
    .join("");
}

export function svgDocument(width, height, content) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges">${content}</svg>\n`;
}

// Ordered 4x4 Bayer threshold for pixel dithering between two bands.
const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
export function dither(x, y, amount) {
  return bayer[(y & 3) * 4 + (x & 3)] / 16 < amount;
}

// Deterministic noise so regenerated art is byte-identical.
export function noise(x, y, seed = 1) {
  let h = (x * 374761393 + y * 668265263 + seed * 982451653) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
