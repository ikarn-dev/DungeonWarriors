import { CATS, ink, shared } from "./cat-palettes.mjs";
import { Grid, gridPaths } from "./pixel-grid.mjs";

// Side-view runner on a 24x24 cell grid (2 logical px per cell). Feet rest on
// row 18 so the outline ends exactly on the 48x48 frame's (24, 40) anchor.
const FOOT = 18;
const HIP = 15;

// Leg order: back far, back near, front far, front near. [dx, lift] per leg.
const GALLOP = [
  [
    [-2, 0],
    [-1, 0],
    [2, 1],
    [3, 1],
  ],
  [
    [-1, 0],
    [-2, 1],
    [1, 0],
    [2, 0],
  ],
  [
    [0, 1],
    [-1, 1],
    [0, 0],
    [1, 0],
  ],
  [
    [1, 1],
    [0, 1],
    [-1, 0],
    [0, 1],
  ],
  [
    [2, 1],
    [1, 1],
    [-2, 0],
    [-1, 0],
  ],
  [
    [1, 0],
    [2, 0],
    [-1, 1],
    [-2, 1],
  ],
  [
    [0, 0],
    [1, 0],
    [0, 1],
    [-1, 1],
  ],
  [
    [-1, 0],
    [0, 0],
    [1, 1],
    [1, 1],
  ],
];
const GALLOP_BOB = [0, 0, 1, 0, -1, -1, 0, 0];
const STAND = [
  [0, 0],
  [0, 0],
  [0, 0],
  [0, 0],
];
const HIPS = [6, 8, 11, 13];

function basePose() {
  return {
    bob: 0,
    headBob: 0,
    lean: 0,
    legs: STAND,
    tail: 0,
    tailLift: 0,
    scarf: 0,
    scarfLift: 0,
    eyes: "open",
    mouth: "open",
    ears: "up",
    streaks: false,
    flash: false,
  };
}

function legs(grid, cat, pose, drawFar) {
  HIPS.forEach((hip, index) => {
    const far = index % 2 === 0;
    if (far !== drawFar) return;
    const [dx, lift] = pose.legs[index];
    const top = HIP + pose.bob;
    const foot = FOOT - lift;
    const fur = far ? cat.shade : cat.fur;
    const paw = far ? cat.maskShade : cat.mask;
    const span = Math.max(1, foot - top);
    for (let row = top; row <= foot; row++) {
      const x = hip + pose.lean + Math.round((dx * (row - top)) / span);
      const color = row === foot ? paw : fur;
      grid.rect(x, row, 2, 1, color);
    }
  });
}

function tail(grid, cat, pose) {
  const b = pose.bob;
  const s = pose.tail;
  const lift = pose.tailLift;
  const points = [
    [5, 12],
    [4, 11],
    [3, 10 - lift],
    [2 + Math.round(s * 0.5), 9 - lift],
    [2 + Math.round(s), 8 - lift],
    [2 + Math.round(s * 1.5), 7 - lift],
    [3 + Math.round(s * 1.5), 6 - lift],
  ];
  points.forEach(([x, y], i) => {
    const color =
      i === points.length - 1 ? cat.mask : i % 2 === 1 ? cat.stripe : cat.fur;
    grid.rect(x + pose.lean, y + b, 2, 2, color);
  });
}

function body(grid, cat, pose) {
  const b = pose.bob;
  const x0 = pose.lean;
  const rows = [
    [11, 7, 13],
    [12, 5, 14],
    [13, 5, 14],
    [14, 5, 14],
    [15, 6, 13],
  ];
  for (const [y, from, to] of rows)
    grid.rect(from + x0, y + b, to - from + 1, 1, cat.fur);
  grid.rect(7 + x0, 11 + b, 4, 1, cat.furLight);
  grid.rect(8 + x0, 15 + b, 5, 1, cat.mask);
  grid.rect(9 + x0, 14 + b, 3, 1, cat.mask);
  grid.rect(5 + x0, 14 + b, 2, 1, cat.shade);
  for (const [x, y] of [
    [8, 12],
    [8, 13],
    [10, 12],
  ])
    grid.set(x + x0, y + b, cat.stripe);
  if (cat.armor) {
    grid.rect(7 + x0, 12 + b, 6, 2, cat.armor.plate);
    grid.rect(7 + x0, 12 + b, 6, 1, cat.armor.light);
    grid.rect(7 + x0, 14 + b, 6, 1, cat.armor.dark);
    grid.rect(7 + x0, 14 + b, 1, 1, shared.gold);
  } else {
    grid.rect(10 + x0, 12 + b, 1, 4, cat.strap);
    grid.set(10 + x0, 13 + b, shared.gold);
  }
}

function scarf(grid, cat, pose) {
  const b = pose.bob;
  const x0 = pose.lean;
  grid.rect(12 + x0, 11 + b, 6, 1, cat.scarf);
  grid.rect(12 + x0, 12 + b, 5, 1, cat.scarfDark);
  grid.rect(15 + x0, 12 + b, 2, 1, cat.scarf);
  // The loose end trails behind; four phases give a continuous flutter.
  const wave = [0, 1, 1, 0, -1, -1, 0, 1];
  for (let x = 11; x >= 6; x--) {
    const depth = 11 - x;
    const y =
      11 +
      b +
      pose.scarfLift * Math.ceil(depth / 3) +
      wave[(depth + pose.scarf * 2) % 8] * (depth > 1 ? 1 : 0);
    grid.set(x + x0, y, cat.scarf);
    if (x > 6) grid.set(x + x0, y + 1, cat.scarfDark);
  }
}

function badge(grid, cat, pose) {
  const b = pose.bob;
  const x = 13 + pose.lean;
  grid.rect(x, 13 + b, 3, 3, cat.badgeRing);
  grid.set(x + 1, 14 + b, cat.badgeCore);
  grid.set(x + 2, 15 + b, shared.goldDark);
}

function head(grid, cat, pose) {
  const y0 = pose.headBob + pose.bob;
  const x0 = pose.lean + (pose.streaks ? 1 : 0);
  const at = (x, y, color) => grid.set(x + x0, y + y0, color);
  const span = (y, from, to, color) =>
    grid.rect(from + x0, y + y0, to - from + 1, 1, color);
  // Ears first so the head silhouette overlaps their bases.
  const earTip = pose.ears === "back" ? 2 : 1;
  at(12, earTip, cat.fur);
  span(2, 12, 13, cat.fur);
  at(13, 2, shared.pink);
  at(18, earTip, cat.fur);
  span(2, 17, 18, cat.fur);
  at(17, 2, shared.pink);
  span(3, 12, 18, cat.fur);
  for (let y = 4; y <= 9; y++) span(y, 11, 19, cat.fur);
  span(10, 12, 18, cat.fur);
  span(11, 13, 17, cat.mask);
  span(3, 13, 16, cat.furLight);
  at(14, 3, cat.stripe);
  at(16, 3, cat.stripe);
  at(11, 7, cat.stripe);
  at(11, 8, cat.shade);
  at(12, 10, cat.shade);
  // Muzzle and cheeks.
  span(9, 13, 19, cat.mask);
  span(10, 13, 18, cat.mask);
  span(8, 15, 16, cat.mask);
  at(12, 9, shared.blush);
  at(19, 8, cat.mask);
  // Goggles strap with two lenses.
  span(4, 11, 19, cat.band);
  span(5, 11, 19, cat.band);
  for (const lens of [12, 16]) {
    const w = lens === 12 ? 2 : 3;
    grid.rect(lens + x0, 4 + y0, w, 2, cat.lens);
    at(lens, 4, shared.glint);
    at(lens + w - 1, 5, cat.frame);
  }
  if (cat.bandana) {
    span(5, 11, 19, cat.scarfDark);
    at(10, 4, cat.band);
    at(9, 5, cat.band);
    at(9, 3, cat.scarfDark);
  }
  if (cat.tuft) {
    at(15, 2, cat.mask);
    at(15, 1, cat.mask);
    at(16, 1, cat.mask);
    at(16, 0 + (pose.headBob < 0 ? 1 : 0), cat.mask);
  }
  // Eyes.
  for (const ex of [13, 17]) {
    if (pose.eyes === "open") {
      grid.rect(ex + x0, 7 + y0, 2, 2, shared.eye);
      at(ex, 7, shared.glint);
    } else if (pose.eyes === "blink") {
      grid.rect(ex + x0, 8 + y0, 2, 1, shared.eye);
    } else if (pose.eyes === "squint") {
      at(ex, 7, shared.eye);
      at(ex + 1, 8, shared.eye);
      at(ex, 8, shared.eye);
    } else {
      at(ex, 7, shared.eye);
      at(ex + 1, 8, shared.eye);
      at(ex + 1, 7, shared.eye);
      at(ex, 8, shared.eye);
    }
  }
  at(16, 9, shared.pink);
  if (pose.mouth === "open") {
    at(15, 10, shared.mouth);
    at(16, 10, shared.pink);
    at(17, 10, shared.mouth);
  } else {
    span(10, 15, 17, shared.mouth);
  }
}

function streaks(grid, pose) {
  if (!pose.streaks) return;
  for (const [y, from, to] of [
    [7, 0, 3],
    [11, 0, 2],
    [14, 1, 3],
  ])
    grid.rect(from, y + pose.bob, to - from + 1, 1, "#ffffffb0");
}

export function catFrame(id, pose) {
  const cat = CATS[id];
  const grid = new Grid(24, 24);
  // Far legs sit behind the body; near legs are drawn over it.
  legs(grid, cat, pose, true);
  tail(grid, cat, pose);
  body(grid, cat, pose);
  legs(grid, cat, pose, false);
  scarf(grid, cat, pose);
  head(grid, cat, pose);
  badge(grid, cat, pose);
  grid.outline(ink);
  if (pose.flash)
    grid.cells = grid.cells.map((c) =>
      c === null || c === ink ? c : "#fff3f0",
    );
  streaks(grid, pose);
  return gridPaths(grid, 2);
}

function run(frame) {
  return {
    ...basePose(),
    bob: GALLOP_BOB[frame],
    headBob: GALLOP_BOB[(frame + 7) % 8] - GALLOP_BOB[frame],
    legs: GALLOP[frame],
    tail: Math.round(Math.sin((frame * Math.PI) / 4) * 2) / 2,
    scarf: frame % 4,
    ears: GALLOP_BOB[frame] < 0 ? "back" : "up",
  };
}

export const CAT_CLIPS = [
  ["idle", 4, 6, true],
  ["run", 8, 14, true],
  ["jump", 2, 10, true],
  ["fall", 2, 10, true],
  ["land", 2, 16, false],
  ["dash", 2, 16, true],
  ["hit", 2, 12, true],
  ["defeat", 4, 8, false],
];

export function catPose(name, frame) {
  const base = basePose();
  switch (name) {
    case "idle":
      return {
        ...base,
        tail: [0, 1, 1, 0][frame],
        scarf: frame,
        eyes: frame === 2 ? "blink" : "open",
        bob: frame === 1 ? 0 : 0,
        ears: frame === 3 ? "back" : "up",
      };
    case "run":
      return run(frame);
    case "jump":
      return {
        ...base,
        legs: [
          [-2, 2],
          [-1, 2],
          [2, 2],
          [2, 1],
        ],
        tail: -1,
        tailLift: -1,
        scarf: frame * 2,
        scarfLift: 1,
        ears: "back",
      };
    case "fall":
      return {
        ...base,
        legs: [
          [-1, 0],
          [0, 0],
          [1, 0],
          [2, 0],
        ],
        tail: 1,
        tailLift: 1,
        scarf: frame * 2 + 1,
        scarfLift: -1,
      };
    case "land":
      return {
        ...base,
        bob: 1,
        headBob: frame === 0 ? 1 : 0,
        legs: [
          [-1, 0],
          [-1, 0],
          [1, 0],
          [1, 0],
        ],
        eyes: frame === 0 ? "blink" : "open",
        scarf: frame,
      };
    case "dash":
      return {
        ...base,
        bob: 0,
        legs: [
          [-3, 1],
          [-2, 1],
          [3, 1],
          [3, 0],
        ],
        tail: -2,
        tailLift: -2,
        scarf: frame * 2,
        ears: "back",
        streaks: true,
      };
    case "hit":
      return {
        ...base,
        lean: -1,
        eyes: "squint",
        mouth: "flat",
        ears: "back",
        flash: frame === 1,
      };
    case "defeat":
      return {
        ...base,
        bob: [0, 1, 2, 2][frame],
        headBob: [0, 0, 1, 1][frame],
        legs:
          frame < 2
            ? STAND
            : [
                [-2, 1],
                [-1, 1],
                [2, 1],
                [1, 1],
              ],
        eyes: frame === 0 ? "squint" : "dizzy",
        mouth: "flat",
        ears: "back",
        tail: -1,
        tailLift: -2,
      };
    default:
      throw new Error(`Unknown cat clip ${name}`);
  }
}
