// Warrior cats after the reference avatars in apps/web/public/cats_avatars
// (pip-spearpaw, rosie-bladewhisk, sir-bastion, bjorn-ironclaw; 2026-11-24).
// 128 × 128 canvas, feet on y = 120, facing right. Polished steel with gold
// trim, cloth capes and layered fur; a thin dark edge keeps each silhouette
// readable over the dark catacombs. The weapon is a separate file so the game
// can swing it. Only the SVG elements check-assets.mjs allows are used.
export const EDGE = "#1b1420";
export const edge = (w = 1.4) =>
  `stroke="${EDGE}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`;

export const CATS = {
  collector: {
    fur: ["#f6b56a", "#e48a3c", "#b9601f"],
    stripe: "#a94f18",
    muzzle: "#fff1df",
    ear: "#f2a08f",
    iris: ["#ffe27a", "#e2a512"],
    cape: ["#b8333a", "#7d1a22"],
    weapon: "spear",
  },
  acrobat: {
    fur: ["#ffffff", "#f5f1f1", "#d9d0d6"],
    stripe: null,
    muzzle: "#ffffff",
    ear: "#f4b0b4",
    iris: ["#c8dcf2", "#6d8fb8"],
    cape: ["#e3909f", "#b5606f"],
    weapon: "longsword",
  },
  guardian: {
    fur: ["#d7d6da", "#a8a6ad", "#77757d"],
    stripe: "#4f4d56",
    muzzle: "#f4f2f5",
    ear: "#e99a9a",
    iris: ["#c9f26a", "#5d9a12"],
    cape: ["#cc2a33", "#86141c"],
    weapon: "sword",
  },
  sprinter: {
    fur: ["#e2c095", "#b98d5e", "#86613a"],
    stripe: "#5e4127",
    muzzle: "#f6ead8",
    ear: "#e79a8c",
    iris: ["#ffd25a", "#c27a08"],
    cape: ["#a8423a", "#6e2420"],
    weapon: "axe",
  },
};
export const WEAPON_PIVOT = {
  spear: { x: 48, y: 62 },
  longsword: { x: 48, y: 70 },
  sword: { x: 48, y: 72 },
  axe: { x: 40, y: 76 },
};
// Where the weapon hand sits on the body canvas.
export const HAND = { x: 93, y: 86 };

export function grad(id, stops, angle = 90) {
  const turn = angle ? ` gradientTransform="rotate(${angle})"` : "";
  return `<linearGradient id="${id}"${turn}>${stops
    .map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`)
    .join("")}</linearGradient>`;
}
export const STEEL = [
  [0, "#5a6170"],
  [0.22, "#c6ccd8"],
  [0.4, "#ffffff"],
  [0.55, "#a3abba"],
  [0.78, "#e4e8ef"],
  [1, "#6a7181"],
];
export const GOLD = [
  [0, "#7a5014"],
  [0.3, "#e9bd55"],
  [0.5, "#fff0b8"],
  [0.72, "#c38a26"],
  [1, "#6d4610"],
];
export function defs(cat) {
  const [light, mid, dark] = cat.fur;
  return `<defs>${grad("fur", [
    [0, light],
    [0.6, mid],
    [1, dark],
  ])}${grad("steel", STEEL, 0)}${grad("steelv", STEEL)}${grad("gold", GOLD, 0)}${grad(
    "goldv",
    GOLD,
  )}${grad("cape", [
    [0, cat.cape[0]],
    [1, cat.cape[1]],
  ])}${grad("iris", [
    [0, cat.iris[1]],
    [0.55, cat.iris[0]],
    [1, cat.iris[0]],
  ])}${grad("leather", [
    [0, "#9a5a32"],
    [1, "#5c3018"],
  ])}${grad(
    "wood",
    [
      [0, "#8a5a32"],
      [0.5, "#a8703f"],
      [1, "#6a4022"],
    ],
    0,
  )}${grad(
    "iron",
    [
      [0, "#3e434e"],
      [0.4, "#9aa1ae"],
      [0.6, "#c6ccd6"],
      [1, "#4b505c"],
    ],
    0,
  )}</defs>`;
}

// Cape behind the body, with folds and an optional gold hem.
function cape(hem) {
  return `<path d="M40 63 C29 78 22 98 19 116 C30 120 46 117 60 119 C76 117 94 121 106 115 C101 97 94 78 85 63 Z" fill="url(#cape)" ${edge()}/><path d="M33 84 C30 96 28 106 27 115 M47 72 C44 90 43 104 44 117 M86 74 C90 90 93 104 96 116" stroke="#00000033" stroke-width="2.4" fill="none" stroke-linecap="round"/>${
    hem
      ? `<path d="M20 114 C30 118 46 116 60 118 C76 116 94 120 105 114" stroke="url(#gold)" stroke-width="2.2" fill="none"/>`
      : ""
  }`;
}
function legs(trim) {
  const knee = (x) =>
    `<path d="M${x} 99 h14 v12 c0 2 -1 3 -3 3 h-8 c-2 0 -3 -1 -3 -3 z" fill="url(#steel)" ${edge()}/><path d="M${x - 1} 99 c2 -4 14 -4 16 0 l-1 4 c-4 -2 -10 -2 -14 0 z" fill="url(#steelv)" ${edge(1.1)}/>${
      trim
        ? `<path d="M${x} 103 h14" stroke="url(#gold)" stroke-width="1.6"/>`
        : ""
    }<path d="M${x - 3} 114 c0 -2 2 -3 4 -3 h12 c3 0 5 2 5 5 v2 c0 1 -1 2 -2 2 h-17 c-1 0 -2 -1 -2 -2 z" fill="url(#steelv)" ${edge()}/><path d="M${x + 1} 116 h12" stroke="#ffffff" stroke-width="0.9" opacity="0.7"/>`;
  return knee(46) + knee(65);
}
function plateTorso(trim) {
  return `<path d="M42 70 C42 64 50 61 62 61 C74 61 82 64 82 70 L84 96 C84 101 75 104 62 104 C49 104 40 101 40 96 Z" fill="url(#steel)" ${edge()}/><path d="M62 63 V100" stroke="#7d8595" stroke-width="1.2"/><path d="M47 68 C50 65 56 64 59 65 L57 92 C52 91 48 88 47 84 Z" fill="#ffffff" opacity="0.32"/><path d="M45 80 C52 84 72 84 79 80 M46 88 C53 92 71 92 78 88" stroke="#6e7686" stroke-width="1" fill="none" opacity="0.7"/>${
    trim
      ? `<path d="M43 70 C48 66 56 64 62 64 C68 64 76 66 81 70" stroke="url(#gold)" stroke-width="1.8" fill="none"/><path d="M56 70 L62 76 L68 70" stroke="url(#gold)" stroke-width="1.6" fill="none"/>`
      : ""
  }`;
}
function scaleTorso() {
  const rows = [];
  for (let row = 0; row < 6; row++)
    for (let x = 44 + (row % 2) * 3.5; x < 80; x += 7)
      rows.push(`M${x} ${68 + row * 5} q3.5 5 7 0`);
  return `<path d="M42 70 C42 64 50 61 62 61 C74 61 82 64 82 70 L84 96 C84 101 75 104 62 104 C49 104 40 101 40 96 Z" fill="url(#iron)" ${edge()}/><path d="${rows.join("")}" fill="none" stroke="#2f343d" stroke-width="1"/><path d="${rows.join("")}" fill="none" stroke="#e3e7ee" stroke-width="0.6" opacity="0.5" transform="translate(0 -0.8)"/>`;
}
function tassets(kind) {
  if (kind === "scale")
    return `<path d="M42 96 L40 108 L52 110 L54 98 Z M70 98 L72 110 L84 108 L82 96 Z" fill="url(#iron)" ${edge()}/>`;
  return `<path d="M42 96 L40 108 C44 110 49 110 53 109 L54 98 Z M70 98 L71 109 C75 110 80 110 84 108 L82 96 Z" fill="url(#steelv)" ${edge()}/><path d="M41 106 C44 108 49 108 53 107 M71 107 C75 108 80 108 83 106" stroke="url(#gold)" stroke-width="1.4" fill="none"/>`;
}
function belt() {
  return `<path d="M40 92 C48 96 76 96 84 92 L84 99 C76 103 48 103 40 99 Z" fill="url(#leather)" ${edge()}/><rect x="56.5" y="92.5" width="11" height="9" rx="1.6" fill="none" stroke="url(#gold)" stroke-width="2.4"/><path d="M62 95 v4" stroke="url(#gold)" stroke-width="1.6"/>`;
}
function pauldrons() {
  const one = (cx, flip) =>
    `<path d="M${cx - 12 * flip} 70 C${cx - 12 * flip} 62 ${cx + 6 * flip} 60 ${cx + 12 * flip} 68 C${cx + 8 * flip} 72 ${cx - 4 * flip} 74 ${cx - 12 * flip} 70 Z" fill="url(#steelv)" ${edge()}/><path d="M${cx - 10 * flip} 74 C${cx - 8 * flip} 69 ${cx + 6 * flip} 68 ${cx + 11 * flip} 73 C${cx + 7 * flip} 77 ${cx - 4 * flip} 78 ${cx - 10 * flip} 74 Z" fill="url(#steelv)" ${edge(1.1)}/><path d="M${cx - 11 * flip} 69.5 C${cx - 4 * flip} 72.5 ${cx + 7 * flip} 71.5 ${cx + 11 * flip} 67.5" stroke="url(#gold)" stroke-width="1.3" fill="none"/>`;
  return one(39, 1) + one(85, -1);
}
export function gripHand(paw, at = HAND) {
  return paw
    ? `<ellipse cx="${at.x}" cy="${at.y}" rx="6.2" ry="6.8" fill="${paw}" ${edge()}/><path d="M${at.x - 3} ${at.y - 4} v3 M${at.x} ${at.y - 5} v3 M${at.x + 3} ${at.y - 4} v3" stroke="#00000040" stroke-width="1"/>`
    : `<rect x="${at.x - 6}" y="${at.y - 6}" width="12" height="12" rx="4" fill="url(#steelv)" ${edge()}/><path d="M${at.x - 5} ${at.y - 2} h10 M${at.x - 5} ${at.y + 1.5} h10" stroke="#6e7686" stroke-width="0.9"/>`;
}
function weaponArm(paw) {
  const hand = gripHand(paw);
  return `<path d="M84 74 C90 76 93 80 93 85" stroke="${EDGE}" stroke-width="10.4" stroke-linecap="round" fill="none"/><path d="M84 74 C90 76 93 80 93 85" stroke="url(#steelv)" stroke-width="8" stroke-linecap="round" fill="none"/><path d="M88 79.5 l6 -1.4" stroke="url(#gold)" stroke-width="1.4"/>${hand}`;
}
export function shield(kind) {
  if (kind === "oval")
    return `<ellipse cx="27" cy="88" rx="19" ry="25" fill="url(#gold)" ${edge()}/><ellipse cx="27" cy="88" rx="15.5" ry="21.5" fill="url(#steel)"/><path d="M27 67 V109 M12 88 H42" stroke="url(#gold)" stroke-width="2"/><path d="M27 70 l-3 6 h6 z M27 106 l-3 -6 h6 z M14 88 l6 -3 v6 z M40 88 l-6 -3 v6 z" fill="url(#gold)"/><circle cx="27" cy="88" r="5.5" fill="url(#gold)" ${edge(1.1)}/><circle cx="25.6" cy="86.4" r="1.8" fill="#fff6d0" opacity="0.9"/>${[
      [27, 64.5],
      [38.5, 69],
      [44, 80],
      [44, 96],
      [38.5, 107],
      [27, 111.5],
      [15.5, 107],
      [10, 96],
      [10, 80],
      [15.5, 69],
    ]
      .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.1" fill="#6d4610"/>`)
      .join("")}`;
  if (kind === "round")
    return `<circle cx="27" cy="89" r="22" fill="url(#gold)" ${edge()}/><circle cx="27" cy="89" r="17" fill="url(#steel)" stroke="#7a5014" stroke-width="0.8"/><path d="M14 80 C20 74 32 73 38 78" stroke="#ffffff" stroke-width="3" opacity="0.55" fill="none" stroke-linecap="round"/>${[
      0, 45, 90, 135, 180, 225, 270, 315,
    ]
      .map((a) => {
        const r = 19.5;
        const x = 27 + r * Math.cos((a * Math.PI) / 180);
        const y = 89 + r * Math.sin((a * Math.PI) / 180);
        return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.5" fill="url(#goldv)" stroke="#6d4610" stroke-width="0.5"/>`;
      })
      .join("")}`;
  if (kind === "wood")
    return `<circle cx="27" cy="89" r="22" fill="url(#iron)" ${edge()}/><circle cx="27" cy="89" r="18" fill="url(#wood)" stroke="#3a2412" stroke-width="0.8"/><path d="M10 81 H44 M9 89 H45 M10 97 H44" stroke="#4a2c14" stroke-width="1.2" opacity="0.8"/><circle cx="27" cy="89" r="7.5" fill="url(#goldv)" ${edge(1)}/><circle cx="27" cy="89" r="5.5" fill="url(#steel)"/><circle cx="25.4" cy="87.4" r="1.6" fill="#ffffff" opacity="0.8"/>${[
      0, 40, 80, 120, 160, 200, 240, 280, 320,
    ]
      .map((a) => {
        const x = 27 + 20 * Math.cos((a * Math.PI) / 180);
        const y = 89 + 20 * Math.sin((a * Math.PI) / 180);
        return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.2" fill="#d9a441"/>`;
      })
      .join("")}`;
  return "";
}
function backGauntlet() {
  return `<path d="M39 74 C35 80 36 86 42 89" stroke="${EDGE}" stroke-width="10" stroke-linecap="round" fill="none"/><path d="M39 74 C35 80 36 86 42 89" stroke="url(#steelv)" stroke-width="7.6" stroke-linecap="round" fill="none"/><rect x="38" y="85" width="11" height="10" rx="3.5" fill="url(#steelv)" ${edge()}/>`;
}
function collar(id) {
  if (id === "collector")
    return `<path d="M42 63 C50 58 74 58 82 63 C80 69 70 71 62 71 C54 71 44 69 42 63 Z" fill="url(#cape)" ${edge()}/><circle cx="52" cy="66" r="4.4" fill="url(#gold)" ${edge(1)}/><path d="M50.4 65.4 a1.6 1.6 0 0 1 3.2 0 M51 67.8 h2" stroke="#6d4610" stroke-width="0.9" fill="none"/>`;
  if (id === "acrobat")
    return `<path d="M41 63 C50 57 74 57 83 63 C80 70 70 72 62 72 C54 72 44 70 41 63 Z" fill="url(#cape)" ${edge()}/><path d="M43 64 C52 60 72 60 81 64" stroke="url(#gold)" stroke-width="1.3" fill="none"/><circle cx="62" cy="67" r="4.2" fill="url(#gold)" ${edge(1)}/><path d="M60.6 67.6 a1.4 1.4 0 1 0 2.8 0 a1.4 1.4 0 1 0 -2.8 0 M59.6 65.3 h0.1 M62 64.6 h0.1 M64.4 65.3 h0.1" stroke="#7a3a40" stroke-width="1.2" stroke-linecap="round"/>`;
  return `<path d="M43 62 C52 58 72 58 81 62 C80 68 72 71 62 71 C52 71 44 68 43 62 Z" fill="url(#cape)" ${edge()}/><path d="M50 64 C55 67 69 67 74 64" stroke="#00000033" stroke-width="1.6" fill="none"/>`;
}

// Upright ears; the inner base points toward the crown. Mirrored about x = 62.
function ears(cat) {
  const ear = (m) => {
    const x = (v) => (m ? 124 - v : v).toFixed(1);
    return `<path d="M${x(31)} 37 L${x(36)} 5 L${x(57)} 20 Z" fill="url(#fur)" ${edge()}/><path d="M${x(35)} 31 L${x(37.6)} 11 L${x(51)} 21 Z" fill="${cat.ear}"/><path d="M${x(40)} 25 l${m ? -2 : 2} -8 M${x(43)} 26 l${m ? -2 : 2} -7" stroke="#ffffff" stroke-width="0.9" opacity="0.75"/>`;
  };
  return ear(false) + ear(true);
}
function eyes(mood) {
  const one = (cx) => {
    const lid =
      mood === "stern"
        ? `<path d="M${cx - 7.5} 43 C${cx - 3} 39.5 ${cx + 3} 39.5 ${cx + 7.5} 42" stroke="${EDGE}" stroke-width="2.4" fill="none" stroke-linecap="round"/><path d="M${cx - 8} 40 C${cx - 2} 38 ${cx + 4} 38 ${cx + 8} 40.5 L${cx + 8} 37 L${cx - 8} 37 Z" fill="url(#fur)"/>`
        : `<path d="M${cx - 7.5} 43.5 C${cx - 4} 37.5 ${cx + 4} 37.5 ${cx + 7.5} 43.5" stroke="${EDGE}" stroke-width="2" fill="none" stroke-linecap="round"/>`;
    return `<ellipse cx="${cx}" cy="45" rx="7.4" ry="7.8" fill="url(#iris)" ${edge(1.2)}/><ellipse cx="${cx}" cy="45.5" rx="${mood === "wide" ? 4 : 2.6}" ry="6" fill="#120b10"/><circle cx="${cx + 2.4}" cy="42.2" r="2.1" fill="#ffffff"/><circle cx="${cx - 2.4}" cy="48.6" r="0.9" fill="#ffffff" opacity="0.8"/>${lid}`;
  };
  return one(49) + one(75);
}
function face(cat, mood) {
  const mouth =
    mood === "roar"
      ? `<path d="M55 56.5 C57 63.5 67 63.5 69 56.5 C65 58 59 58 55 56.5 Z" fill="#7a2232" ${edge(1.2)}/><path d="M58.5 60.5 C60 62.6 64 62.6 65.5 60.5 C64 59.5 60 59.5 58.5 60.5 Z" fill="#f08a9a"/><path d="M56.6 57.4 l1.2 2.8 l1.2 -2.6 M65 57.6 l1.2 2.6 l1.2 -2.8" fill="#ffffff" stroke="${EDGE}" stroke-width="0.5"/>`
      : mood === "smile"
        ? `<path d="M62 54.5 v2.2 M62 56.7 C60 59.6 56.6 59.6 55.4 57.4 M62 56.7 C64 59.6 67.4 59.6 68.6 57.4" stroke="${EDGE}" stroke-width="1.5" fill="none" stroke-linecap="round"/>`
        : `<path d="M62 54.5 v2 M62 56.5 C60.4 58.2 58 58.2 57 57 M62 56.5 C63.6 58.2 66 58.2 67 57" stroke="${EDGE}" stroke-width="1.4" fill="none" stroke-linecap="round"/>`;
  const whiskers = `<path d="M50 55 C42 53 34 53 26 55 M50 57.5 C42 57 35 58 28 60.5 M74 55 C82 53 90 53 98 55 M74 57.5 C82 57 89 58 96 60.5" stroke="#ffffff" stroke-width="0.8" fill="none" opacity="0.85"/>`;
  return `<path d="M44 52 C46 60 54 63 62 63 C70 63 78 60 80 52 C76 48 70 47 62 49 C54 47 48 48 44 52 Z" fill="${cat.muzzle}"/><path d="M58.6 51.2 h6.8 c0.6 0 0.9 0.6 0.5 1.1 l-2.9 2.9 c-0.5 0.5 -1.4 0.5 -2 0 l-2.9 -2.9 c-0.4 -0.5 -0.1 -1.1 0.5 -1.1 z" fill="#ee8f98" stroke="#a8555e" stroke-width="0.7"/><path d="M60.4 52.2 h2" stroke="#ffffff" stroke-width="0.8" opacity="0.8"/>${mouth}${whiskers}`;
}
// Cheek fluff makes the head read as fur rather than a disc.
function headShape() {
  return `<path d="M30 44 C29 28 44 18 62 18 C80 18 95 28 94 44 C94 50 92 55 89 58 L92 61 L86 61 L88 64 L80 63 C75 66 69 67 62 67 C55 67 49 66 44 63 L36 64 L38 61 L32 61 L35 58 C32 55 30 50 30 44 Z" fill="url(#fur)" ${edge()}/>`;
}
function stripes(color) {
  if (!color) return "";
  return `<path d="M55 21 C56 25 56 29 55 32 L57 32 C58 28 58 24 57 21 Z M61 19.5 C61.6 24 61.6 28 61 32 L63 32 C63.6 28 63.6 24 63 19.5 Z M67 21 C66 25 66 29 67 32 L69 32 C70 28 70 24 69 21 Z M32 42 C36 41 39 42 41 44 C38 44 35 44 32 45 Z M92 42 C88 41 85 42 83 44 C86 44 89 44 92 45 Z M33 49 C36 48.5 38 49.5 40 51 C37 51 35 51 33 52 Z M91 49 C88 48.5 86 49.5 84 51 C87 51 89 51 91 52 Z" fill="${color}" opacity="0.85"/>`;
}
function headgear(id) {
  if (id === "collector")
    // Open-faced sallet with cheek guards and a gold-trimmed brow, as in the avatar.
    return `<path d="M30 38 C30 20 45 11 62 11 C79 11 94 20 94 38 C90 36 84 34.5 78 34 L62 28 L46 34 C40 34.5 34 36 30 38 Z" fill="url(#steel)" ${edge()}/><path d="M62 11 L62 28" stroke="#8a92a3" stroke-width="1.4"/><path d="M31 37.5 C36 35.5 42 34.4 46.5 34 L62 28.4 L77.5 34 C82 34.4 88 35.5 93 37.5" stroke="url(#gold)" stroke-width="2.2" fill="none"/><path d="M30 38 C27 46 28 56 33 61 L37 58 C34 52 34 45 36 39 Z M94 38 C97 46 96 56 91 61 L87 58 C90 52 90 45 88 39 Z" fill="url(#steelv)" ${edge()}/><path d="M48 18 C52 15 57 14 60 14.5" stroke="#ffffff" stroke-width="2.4" opacity="0.6" fill="none" stroke-linecap="round"/><path d="M52 24 c3 -2 6 -2 7 0 M65 24 c1 -2 4 -2 7 0" stroke="url(#gold)" stroke-width="1.2" fill="none"/>`;
  if (id === "guardian")
    // Great helm with the visor raised, eye slots, gold trim, rivets and a red plume.
    return `<path d="M59 12 C56 2 66 -1 80 3 C88 5 92 12 90 18 C84 13 76 12 68 13 Z" fill="#c8202b" ${edge()}/><path d="M63 9 C69 5 79 5 86 10" stroke="#ff6a6a" stroke-width="1.6" fill="none" opacity="0.8"/><path d="M28 40 C28 22 43 12 62 12 C81 12 96 22 96 40 L96 42 L28 42 Z" fill="url(#steel)" ${edge()}/><path d="M28 30 H96 V40 H28 Z" fill="url(#steelv)" ${edge(1.1)}/><path d="M28 30 H96 M28 40 H96" stroke="url(#gold)" stroke-width="1.8"/>${[
      38, 47, 56, 68, 77, 86,
    ]
      .map(
        (x) =>
          `<rect x="${x - 1.6}" y="32.4" width="3.2" height="5.4" rx="0.8" fill="#1b1420"/>`,
      )
      .join(
        "",
      )}<circle cx="29" cy="41" r="3.4" fill="url(#gold)" ${edge(1)}/><circle cx="95" cy="41" r="3.4" fill="url(#gold)" ${edge(1)}/><rect x="56" y="9.5" width="12" height="4.5" rx="1.6" fill="url(#gold)" ${edge(1)}/><path d="M40 19 C46 15 54 13.5 60 13.5" stroke="#ffffff" stroke-width="2.4" opacity="0.6" fill="none" stroke-linecap="round"/>`;
  if (id === "sprinter")
    // Viking spangenhelm: domed iron, gold brow band and crest strip, nasal guard.
    return `<path d="M31 36 C31 18 45 9 62 9 C79 9 93 18 93 36 Z" fill="url(#iron)" ${edge()}/><path d="M38 18 C44 13 52 11 58 11" stroke="#ffffff" stroke-width="2.2" opacity="0.45" fill="none" stroke-linecap="round"/><path d="M58 9.2 H66 V33 H58 Z" fill="url(#gold)" ${edge(1)}/><path d="M30 31 C40 28.5 84 28.5 94 31 L94 37.5 C84 35 40 35 30 37.5 Z" fill="url(#gold)" ${edge()}/>${[
      35, 43, 51, 73, 81, 89,
    ]
      .map((x) => `<circle cx="${x}" cy="33.6" r="1.4" fill="#5a3a0e"/>`)
      .join(
        "",
      )}<path d="M58.6 33 H65.4 V47 C65.4 49 63.9 50.5 62 50.5 C60.1 50.5 58.6 49 58.6 47 Z" fill="url(#iron)" ${edge()}/>`;
  // Rosie: a satin bow at the right ear.
  return `<path d="M80 21 C74 12 66 15 70 22 C65 27 72 31 79 24 C84 32 92 29 88 23 C94 16 86 12 80 21 Z" fill="#e88aa0" ${edge()}/><path d="M71 19 C73 20 76 21 78 22.5 M88 19 C86 20 83 21 81 22.5" stroke="#b9566e" stroke-width="1" fill="none"/><ellipse cx="79.6" cy="22.6" rx="3" ry="2.6" fill="#d06d86" ${edge(1)}/>`;
}

export const LOOK = {
  collector: {
    mood: "stern",
    torso: "plate",
    trim: true,
    shield: "oval",
    paw: null,
    tassets: "plate",
  },
  acrobat: {
    mood: "calm",
    torso: "plate",
    trim: true,
    shield: null,
    paw: null,
    tassets: "plate",
  },
  guardian: {
    mood: "smile",
    torso: "plate",
    trim: true,
    shield: "round",
    paw: "#d9d7dc",
    tassets: "plate",
  },
  sprinter: {
    mood: "roar",
    torso: "scale",
    trim: false,
    shield: "wood",
    paw: "#e2c9a6",
    tassets: "scale",
  },
};
function catBody(id) {
  const cat = CATS[id];
  const look = LOOK[id];
  return [
    defs(cat),
    cape(id !== "sprinter"),
    legs(look.trim),
    look.torso === "scale" ? scaleTorso() : plateTorso(look.trim),
    tassets(look.tassets),
    belt(),
    pauldrons(),
    look.shield ? "" : backGauntlet(),
    collar(id),
    weaponArm(look.paw),
    shield(look.shield),
    ears(cat),
    headShape(),
    stripes(cat.stripe),
    eyes(look.mood === "roar" ? "wide" : look.mood),
    face(cat, look.mood),
    headgear(id),
  ].join("");
}

// 96 × 96 canvas, weapon pointing straight up from its grip pivot.
export function weapon(kind) {
  const d = `<defs>${grad(
    "wblade",
    [
      [0, "#7c8494"],
      [0.35, "#f4f6fa"],
      [0.5, "#ffffff"],
      [0.65, "#c3c9d4"],
      [1, "#6a7181"],
    ],
    0,
  )}${grad("wgold", GOLD, 0)}${grad(
    "wwood",
    [
      [0, "#3a2414"],
      [0.5, "#6e4526"],
      [1, "#2e1c10"],
    ],
    0,
  )}${grad(
    "wleather",
    [
      [0, "#9a5a32"],
      [1, "#5c3018"],
    ],
    0,
  )}</defs>`;
  if (kind === "spear")
    return `${d}<rect x="45.4" y="24" width="5.2" height="70" rx="2.4" fill="url(#wwood)" ${edge(1.2)}/>${[
      34, 50, 76, 88,
    ]
      .map(
        (y) =>
          `<rect x="44.2" y="${y}" width="7.6" height="3" rx="1" fill="url(#wgold)" ${edge(0.8)}/>`,
      )
      .join(
        "",
      )}<path d="M48 1 L55.5 15 L51.5 17 L51 24 H45 L44.5 17 L40.5 15 Z" fill="url(#wblade)" ${edge(1.2)}/><path d="M48 3 V22" stroke="#8a92a3" stroke-width="0.9"/><path d="M43.4 22 H52.6 L51.6 27 H44.4 Z" fill="url(#wgold)" ${edge(1)}/><path d="M45 30 C40 34 37 42 35 52 C38 48 40 46 42 45 C41 40 43 35 46 32 Z" fill="#b8333a" ${edge(1)}/><path d="M51 30 C54 34 55 39 54 44 L52 38 Z" fill="#8e2128"/>`;
  if (kind === "longsword")
    return `${d}<path d="M44.6 6 L48 0.8 L51.4 6 L52.2 60 H43.8 Z" fill="url(#wblade)" ${edge(1.2)}/><path d="M48 7 V56" stroke="url(#wgold)" stroke-width="1.4"/><path d="M46.6 14 c1.4 2 1.4 4 0 6 M49.4 26 c-1.4 2 -1.4 4 0 6 M46.6 38 c1.4 2 1.4 4 0 6" stroke="url(#wgold)" stroke-width="0.9" fill="none"/><path d="M30 61.5 C36 58 42 59 48 60 C54 59 60 58 66 61.5 C60 64 54 63 48 64 C42 63 36 64 30 61.5 Z" fill="url(#wgold)" ${edge(1.1)}/><circle cx="29.6" cy="61.6" r="2" fill="#e26a8a" ${edge(0.8)}/><circle cx="66.4" cy="61.6" r="2" fill="#e26a8a" ${edge(0.8)}/><circle cx="48" cy="62" r="4.6" fill="url(#wgold)" ${edge(1)}/><path d="M46.4 62.8 a1.6 1.6 0 1 0 3.2 0 a1.6 1.6 0 1 0 -3.2 0" fill="#7a5014"/><rect x="45" y="66" width="6" height="15" rx="2" fill="url(#wleather)" ${edge(1)}/><path d="M45 69 l6 2 M45 73 l6 2 M45 77 l6 2" stroke="#3a1e0e" stroke-width="0.9"/><circle cx="48" cy="84.5" r="4.6" fill="url(#wgold)" ${edge(1)}/><circle cx="46.8" cy="83.3" r="1.4" fill="#fff0b8"/>`;
  if (kind === "sword")
    return `${d}<path d="M43 20 L48 12 L53 20 L53.4 63 H42.6 Z" fill="url(#wblade)" ${edge(1.2)}/><path d="M48 14 V60" stroke="#9aa2b2" stroke-width="1"/><path d="M33 64 C33 60.5 37 60.5 38 62.5 H58 C59 60.5 63 60.5 63 64 C63 67.5 59 67.5 58 65.5 H38 C37 67.5 33 67.5 33 64 Z" fill="url(#wgold)" ${edge(1.1)}/><rect x="45" y="67" width="6" height="13" rx="2" fill="url(#wleather)" ${edge(1)}/><path d="M45 70 l6 2 M45 74 l6 2" stroke="#3a1e0e" stroke-width="0.9"/><circle cx="48" cy="84" r="5" fill="url(#wgold)" ${edge(1)}/><circle cx="46.6" cy="82.6" r="1.6" fill="#fff0b8"/>`;
  return `${d}<rect x="37.4" y="14" width="6" height="78" rx="2.6" fill="url(#wwood)" ${edge(1.2)}/><path d="M37.4 64 h6 v18 h-6 z" fill="url(#wleather)"/><path d="M37.4 66 l6 3 M37.4 71 l6 3 M37.4 76 l6 3" stroke="#2e1608" stroke-width="1"/><rect x="36" y="86" width="8.8" height="8" rx="2" fill="url(#wblade)" ${edge(1)}/><path d="M44 14 H54 C62 8 72 8 79 13 C84 22 84 36 77 48 C72 42 64 36 56 34 L54 32 H44 Z" fill="url(#wblade)" ${edge(1.2)}/><path d="M79.4 15 C83 24 83 35 77.6 45" stroke="#ffffff" stroke-width="1.6" opacity="0.85" fill="none" stroke-linecap="round"/><path d="M56 17 C62 14 68 14 72 16" stroke="#8a92a3" stroke-width="1" fill="none"/><rect x="35.6" y="9" width="9.6" height="32" rx="2.4" fill="url(#wgold)" ${edge(1)}/><path d="M35.6 18 h9.6 M35.6 32 h9.6" stroke="#6d4610" stroke-width="0.9"/><path d="M35.6 14 C30 16 28 20 29 26 C31 22 33 21 35.6 21 Z" fill="url(#wblade)" ${edge(1)}/>`;
}
// Portrait: the body with its weapon held at rest.
export function catPortrait(id) {
  const cat = CATS[id];
  const pivot = WEAPON_PIVOT[cat.weapon];
  // The axe head is wide; a smaller scale keeps it on the canvas.
  const scale = cat.weapon === "axe" ? 0.68 : 0.78;
  const x = HAND.x - pivot.x * scale;
  const y = HAND.y - pivot.y * scale;
  // Weapon in front of the body with the paw redrawn over the grip.
  return `${catBody(id)}<g transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${cat.weapon === "axe" ? 0 : 8} ${(pivot.x * scale).toFixed(2)} ${(pivot.y * scale).toFixed(2)}) scale(${scale})">${weapon(cat.weapon)}</g>${gripHand(LOOK[id].paw)}`;
}
