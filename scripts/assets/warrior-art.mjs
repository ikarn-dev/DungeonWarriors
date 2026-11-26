// Warrior cats after the reference avatars in apps/web/public/cats_avatars
// (pip-spearpaw, rosie-bladewhisk, sir-bastion, bjorn-ironclaw; 2026-11-24).
// 128 × 128 canvas, feet on y = 120, facing right. Polished steel with gold
// trim, cloth capes and layered fur; a thin dark edge keeps each silhouette
// readable over the dark catacombs. The weapon is a separate file so the game
// can swing it. Only the SVG elements check-assets.mjs allows are used.
// The shared palette, metals, hands, shield and weapons here feed the rig
// parts in warrior-rig.mjs.
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

export function gripHand(paw, at = HAND) {
  return paw
    ? `<ellipse cx="${at.x}" cy="${at.y}" rx="6.2" ry="6.8" fill="${paw}" ${edge()}/><path d="M${at.x - 3} ${at.y - 4} v3 M${at.x} ${at.y - 5} v3 M${at.x + 3} ${at.y - 4} v3" stroke="#00000040" stroke-width="1"/>`
    : `<rect x="${at.x - 6}" y="${at.y - 6}" width="12" height="12" rx="4" fill="url(#steelv)" ${edge()}/><path d="M${at.x - 5} ${at.y - 2} h10 M${at.x - 5} ${at.y + 1.5} h10" stroke="#6e7686" stroke-width="0.9"/>`;
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
