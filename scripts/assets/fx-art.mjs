import { ink } from "./cat-palettes.mjs";
import { Grid, gridPaths } from "./pixel-grid.mjs";
import { POWER_ICONS } from "./scene-art.mjs";

const draw = (grid, scale = 2) => gridPaths(grid, scale);
const alpha = (hex, value) =>
  `${hex}${Math.round(Math.max(0, Math.min(1, value)) * 255)
    .toString(16)
    .padStart(2, "0")}`;

function ring(g, cx, cy, r, color, every = 1, offset = 0) {
  const steps = Math.max(12, Math.round(r * 7));
  for (let i = 0; i < steps; i++) {
    if (Math.floor((i + offset) / every) % 2 === 1 && every > 1) continue;
    const a = (i / steps) * Math.PI * 2;
    g.set(
      Math.floor(cx + Math.cos(a) * r),
      Math.floor(cy + Math.sin(a) * r),
      color,
    );
  }
}

export const ACTION_CLIPS = ["dash", "hit", "landing", "pickup"];
export function actionEffect(name, i) {
  const g = new Grid(16, 16);
  const fade = 1 - i / 6;
  if (name === "landing")
    for (const side of [-1, 1]) {
      const r = 2.4 - i * 0.3;
      if (r > 0.4)
        g.ellipse(
          8 + side * (2 + i * 1.2),
          14 - i * 0.3,
          r * 1.3,
          r,
          alpha("#f6ecd9", fade),
        );
      if (r > 1.2)
        g.ellipse(
          8 + side * (2 + i * 1.2),
          13.6 - i * 0.3,
          r * 0.6,
          r * 0.5,
          alpha("#ffffff", fade),
        );
    }
  if (name === "dash") {
    const r = 3.2 - i * 0.45;
    if (r > 0.4)
      g.ellipse(11 - i * 1.4, 12, r * 1.3, r, alpha("#f6ecd9", fade));
    for (const y of [5, 9])
      g.rect(Math.max(0, 6 - i * 2), y, 4, 1, alpha("#ffffff", fade));
  }
  if (name === "pickup") {
    if (i < 2) g.ellipse(8, 8, 2.5 - i, 2.5 - i, "#ffffff");
    const r = 2 + i * 1.2;
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      const color = k % 2 ? alpha("#ffe45c", fade) : alpha("#ffffff", fade);
      g.set(
        Math.round(8 + Math.cos(a) * r),
        Math.round(8 + Math.sin(a) * r),
        color,
      );
    }
  }
  if (name === "hit") {
    const r = 2 + i * 1.1;
    for (let k = 0; k < 6; k++) {
      const a = (k * Math.PI) / 3 + 0.4;
      g.line(
        8 + Math.cos(a) * (r - 2),
        8 + Math.sin(a) * (r - 2),
        8 + Math.cos(a) * r,
        8 + Math.sin(a) * r,
        alpha(k % 2 ? "#ff5a5a" : "#ffffff", fade),
      );
    }
  }
  return draw(g);
}

export const POWER_CLIPS = [
  "double-jump",
  "extra-dash",
  "magnet",
  "shield-active",
  "shield-contact",
];
export function powerEffect(name, i) {
  const g = new Grid(32, 32);
  const c = 16;
  if (name === "magnet") {
    for (const r of [13 - (i % 6) * 2, 13 - ((i + 3) % 6) * 2])
      if (r > 3) ring(g, c, c, r, alpha("#ff7a86", 0.45 + (13 - r) / 26), 3, i);
  }
  if (name === "shield-active") {
    g.ellipse(c, c, 13, 13, "#5fd2ff26");
    ring(g, c, c, 13, "#9be8ff");
    ring(g, c, c, 12, "#5fd2ff80");
    const a = (i / 6) * Math.PI * 2 - 2.4;
    g.rect(
      Math.round(c + Math.cos(a) * 10),
      Math.round(c + Math.sin(a) * 10),
      2,
      2,
      "#ffffff",
    );
    g.set(
      Math.round(c + Math.cos(a + 0.4) * 10),
      Math.round(c + Math.sin(a + 0.4) * 10),
      "#ffffffa0",
    );
  }
  if (name === "shield-contact") {
    const r = 13 + i * 1.4;
    ring(g, c, c, Math.min(15, r), alpha("#9be8ff", 1 - i / 6), 2, i);
    for (let k = 0; k < 6; k++) {
      const a = (k * Math.PI) / 3;
      g.rect(
        Math.round(c + Math.cos(a) * (6 + i * 1.5)),
        Math.round(c + Math.sin(a) * (6 + i * 1.5)),
        2,
        2,
        alpha("#ffffff", 1 - i / 6),
      );
    }
  }
  if (name === "double-jump") {
    const w = 5 + i * 1.6;
    for (const side of [-1, 1]) {
      g.ellipse(
        c + side * w * 0.6,
        26 - i * 0.2,
        w * 0.5,
        1.6,
        alpha("#d9c2ff", 0.9 - i / 7),
      );
      g.set(
        Math.round(c + side * (w + 1)),
        24 - (i % 3),
        alpha("#ffffff", 0.9 - i / 7),
      );
    }
    ring(g, c, 25, 2 + i, alpha("#b98cff", 0.7 - i / 9), 2);
  }
  if (name === "extra-dash")
    for (let k = 0; k < 3; k++) {
      const x = 6 - k * 3 + ((i * 2) % 4);
      const fade = 0.9 - k * 0.25;
      g.stamp(x, 11, ["o...", ".o..", "..o.", ".o..", "o..."], {
        o: alpha("#ffae3c", fade),
      });
      g.stamp(x + 1, 11, ["o...", ".o..", "..o.", ".o..", "o..."], {
        o: alpha("#ffe08a", fade),
      });
    }
  return draw(g);
}

const CREAM = {
  c: "#fff4d6",
  g: "#ffc531",
  d: "#c9851a",
  k: ink,
  w: "#ffffff",
};
const HUD_ICONS = {
  back: [
    "...c......",
    "..cc......",
    ".cccccccc.",
    "cccccccccc",
    ".cccccccc.",
    "..cc......",
    "...c......",
  ],
  left: ["....cc", "...ccc", "..cccc", ".ccccc", "..cccc", "...ccc", "....cc"],
  right: ["cc....", "ccc...", "cccc..", "ccccc.", "cccc..", "ccc...", "cc...."],
  jump: [
    "....cc....",
    "...cccc...",
    "..cccccc..",
    ".cccccccc.",
    "...cccc...",
    "...cccc...",
    "...cccc...",
  ],
  dash: [
    "c...c.....",
    "cc..cc....",
    "ccc.ccc...",
    "cccccccc..",
    "ccc.ccc...",
    "cc..cc....",
    "c...c.....",
  ],
  boost: [
    ".....cc",
    "....cc.",
    "...cc..",
    "..ccccc",
    "....cc.",
    "...cc..",
    "..cc...",
    ".cc....",
  ],
  "cash-out": [
    "..gggg..",
    ".gddddg.",
    "gdggggdg",
    "gdgddgdg",
    "gdggggdg",
    "gdddddg.",
    ".gggggg.",
    "..gggg..",
  ],
  lock: [
    "..cccc..",
    ".c....c.",
    ".c....c.",
    "cccccccc",
    "cccddccc",
    "cccddccc",
    "cccccccc",
  ],
  pause: ["cc..cc", "cc..cc", "cc..cc", "cc..cc", "cc..cc", "cc..cc"],
  sound: [
    "...c....",
    "..cc..c.",
    "cccc.c.c",
    "cccc.c.c",
    "cccc.c.c",
    "..cc..c.",
    "...c....",
  ],
  mute: [
    "...c....",
    "..cc....",
    "cccc.c.c",
    "cccc..c.",
    "cccc.c.c",
    "..cc....",
    "...c....",
  ],
  "rotate-device": [
    "cccc....",
    "c..c....",
    "c..c.ccc",
    "c..c...c",
    "c..c..cc",
    "cccc.c.c",
    ".....c..",
    "....ccc.",
  ],
  status: [
    "..cccc..",
    ".cc..cc.",
    "cc.cc.cc",
    "cc.cc.cc",
    "cc.cc.cc",
    "cccccccc",
    "cc.cc.cc",
    ".cccccc.",
  ],
};
export const HUD_ORDER = [
  "back",
  "boost",
  "cash-out",
  "dash",
  "double-jump",
  "extra-dash",
  "jump",
  "left",
  "lock",
  "magnet",
  "mute",
  "pause",
  "right",
  "rotate-device",
  "shield",
  "sound",
  "status",
];
export function hudIcon(name) {
  const g = new Grid(12, 12);
  const power = POWER_ICONS[name];
  const rows = power ?? HUD_ICONS[name];
  const w = Math.max(...rows.map((r) => r.length));
  const palette = power
    ? { r: "#ff4d5a", w: "#ffffff", b: "#3a7bff", y: "#ffd21f" }
    : CREAM;
  g.stamp(
    Math.floor((12 - w) / 2),
    Math.floor((12 - rows.length) / 2),
    rows,
    palette,
  );
  g.outline(ink);
  return draw(g);
}

export function capsuleLid() {
  const g = new Grid(40, 40);
  for (let y = 4; y <= 20; y++)
    for (let x = 6; x <= 33; x++) {
      const dx = (x + 0.5 - 20) / 14;
      const dy = (y + 0.5 - 20.5) / 16;
      if (dx * dx + dy * dy <= 1) g.set(x, y, "#8ad6a4");
    }
  g.ellipse(14, 11, 3.5, 4.5, "#cdf3d4");
  g.rect(12, 8, 2, 2, "#ffffff");
  for (let y = 6; y <= 20; y++)
    for (let x = 26; x <= 33; x++)
      if (g.get(x, y) === "#8ad6a4") g.set(x, y, "#5bae86");
  g.outline(ink);
  return draw(g, 4);
}

export function capsuleBase() {
  const g = new Grid(40, 40);
  for (let y = 19; y <= 34; y++)
    for (let x = 6; x <= 33; x++) {
      const dx = (x + 0.5 - 20) / 14;
      const dy = (y + 0.5 - 18.5) / 16;
      if (dx * dx + dy * dy <= 1) g.set(x, y, y > 28 ? "#234645" : "#355f60");
    }
  g.rect(6, 18, 28, 3, "#ffc531");
  g.rect(6, 20, 28, 1, "#c9851a");
  g.ellipse(20, 20, 4, 4, "#ffdc88");
  g.stamp(18, 18, [".d.d.", "ddddd", ".ddd."], { d: "#89511e" });
  g.outline(ink);
  return draw(g, 4);
}

export function upgradeItem() {
  const g = new Grid(16, 16);
  g.ellipse(8, 8, 7, 7, "#c9851a");
  g.ellipse(7.6, 7.6, 6.2, 6.2, "#ffc531");
  g.ellipse(6, 5.5, 3, 2.4, "#ffe58a");
  g.rect(7, 3, 2, 1, "#ffffff");
  g.rect(6, 4, 4, 1, "#ffffff");
  g.rect(5, 5, 6, 1, "#ffffff");
  g.rect(7, 6, 2, 6, "#ffffff");
  g.rect(9, 6, 1, 6, "#ffe58a");
  g.outline(ink);
  return draw(g);
}
