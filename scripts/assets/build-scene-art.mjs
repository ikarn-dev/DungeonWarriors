import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseAssetManifest } from "../../apps/web/lib/game/assets.ts";

const ink = "#142b2b";
const cream = "#fff1cc";
const leaf = "#8cbe61";
const aqua = "#7de3db";
const gold = "#ffcc59";
const path = (d, fill, stroke = "none") =>
  `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="1.5" stroke-linejoin="round"/>`;
const rect = (x, y, w, h, fill) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;
const oval = (x, y, rx, ry, fill, stroke = "none") =>
  `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;
const shift = (x, y, content) =>
  `<g transform="translate(${x} ${y})">${content}</g>`;
const clip = (name, count, fps, loop = false) => ({ name, count, fps, loop });
const paw =
  oval(0, 2, 3, 2.3, "#89511e") +
  oval(-3.5, -1.1, 1, 1.4, "#89511e") +
  oval(0, -3, 1, 1.4, "#89511e") +
  oval(3.5, -1.1, 1, 1.4, "#89511e");

const cats = {
  collector: {
    fur: "#e69a54",
    shade: "#a65349",
    eyes: "#183c45",
    mask: "#ffdb9f",
  },
  acrobat: {
    fur: "#bc9edb",
    shade: "#695188",
    eyes: "#20534d",
    mask: "#edd7f4",
  },
  guardian: {
    fur: "#7faaa5",
    shade: "#497b79",
    eyes: "#f4c963",
    mask: "#d6e8d4",
  },
  sprinter: {
    fur: "#f4c65d",
    shade: "#bd693e",
    eyes: "#193b59",
    mask: "#fff0b0",
  },
};

function catArt(id, motion = "idle", frame = 0) {
  const { fur, shade, eyes, mask } = cats[id];
  const stride =
    motion === "run"
      ? [0, 2, 4, 2, 0, -2, -4, -2][frame]
      : motion === "dash"
        ? 4
        : 0;
  const lift =
    motion === "jump"
      ? -3
      : motion === "fall"
        ? -1
        : motion === "run"
          ? -Math.abs(stride) / 2
          : motion === "idle"
            ? [0, 0, -1, 0][frame]
            : 0;
  const snooze = motion === "defeat" || (motion === "idle" && frame === 3);
  return (
    oval(23, 40, 16, 3, "#14333140") +
    shift(
      0,
      lift,
      [
        path("M19 33Q6 34 7 25Q4 23 3 27Q3 38 19 38Z", shade, ink),
        path("M11 32Q18 24 28 28L34 34L29 38H16Z", fur, ink),
        oval(17 + stride, 37, 4, 2.5, shade, ink),
        oval(28 - stride, 37, 4.5, 2.5, mask, ink),
        path(
          `M19 26Q14 ${25 - stride} 9 26L12 32L7 34Q18 34 23 31Z`,
          "#3f8eac",
          ink,
        ),
        path(
          "M17 28L17 12L19 6L27 12L36 11L42 6L42 21Q45 24 42 29Q38 34 30 34Q21 34 17 28Z",
          fur,
          ink,
        ),
        path("M20 10L23 14H20Z M39 11L36 15H39Z", "#f3a6a5"),
        path("M21 26Q23 21 31 24Q35 21 41 24L40 29Q34 34 26 31Z", mask),
        path(
          "M19 19Q25 15 31 19L38 18L42 20L40 23L35 23L32 21L30 23H22Z",
          "#4288a4",
          ink,
        ),
        path("M23 19L26 18L28 20L25 21Z M35 19L38 18L40 19L37 20Z", aqua),
        snooze
          ? path("M24 25h4 M36 25h4", "none", ink)
          : oval(27, 25, 1, 1.3, eyes) + oval(38.5, 25, 1, 1.3, eyes),
        path("M31 25L35 25L33 27Z", "#a35150"),
        path("M30 28Q33 32 36 28", "none", ink),
        path("M21 31L27 34L26 37L19 34Z", "#5cbed8", ink),
      ].join(""),
    )
  );
}

function coin(frame) {
  const phase = (frame * Math.PI) / 8;
  const half = Math.max(0.6, 10 * Math.abs(Math.cos(phase)));
  const offset = 2.25 * Math.sin(phase);
  return (
    oval(16 - offset, 16, half + 0.9, 12, "#99521d", "#552e24") +
    oval(16 + offset, 16, half, 11.4, "#ec9c34", "#552e24") +
    (half > 1
      ? oval(16 + offset, 16, Math.max(0.4, half - 1.5), 8.8, gold, "#ad6421")
      : "") +
    (half > 3
      ? `<g transform="translate(${16 + offset} 16) scale(${half / 10} 1)">${paw}</g>`
      : "")
  );
}

const icons = {
  "double-jump": "M6 13L12 6L18 13H14V20H10V13Z M6 7L12 1L18 7",
  "extra-dash": "M3 7H11L15 12L11 17H3L7 12Z M12 6H16L22 12L16 18H12L16 12Z",
  magnet: "M4 4H9V14Q12 19 15 14V4H20V15Q20 22 12 22Q4 22 4 15Z",
  shield: "M12 2L21 6V13Q19 20 12 23Q5 20 3 13V6Z M8 12L11 16L17 9",
  jump: "M5 13L12 4L19 13H15V21H9V13Z",
  "cash-out": "M4 3H13V7H8V17H13V21H4Z M11 10H16V6L22 12L16 18V14H11Z",
  pause: "M5 4H10V20H5Z M14 4H19V20H14Z",
  sound: "M4 9H8L14 4V20L8 15H4Z M17 8Q22 12 17 16",
  mute: "M4 9H8L14 4V20L8 15H4Z M17 9L22 15M22 9L17 15",
  "rotate-device": "M5 3H13V17H5Z M9 21H21V12H16",
  status: "M12 2L22 12L12 22L2 12Z M12 7V13",
  boost: "M10 2H16L13 9H20L8 22L10 14H4Z",
};
icons.dash = icons["extra-dash"];

function forest(distance) {
  const fill = distance === "near" ? "#234f43" : "#3b6759";
  const detail = distance === "near" ? "#2c5b49" : "#4e7965";
  const ground = distance === "near" ? 495 : 431;
  return (
    path(
      `M0 ${ground}Q120 ${ground - 65} 230 ${ground - 22}T460 ${ground - 24}T700 ${ground - 5}T960 ${ground}V540H0Z`,
      fill,
    ) +
    Array.from({ length: 12 }, (_, i) => {
      const size = distance === "near" ? 78 : 60;
      return `<g transform="translate(${24 + i * 82} ${ground - 8 - (i % 4) * 10}) scale(${size / 45})">${path("M-17 8L0-31L17 8H10L20 24H-20L-10 8Z", detail)}${rect(-2, 22, 4, 10, fill)}</g>`;
    }).join("")
  );
}

const terrain =
  path("M0 0H32V32H0Z", "#34463a") +
  path(
    "M0 5H11V7H0Z M18 8H32V10H18Z M7 14H17V17H7Z M23 24H32V26H23Z",
    "#52644a",
  ) +
  path("M0 20H8V23H0Z M14 27H25V30H14Z", "#273d37");
const grass =
  path("M0 0H32V5H26V7H21V5H11V7H5V5H0Z", leaf) +
  path("M0 0H32V2H0Z", "#bfda7b");

const directory = fileURLToPath(
  new URL("../../apps/web/public/game-assets/v1/", import.meta.url),
);
const check = process.argv.includes("--check");
if (!check) mkdirSync(directory, { recursive: true });
function output(file, bytes) {
  const target = `${directory}${file}`;
  if (check) {
    if (readFileSync(target, "utf8") !== bytes)
      throw new Error(`Stale artwork: ${file}`);
  } else writeFileSync(target, bytes);
}

const assets = [];
function sheet(
  id,
  w,
  h,
  render,
  { clips = [], anchor = { x: 0, y: 0 }, repeat = "none" } = {},
) {
  let frames = 0;
  const content =
    clips.length === 0
      ? render("", 0)
      : clips
          .map((entry) => {
            entry.start = frames;
            return Array.from({ length: entry.count }, (_, i) =>
              shift(w * frames++, 0, render(entry.name, i)),
            ).join("");
          })
          .join("");
  frames = Math.max(1, frames);
  const width = w * frames;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}" viewBox="0 0 ${width} ${h}">${content}</svg>\n`;
  output(`${id}.svg`, svg);
  assets.push({
    id,
    path: `/game-assets/v1/${id}.svg`,
    sha256: createHash("sha256").update(svg).digest("hex"),
    bytes: Buffer.byteLength(svg),
    width,
    height: h,
    frameWidth: w,
    frameHeight: h,
    frames,
    anchor,
    repeat,
    reducedMotionFrame: 0,
    clips: [...clips].sort((a, b) => a.name.localeCompare(b.name)),
  });
}
function still(id, w, h, svg, options) {
  sheet(id, w, h, () => svg, options);
}

for (const id of Object.keys(cats)) {
  sheet(`cat-${id}`, 48, 48, (name, i) => catArt(id, name, i), {
    anchor: { x: 24, y: 40 },
    clips: [
      clip("idle", 4, 6, true),
      clip("run", 8, 12, true),
      clip("jump", 2, 10),
      clip("fall", 2, 10),
      clip("dash", 2, 16),
      clip("hit", 2, 10),
      clip("defeat", 4, 10),
    ],
  });
  still(
    `portrait-${id}`,
    96,
    96,
    `<g transform="translate(-9 -7) scale(2.25)">${catArt(id)}</g>`,
  );
}
sheet("coin-spin", 32, 32, (_, i) => coin(i), {
  clips: [clip("spin", 16, 16, true)],
  anchor: { x: 16, y: 28 },
});
still("coin-shadow", 16, 6, oval(8, 3, 7, 2, "#162b2b78"), {
  anchor: { x: 8, y: 3 },
});
still("terrain-fill", 32, 32, terrain, { repeat: "xy" });
still("terrain-grass", 32, 8, grass, { repeat: "x" });
still("terrain-left", 32, 32, terrain + rect(0, 0, 4, "#1d382f"));
still("terrain-right", 32, 32, terrain + rect(28, 0, 4, "#1d382f"));
still("terrain-underside", 32, 32, terrain + rect(0, 27, 32, 5, "#1d382f"), {
  repeat: "x",
});
still(
  "bridge-deck",
  32,
  16,
  rect(0, 0, 32, 16, "#946346") +
    path("M0 0H32V3H0Z M14 3H17V16H14Z", "#dca66f"),
  { repeat: "x" },
);
for (const [name, x] of [
  ["left", 4],
  ["right", 21],
  ["support", 12],
]) {
  still(
    `bridge-${name}`,
    32,
    32,
    rect(x, 0, 8, 32, "#6b483b") + rect(x, 3, 3, 26, "#a87551"),
  );
}
still(
  "water-fill",
  32,
  32,
  rect(0, 0, 32, 32, "#2b6980") + rect(9, 14, 9, 2, "#438b96"),
  { repeat: "xy" },
);
sheet(
  "water-surface",
  32,
  32,
  (_, i) =>
    path(`M0 8Q8 ${2 + i} 16 8T32 8V32H0Z`, "#2b6980") +
    path(`M0 8Q8 ${2 + i} 16 8T32 8`, "none", aqua),
  { clips: [clip("wave", 4, 6, true)], repeat: "x" },
);
still(
  "hazard-obstacle",
  32,
  32,
  path("M1 30L8 14L14 22L20 5L30 30Z", "#a05055", ink) +
    path("M20 8L23 18L20 15L16 23Z", "#f39a74"),
  { anchor: { x: 16, y: 30 } },
);
still(
  "hazard-pit-edge",
  32,
  32,
  path("M0 6H26L19 12L27 16L17 23L20 31H0Z", "#814c54", ink),
);
still(
  "star",
  24,
  24,
  path(
    "M12 2L15 8L22 9L17 14L19 22L12 18L5 22L7 14L2 9L9 8Z",
    "#fff09a",
    "#875131",
  ),
  { anchor: { x: 12, y: 12 } },
);
for (const key of ["magnet", "double-jump", "shield", "extra-dash"]) {
  still(
    `booster-${key}`,
    24,
    24,
    oval(12, 12, 11, 11, "#193e46", "#85bab0") + path(icons[key], aqua, ink),
  );
}
sheet("hud-controls", 24, 24, (name) => path(icons[name], cream, "#27514e"), {
  clips: Object.keys(icons).map((name) => clip(name, 1, 1)),
});
for (const [id, names, color] of [
  ["effects-actions", ["dash", "hit", "landing", "pickup"], gold],
  [
    "effects-powers",
    ["double-jump", "extra-dash", "magnet", "shield-active", "shield-contact"],
    aqua,
  ],
]) {
  const size = id === "effects-powers" ? 64 : 32;
  sheet(
    id,
    size,
    size,
    (name, i) => {
      const center = size / 2;
      const radius = 4 + i * (size / 12);
      return `<g opacity="${1 - i / 5}">${oval(center, center, radius, radius * 0.6, "none", color)}${icons[name] ? shift(center - 12, center - 12, path(icons[name], color)) : ""}${oval(center + radius, center - 2, 2, 2, color)}</g>`;
    },
    { clips: names.map((name) => clip(name, 4, 12)) },
  );
}
still(
  "background-sky",
  960,
  540,
  rect(0, 0, 960, 540, "#7da891") +
    rect(0, 297, 960, 243, "#9ab88c") +
    oval(692, 143, 58, 58, "#eddda3") +
    path(
      "M65 160H152V168H183V175H48V169H65Z M355 70H430V78H467V84H335V79H355Z",
      "#b4c49b",
    ),
  { repeat: "x" },
);
still("background-forest-near", 960, 540, forest("near"), { repeat: "x" });
still("background-forest-far", 960, 540, forest("far"), { repeat: "x" });
still(
  "capsule-lid",
  160,
  160,
  path("M29 80Q26 42 47 28Q80 6 113 28Q134 42 131 80Z", "#8ad6a4", ink) +
    path("M38 74Q41 40 67 34Q51 45 50 69Z", "#cdebb5") +
    path("M78 25Q119 23 124 69L113 67Q111 42 95 34Z", "#55a288"),
);
still(
  "capsule-base",
  160,
  160,
  path("M29 80H131V98Q124 130 80 137Q36 130 29 98Z", "#355f60", ink) +
    path("M37 98H122Q108 119 80 124Q53 121 37 98Z", "#234645") +
    path("M28 73H132V87H28Z", "#e5bd68", ink) +
    oval(80, 81, 15, 15, "#ffdc88", ink) +
    shift(80, 81, paw),
);
still(
  "upgrade-item",
  32,
  32,
  path("M16 2L28 9V23L16 30L4 23V9Z", "#e5b96c", ink) +
    path("M9 16L16 9L23 16H19V23H13V16Z", "#794424"),
);

assets.sort((a, b) => a.id.localeCompare(b.id));
const manifest = parseAssetManifest({ schemaVersion: 1, version: 1, assets });
output("manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
