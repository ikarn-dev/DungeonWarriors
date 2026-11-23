import { CATS, ink, shared } from "./cat-palettes.mjs";
import { Grid, gridPaths, scale2x } from "./pixel-grid.mjs";

// Seated, front-facing portrait drawn on a 48x48 cell grid after the reference
// avatars, then doubled with Scale2x to 96x96 one-pixel cells. Mirrored
// features use x' = 47 - x.
const mirror = (x) => 47 - x;

function triangle(grid, [ax, ay], [bx, by], [cx, cy], color) {
  const minX = Math.floor(Math.min(ax, bx, cx));
  const maxX = Math.ceil(Math.max(ax, bx, cx));
  const minY = Math.floor(Math.min(ay, by, cy));
  const maxY = Math.ceil(Math.max(ay, by, cy));
  const side = (px, py, x1, y1, x2, y2) =>
    (px - x2) * (y1 - y2) - (x1 - x2) * (py - y2);
  for (let y = minY; y <= maxY; y++)
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const d1 = side(px, py, ax, ay, bx, by);
      const d2 = side(px, py, bx, by, cx, cy);
      const d3 = side(px, py, cx, cy, ax, ay);
      const negative = d1 < 0 || d2 < 0 || d3 < 0;
      const positive = d1 > 0 || d2 > 0 || d3 > 0;
      if (!(negative && positive)) grid.set(x, y, color);
    }
}

function both(draw) {
  draw((x) => x);
  draw(mirror);
}

function tail(grid, cat) {
  const path = [
    [15, 43],
    [11, 42],
    [7.5, 40],
    [5.5, 37],
    [4.5, 34],
    [4.5, 31],
    [5.5, 28.5],
  ];
  path.forEach(([x, y], i) => {
    const color =
      i === path.length - 1 ? cat.mask : i % 3 === 1 ? cat.stripe : cat.fur;
    const r = 2.7 - i * 0.12;
    grid.ellipse(x, y, r, r, color);
  });
}

function body(grid, cat) {
  grid.ellipse(24, 37, 11.5, 9, cat.shade);
  grid.ellipse(23.5, 36.5, 10.8, 8.4, cat.fur);
  grid.ellipse(24, 38, 6.2, 6.5, cat.mask);
  both((m) => {
    grid.rect(Math.min(m(17), m(21)), 38, 5, 6, cat.fur);
    grid.rect(Math.min(m(17), m(21)), 41, 5, 3, cat.mask);
    grid.set(m(19), 43, cat.maskShade);
    grid.rect(Math.min(m(17), m(21)), 39, 5, 1, shared.gold);
  });
  if (cat.armor) {
    both((m) => {
      grid.ellipse(m(15) + 0.5, 31.5, 4.2, 3.2, cat.armor.plate);
      grid.ellipse(m(15) + 0.5, 30.8, 3, 1.6, cat.armor.light);
      grid.rect(Math.min(m(12), m(18)), 34, 7, 1, shared.gold);
    });
    grid.rect(19, 31, 10, 7, cat.armor.plate);
    grid.rect(19, 31, 10, 1, cat.armor.light);
    grid.rect(19, 37, 10, 1, cat.armor.dark);
  } else {
    both((m) => {
      for (let y = 30; y <= 39; y++)
        grid.set(m(17 + Math.floor((y - 30) / 4)), y, cat.strap);
      grid.rect(Math.min(m(17), m(19)), 34, 3, 3, shared.gold);
      grid.set(m(18), 35, cat.strap);
    });
  }
}

function scarf(grid, cat) {
  grid.ellipse(24, 28.5, 12.5, 2.6, cat.scarfDark);
  grid.ellipse(24, 28, 12, 2.2, cat.scarf);
  triangle(grid, [33, 26], [45, 25], [44, 33], cat.scarf);
  triangle(grid, [33, 29], [44, 31], [40, 35], cat.scarfDark);
  triangle(grid, [41, 25], [46, 24], [45, 30], cat.scarf);
  grid.rect(36, 27, 6, 1, cat.scarfDark);
}

const ICONS = {
  collector: { core: "#2f4fbf", rows: ["w..w", "r..r", ".rr."] },
  acrobat: { core: "#5b2a86", rows: [".ww.", "w..w", "...."] },
  guardian: { core: "#2f6fe0", rows: ["wwww", "wwww", ".ww."] },
  sprinter: { core: "#2d2a36", rows: ["..y.", ".yy.", ".y.."] },
};
function badge(grid, cat, id) {
  grid.rect(22, 30, 4, 1, cat.badgeRing);
  grid.rect(21, 31, 6, 5, cat.badgeRing);
  grid.rect(22, 36, 4, 1, cat.badgeRing);
  grid.rect(22, 32, 4, 3, ICONS[id].core);
  grid.rect(23, 29, 2, 1, shared.gold);
  grid.stamp(22, 32, ICONS[id].rows, {
    r: "#e8343a",
    w: "#ffffff",
    y: "#ffd21f",
  });
  grid.rect(21, 36, 1, 1, shared.goldDark);
  grid.rect(26, 35, 1, 1, shared.goldDark);
}

function head(grid, cat) {
  // Continuous coordinates mirror about x = 24, cells about 23.5.
  for (const ear of [(x) => x, (x) => 48 - x]) {
    triangle(grid, [ear(9.5), 15], [ear(11.5), 2], [ear(21), 8], cat.fur);
    triangle(grid, [ear(12), 11], [ear(13), 4], [ear(18.5), 8.5], shared.pink);
  }
  grid.ellipse(24, 18, 15, 11.5, cat.shade);
  grid.ellipse(23.6, 17.5, 14.4, 11, cat.fur);
  grid.ellipse(21, 11, 7, 3, cat.furLight);
  grid.ellipse(24, 23.5, 10.5, 5.5, cat.mask);
  grid.ellipse(24, 18.5, 3, 4.5, cat.mask);
  both((m) => {
    grid.set(m(10), 18, cat.stripe);
    grid.set(m(10), 20, cat.stripe);
    grid.set(m(11), 19, cat.stripe);
  });
  grid.rect(23, 7, 2, 3, cat.stripe);
  both((m) => grid.set(m(20), 8, cat.stripe));
}

function face(grid) {
  both((m) => {
    const left = Math.min(m(16), m(19));
    grid.ellipse(left + 2, 19.5, 2.2, 2.7, shared.eye);
    grid.rect(m(17) - (m(17) > 24 ? 1 : 0), 18, 2, 1, shared.glint);
    grid.set(m(17) - (m(17) > 24 ? 1 : 0), 19, shared.glint);
    grid.set(m(19), 21, "#4a3b58");
    grid.rect(Math.min(m(9), m(12)), 22, 4, 1, ink);
    grid.rect(Math.min(m(9), m(12)), 24, 4, 1, ink);
    grid.set(m(14), 23, shared.blush);
    grid.set(m(15), 23, shared.blush);
  });
  grid.stamp(
    20,
    21,
    ["...pp...", "...kk...", ".kk..kk.", "..kttk..", "..kttk..", "...kk..."],
    { p: shared.pink, k: ink, t: shared.pink },
  );
}

function goggles(grid, cat) {
  grid.rect(8, 12, 32, 3, cat.band);
  grid.rect(8, 14, 32, 1, cat.scarfDark === cat.band ? cat.band : "#00000030");
  both((m) => {
    const cx = m(18) === 18 ? 18 : 30;
    grid.ellipse(cx, 12.5, 4.8, 3.8, cat.frame);
    grid.ellipse(cx, 12.5, 3.4, 2.5, cat.lens);
    grid.set(cx - 2, 12, shared.glint);
    grid.set(cx - 1, 11, shared.glint);
    grid.set(cx, 11, shared.glint);
    grid.rect(m(8) === 8 ? 8 : 38, 12, 2, 3, shared.gold);
  });
  grid.rect(23, 12, 2, 1, shared.gold);
}

function extras(grid, cat) {
  if (cat.bandana) {
    grid.rect(9, 15, 30, 2, cat.band);
    grid.rect(9, 16, 30, 1, cat.scarfDark);
    triangle(grid, [37, 15], [45, 13], [44, 19], cat.band);
    triangle(grid, [37, 17], [44, 20], [41, 23], cat.scarfDark);
  }
}

export function catPortrait(id) {
  const cat = CATS[id];
  const grid = new Grid(48, 48);
  tail(grid, cat);
  body(grid, cat);
  scarf(grid, cat);
  head(grid, cat);
  face(grid);
  goggles(grid, cat);
  extras(grid, cat);
  badge(grid, cat, id);
  grid.outline(ink);
  return gridPaths(scale2x(grid), 1);
}
