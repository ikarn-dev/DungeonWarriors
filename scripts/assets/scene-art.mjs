import { ink } from "./cat-palettes.mjs";
import { dither, Grid, gridPaths, noise } from "./pixel-grid.mjs";

// Every scene asset uses 2 logical px per art cell, matching the cats.
const S = 2;
const draw = (grid) => gridPaths(grid, S);

export const SKY_TOP = "#3e95e6";
const SKY = [SKY_TOP, "#4aa6ee", "#5ab6f3", "#6dc5f6", "#84d3f8", "#a0e0fa"];

function cloud(grid, cx, base, width, height, seed) {
  const layer = new Grid(grid.width, grid.height);
  const puffs = Math.max(3, Math.round(width / 9));
  for (let i = 0; i < puffs; i++) {
    const t = puffs === 1 ? 0.5 : i / (puffs - 1);
    const middle = 1 - Math.abs(t - 0.5) * 2;
    const r = height * (0.45 + 0.55 * middle) * (0.8 + noise(i, seed) * 0.4);
    layer.ellipse(
      cx - width / 2 + t * width,
      base - r * 0.7,
      r * 1.25,
      r,
      "#ffffff",
      true,
    );
  }
  layer.rect(
    Math.round(cx - width / 2 - 2),
    base - 2,
    Math.round(width + 4),
    3,
    "#ffffff",
    true,
  );
  for (let y = 0; y < layer.height; y++)
    for (let x = 0; x < layer.width; x++) {
      if (layer.get(x, y) === null) continue;
      if (y > base - 3 || (y === base - 3 && dither(x, y, 0.5)))
        layer.set(x, y, "#cdeefb");
      else if (layer.get(x, y - 1) === null && layer.get(x - 1, y) !== null)
        layer.set(x, y, "#ffffff");
      if (y > base) layer.set(x, y, null);
    }
  layer.cells.forEach((c, i) => {
    if (c !== null) grid.cells[i] = c;
  });
}

export function sky() {
  const g = new Grid(480, 270);
  for (let y = 0; y < 270; y++) {
    const band = (y / 270) * (SKY.length - 1);
    const index = Math.floor(band);
    const fraction = band - index;
    for (let x = 0; x < 480; x++) {
      const next = SKY[Math.min(SKY.length - 1, index + 1)];
      // Two rows of offset dashes soften each band edge without noise.
      const rowsLeft = (1 - fraction) * (270 / (SKY.length - 1));
      const dashed = rowsLeft <= 3 && ((x >> 2) + y) % 2 === 0;
      g.set(x, y, dashed ? next : SKY[index]);
    }
  }
  for (const [x, base, w, h, seed] of [
    [40, 128, 96, 24, 1],
    [170, 136, 120, 28, 2],
    [320, 130, 110, 26, 3],
    [430, 134, 90, 22, 4],
    [90, 52, 40, 10, 5],
    [255, 34, 54, 12, 6],
    [395, 70, 34, 9, 7],
    [470, 24, 28, 8, 8],
  ])
    cloud(g, x, base, w, h, seed);
  return draw(g);
}

// Integer frequencies keep each ridge seamless across the 480-cell repeat.
function ridge(x, base, waves) {
  return Math.round(
    base +
      waves.reduce(
        (sum, [k, amp, phase]) =>
          sum + amp * Math.sin((2 * Math.PI * k * x) / 480 + phase),
        0,
      ),
  );
}

export function farHills() {
  const g = new Grid(480, 270);
  for (let x = 0; x < 480; x++) {
    const peak = ridge(x, 128, [
      [2, 10, 0.4],
      [5, 6, 1.7],
      [11, 2, 0.2],
    ]);
    for (let y = peak; y < 270; y++)
      g.set(x, y, y < peak + 2 ? "#c6ecf2" : y < 160 ? "#a8dde8" : "#9bd4e0");
    const hill = ridge(x, 156, [
      [3, 9, 2.1],
      [7, 4, 0.9],
    ]);
    const bump = Math.round(noise(Math.floor(x / 6), 0, 11) * 3);
    const top = hill - bump;
    for (let y = top; y < 270; y++) {
      const shade =
        y < top + 2 ? "#9fdcc3" : y < top + 14 ? "#80c9ae" : "#72bda2";
      g.set(x, y, shade);
    }
  }
  return draw(g);
}

export function nearForest() {
  const g = new Grid(480, 270);
  for (let i = 0; i < 24; i++) {
    const x = i * 20 + Math.round(noise(i, 3, 21) * 8);
    const top = 150 + Math.round(noise(i, 4, 22) * 24);
    const r = 13 + Math.round(noise(i, 5, 23) * 7);
    g.rect(x - 2, top + r - 2, 4, 270, "#4a3a3c", true);
    g.ellipse(x, top + r, r, r * 0.9, "#2d7a46", true);
    g.ellipse(x - 1, top + r - 1, r - 1, r * 0.85 - 1, "#3f9d58", true);
    g.ellipse(
      x - r * 0.35,
      top + r * 0.65,
      r * 0.45,
      r * 0.32,
      "#5cba62",
      true,
    );
  }
  for (let x = 0; x < 480; x++) {
    const top = ridge(x, 192, [
      [6, 5, 0.3],
      [13, 3, 1.1],
    ]);
    for (let y = top; y < 270; y++)
      g.set(
        x,
        y,
        y < top + 2 ? "#4fae5a" : y < top + 10 ? "#3a924f" : "#2f8046",
      );
    if (noise(x, 1, 31) > 0.8) g.set(x, top - 1, "#4fae5a");
  }
  return draw(g);
}

const STONE = {
  mortar: "#2a2640",
  stone: "#403c63",
  light: "#56518a",
  dark: "#34304f",
  fleck: "#4b4775",
};
export function terrainFill() {
  const g = new Grid(16, 16);
  g.rect(0, 0, 16, 16, STONE.mortar);
  for (const [x, y, w, h] of [
    [0, 0, 7, 4],
    [8, 0, 7, 4],
    [4, 5, 7, 5],
    [12, 5, 7, 5],
    [1, 11, 6, 4],
    [8, 11, 7, 4],
  ]) {
    g.rect(x, y, w, h, STONE.stone, true);
    g.rect(x, y, w - 1, 1, STONE.light, true);
    g.rect(x, y + h - 1, w, 1, STONE.dark, true);
    g.rect(x + w - 1, y, 1, h, STONE.dark, true);
  }
  for (const [x, y] of [
    [3, 2],
    [11, 2],
    [7, 7],
    [15, 8],
    [4, 13],
    [11, 13],
  ])
    g.wrapSet(x, y, STONE.fleck);
  return draw(g);
}

const GRASS = {
  tuft: "#9be56a",
  top: "#c5f58a",
  light: "#8ee05c",
  mid: "#5cc44a",
  dark: "#3a9a3c",
  deep: "#2a7a32",
};
// 16x8 cells: tufts above the walkable edge, then the grass lip and drips.
export function terrainGrass() {
  const g = new Grid(16, 8);
  const drip = [2, 3, 2, 1, 1, 2, 3, 3, 2, 1, 2, 2, 3, 2, 1, 1];
  for (let x = 0; x < 16; x++) {
    if ([1, 4, 5, 9, 12, 14].includes(x)) g.set(x, 0, GRASS.tuft);
    g.set(x, 1, GRASS.top);
    g.set(x, 2, GRASS.light);
    g.set(x, 3, x % 5 === 2 ? GRASS.mid : GRASS.light);
    for (let y = 4; y < 4 + (drip[x] ?? 1); y++)
      g.set(x, y, y === 3 + (drip[x] ?? 1) ? GRASS.deep : GRASS.dark);
    g.set(x, 4 + (drip[x] ?? 1), "#1a143059");
  }
  return draw(g);
}

export function terrainEdge(side) {
  const g = new Grid(16, 16);
  g.rect(0, 0, 16, 16, STONE.stone);
  g.rect(side === "left" ? 0 : 14, 0, 2, 16, ink);
  g.rect(side === "left" ? 2 : 13, 0, 1, 16, STONE.light);
  return draw(g);
}

export function terrainUnderside() {
  const g = new Grid(16, 16);
  g.rect(0, 0, 16, 12, STONE.stone);
  g.rect(0, 12, 16, 2, STONE.dark);
  g.rect(0, 14, 16, 2, ink);
  for (const x of [2, 7, 12]) g.rect(x, 14, 2, 1, STONE.mortar);
  return draw(g);
}

const WOOD = { plank: "#b0703f", light: "#d99a5b", dark: "#7a4526" };
export function bridgeDeck() {
  const g = new Grid(16, 8);
  for (let x = 0; x < 16; x++) {
    const seam = x % 8 === 7;
    g.rect(x, 0, 1, 8, seam ? WOOD.dark : WOOD.plank);
    g.set(x, 0, seam ? WOOD.dark : WOOD.light);
  }
  g.rect(0, 6, 16, 2, ink);
  g.rect(3, 3, 1, 1, WOOD.dark);
  g.rect(11, 2, 1, 1, WOOD.dark);
  return draw(g);
}

export function bridgePost(x) {
  const g = new Grid(16, 16);
  g.rect(x, 0, 4, 16, WOOD.plank);
  g.rect(x, 0, 1, 16, WOOD.light);
  g.rect(x + 3, 0, 1, 16, WOOD.dark);
  g.rect(x - 1, 0, 6, 2, WOOD.dark);
  g.outline(ink);
  return draw(g);
}

const WATER = {
  top: "#b6f4ff",
  surface: "#5ad8ee",
  body: "#2fb2d6",
  deep: "#2190bd",
};
export function waterFill() {
  const g = new Grid(16, 16);
  g.rect(0, 0, 16, 16, WATER.body);
  g.rect(2, 4, 4, 1, WATER.surface);
  g.rect(10, 10, 3, 1, WATER.surface);
  g.rect(0, 13, 16, 3, WATER.deep);
  return draw(g);
}

export function waterSurface(frame) {
  const g = new Grid(16, 16);
  for (let x = 0; x < 16; x++) {
    const crest = 4 + Math.round(Math.sin(((x + frame * 4) * Math.PI) / 8));
    g.set(x, crest, WATER.top);
    g.rect(x, crest + 1, 1, 16 - crest, WATER.body);
    g.set(x, crest + 1, WATER.surface);
  }
  return draw(g);
}

const COIN = {
  outline: "#6b3a10",
  side: "#c46d12",
  rim: "#f5a623",
  face: "#ffd23f",
  inner: "#ffbf2a",
  light: "#fff3a0",
};
// Upright coin turning about its vertical axis, 16 frames per revolution.
export function coin(frame) {
  const g = new Grid(16, 16);
  const angle = (frame * Math.PI) / 8;
  const half = 4.6 * Math.abs(Math.cos(angle));
  const turn = Math.sign(Math.sin(angle));
  const cx = 8;
  const cy = 7.5;
  if (half < 1.2) {
    g.rect(7, 3, 2, 10, COIN.side);
    g.rect(7, 3, 1, 10, COIN.rim);
    g.set(7, 4, COIN.light);
  } else {
    g.ellipse(cx - turn * 0.8, cy, half, 5, COIN.side);
    g.ellipse(cx + turn * 0.3, cy, half, 5, COIN.rim);
    g.ellipse(cx + turn * 0.3, cy, Math.max(0.6, half - 1), 4, COIN.face);
    if (half > 2.6) {
      g.ellipse(cx + turn * 0.3, cy + 0.5, half - 2.2, 2.4, COIN.inner);
      g.set(Math.round(cx + turn * 0.3) - 1, 7, COIN.light);
      g.set(Math.round(cx + turn * 0.3), 8, COIN.light);
    }
    for (let y = 3; y < 7; y++)
      for (let x = 0; x < 16; x++)
        if (g.get(x, y) === COIN.face && x < cx - half * 0.2 && x > cx - half)
          g.set(x, y, COIN.light);
  }
  g.outline(COIN.outline);
  if (frame === 2 || frame === 10) {
    g.set(3, 2, "#ffffff");
    g.set(3, 1, "#ffffffa0");
    g.set(2, 2, "#ffffffa0");
    g.set(4, 2, "#ffffffa0");
  }
  return draw(g);
}

export function coinShadow() {
  const g = new Grid(8, 3);
  g.rect(1, 0, 6, 3, "#1a143040");
  g.rect(0, 1, 8, 1, "#1a143040");
  return draw(g);
}

export function star(frame) {
  const g = new Grid(12, 12);
  g.stamp(
    1,
    1,
    [
      ".....y....",
      "....yy....",
      "....yyy...",
      "yyyyywyyyy",
      ".yyywwyyy.",
      "..yyyyyy..",
      "..yyyyyy..",
      ".yyy..yyy.",
      ".yy....yy.",
      ".y......y.",
    ],
    { y: "#ffe45c", w: "#ffffff" },
  );
  for (let y = 6; y < 12; y++)
    for (let x = 0; x < 12; x++)
      if (g.get(x, y) === "#ffe45c") g.set(x, y, "#ffc02e");
  g.outline("#7a4a12");
  const sparkle = [
    [0, 0],
    [11, 1],
    [11, 10],
    [0, 9],
  ][frame];
  g.set(sparkle[0], sparkle[1], "#ffffff");
  return draw(g);
}

const POWER_COLORS = {
  magnet: "#ff5a68",
  "double-jump": "#b98cff",
  shield: "#5fd2ff",
  "extra-dash": "#ffae3c",
};
export const POWER_ICONS = {
  magnet: ["w....w", "r....r", "r....r", "r....r", ".r..r.", "..rr.."],
  "double-jump": ["..ww..", ".w..w.", "w....w", "..ww..", ".w..w.", "w....w"],
  shield: ["wwwwww", "wbbbbw", "wbwbbw", ".wbbw.", ".wbbw.", "..ww.."],
  "extra-dash": ["...yy.", "..yy..", ".yyyy.", "..yy..", ".yy...", ".y...."],
};
const ICON_INK = { r: "#ff4d5a", w: "#ffffff", b: "#3a7bff", y: "#ffd21f" };
export function booster(power) {
  const g = new Grid(12, 12);
  g.ellipse(6, 6, 5.6, 5.6, POWER_COLORS[power]);
  g.ellipse(6, 6, 4.6, 4.6, "#22305a");
  g.stamp(3, 3, POWER_ICONS[power], ICON_INK);
  g.set(2, 3, "#ffffff");
  g.set(3, 2, "#ffffff");
  g.outline(ink);
  return draw(g);
}

export function hazard() {
  const g = new Grid(16, 16);
  for (const x of [4, 7, 10]) {
    g.set(x, 5, "#e9edf5");
    g.rect(x, 6, 1, 2, "#e9edf5");
    g.rect(x + 1, 6, 1, 2, "#a9b2c6");
    g.rect(x - 1, 8, 1, 4, "#e9edf5");
    g.rect(x, 8, 2, 4, "#a9b2c6");
    g.rect(x + 1, 9, 1, 3, "#6c7590");
  }
  g.rect(3, 12, 10, 1, "#e24a4a");
  g.rect(3, 13, 10, 2, "#4a4560");
  g.rect(3, 13, 10, 1, "#635d80");
  g.outline(ink);
  return draw(g);
}

export function pitEdge() {
  const g = new Grid(16, 16);
  g.rect(0, 10, 16, 6, STONE.stone);
  for (let x = 1; x < 16; x += 4) {
    g.rect(x, 6, 2, 4, "#a9b2c6");
    g.set(x, 5, "#e9edf5");
  }
  g.outline(ink);
  return draw(g);
}
