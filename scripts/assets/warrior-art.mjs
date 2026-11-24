// Smooth vector warrior cats (2026-11-24 user decision): chibi knights after
// the armoured-cat references. 128 × 128 canvas, feet on y = 120, facing right.
// The weapon is a separate file so the game can swing it.
const INK = "#2a2033";
const line = `stroke="${INK}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"`;

export const CATS = {
  collector: {
    fur: ["#ffd19b", "#f0a35a", "#d27a35"],
    stripe: "#c3662a",
    muzzle: "#fff4e8",
    ear: "#f5a3a8",
    eye: null,
    armor: "leather",
    weapon: "spear",
    shield: "kite",
  },
  acrobat: {
    fur: ["#ffffff", "#f6efef", "#ddd0d8"],
    stripe: null,
    muzzle: "#ffffff",
    ear: "#f7b3c4",
    eye: "#6f8fd6",
    armor: "steel",
    weapon: "longsword",
    shield: null,
  },
  guardian: {
    fur: ["#d4d0d8", "#a9a3b0", "#7d7787"],
    stripe: "#6a6474",
    muzzle: "#f4f1f6",
    ear: "#e9a9b4",
    eye: "#c9a227",
    armor: "steel",
    weapon: "sword",
    shield: "round",
  },
  sprinter: {
    fur: ["#c9a57c", "#9c7a55", "#6e5236"],
    stripe: "#4e3a27",
    muzzle: "#efe2cf",
    ear: "#d99a8c",
    eye: "#d88a1c",
    armor: "mail",
    weapon: "axe",
    shield: "wood",
  },
};
export const WEAPON_PIVOT = {
  spear: { x: 48, y: 64 },
  longsword: { x: 48, y: 72 },
  sword: { x: 48, y: 72 },
  axe: { x: 48, y: 74 },
};
// Where the weapon hand sits on the body canvas.
export const HAND = { x: 93, y: 86 };

// Gradients run left to right by default; rotate(90) turns them top to bottom.
function gradient(id, stops, vertical = true) {
  const turn = vertical ? ' gradientTransform="rotate(90)"' : "";
  return `<linearGradient id="${id}"${turn}>${stops
    .map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`)
    .join("")}</linearGradient>`;
}
function defs(cat) {
  const [light, mid, dark] = cat.fur;
  return `<defs>${gradient("fur", [
    [0, light],
    [0.55, mid],
    [1, dark],
  ])}${gradient("steel", [
    [0, "#fbfcff"],
    [0.45, "#cfd5e2"],
    [1, "#8a92a7"],
  ])}${gradient("leather", [
    [0, "#c48a57"],
    [1, "#7c4e2d"],
  ])}${gradient("mail", [
    [0, "#b9bfcc"],
    [1, "#727a8c"],
  ])}</defs>`;
}
function tail(cat) {
  return `<path d="M40 100 C22 100 14 86 18 72 C20 66 26 66 26 72 C24 82 28 92 42 92 Z" fill="url(#fur)" ${line}/>${
    cat.stripe
      ? `<path d="M20 78 l6 1 M22 86 l6 -1" stroke="${cat.stripe}" stroke-width="3" stroke-linecap="round"/>`
      : ""
  }`;
}
function cape() {
  return `<path d="M42 66 C30 82 26 102 30 117 L94 117 C96 100 92 82 82 66 Z" fill="#e88aa8" ${line}/><path d="M36 112 C40 96 44 84 50 72" stroke="#c96b8b" stroke-width="2.5" fill="none" stroke-linecap="round"/><g fill="#fbe1ea"><circle cx="38" cy="104" r="3"/><circle cx="33" cy="99" r="1.6"/><circle cx="37" cy="97" r="1.6"/><circle cx="41" cy="98" r="1.6"/></g>`;
}
function boots(armor) {
  const fill = armor === "leather" ? "url(#leather)" : "url(#steel)";
  return `<rect x="45" y="103" width="15" height="16" rx="5" fill="${fill}" ${line}/><rect x="64" y="103" width="15" height="16" rx="5" fill="${fill}" ${line}/><path d="M45 114 h18 M64 114 h18" stroke="${INK}" stroke-width="2" opacity="0.35"/>`;
}
// Chainmail: offset rows of small arcs inside the torso.
function mailRings() {
  const d = [];
  for (let row = 0; row < 7; row++)
    for (let x = 44 + (row % 2) * 3; x < 78; x += 6)
      d.push(`M${x} ${70 + row * 5}a3 2.5 0 0 1 6 0`);
  return d.join("");
}
function torso(armor) {
  const fill =
    armor === "leather"
      ? "url(#leather)"
      : armor === "mail"
        ? "url(#mail)"
        : "url(#steel)";
  const body = `<path d="M40 74 C40 66 48 62 61 62 C74 62 82 66 82 74 L84 98 C84 105 76 108 61 108 C46 108 38 105 38 98 Z" fill="${fill}" ${line}/>`;
  const detail =
    armor === "mail"
      ? `<path d="${mailRings()}" fill="none" stroke="#4d5363" stroke-width="1" opacity="0.7"/>`
      : armor === "leather"
        ? `<path d="M48 70 L50 100 M72 70 L70 100" stroke="#5e3a22" stroke-width="2" stroke-dasharray="3 3"/>`
        : `<path d="M47 70 C49 66 55 65 59 66 L57 92 C51 92 47 90 46 86 Z" fill="#ffffff" opacity="0.4"/><path d="M61 65 V102" stroke="#8a92a7" stroke-width="1.6"/>`;
  const belt = `<rect x="38" y="92" width="46" height="7" rx="2" fill="#6a3f22" ${line}/><rect x="56" y="90.5" width="10" height="10" rx="2" fill="#f2c14e" ${line}/>`;
  const skirt =
    armor === "steel"
      ? `<path d="M40 99 L39 110 L50 111 L51 100 Z M71 100 L72 111 L83 110 L82 99 Z" fill="url(#steel)" ${line}/>`
      : "";
  return body + detail + belt + skirt;
}
function arms(armor) {
  const plate = armor === "leather" ? "url(#leather)" : "url(#steel)";
  return `<ellipse cx="39" cy="72" rx="10" ry="9" fill="${plate}" ${line}/><ellipse cx="84" cy="72" rx="10" ry="9" fill="${plate}" ${line}/><path d="M86 78 C90 80 92 82 93 86" stroke="${INK}" stroke-width="9" stroke-linecap="round"/><path d="M86 78 C90 80 92 82 93 86" stroke="#cfd5e2" stroke-width="5" stroke-linecap="round"/><circle cx="${HAND.x}" cy="${HAND.y}" r="7" fill="url(#steel)" ${line}/>`;
}
function shield(kind) {
  if (kind === "kite")
    return `<path d="M16 70 H42 V90 C42 103 34 111 29 115 C24 111 16 103 16 90 Z" fill="#e7b386" ${line}/><path d="M29 72 V112 M17 86 H41" stroke="#f6d7b4" stroke-width="5"/><path d="M16 70 H42 V90 C42 103 34 111 29 115 C24 111 16 103 16 90 Z" fill="none" ${line}/>`;
  if (kind === "round")
    return `<circle cx="29" cy="90" r="24" fill="#c8743a" ${line}/><circle cx="29" cy="90" r="18" fill="url(#steel)" stroke="${INK}" stroke-width="2"/><path d="M20 94 L22 82 L26 87 H32 L36 82 L38 94 C34 99 24 99 20 94 Z" fill="none" stroke="#8a92a7" stroke-width="2" stroke-linejoin="round"/><circle cx="25" cy="90" r="1.3" fill="#8a92a7"/><circle cx="33" cy="90" r="1.3" fill="#8a92a7"/>`;
  if (kind === "wood")
    return `<circle cx="29" cy="90" r="22" fill="#8a5d34" ${line}/><path d="M15 80 H43 M12 90 H46 M15 100 H43" stroke="#6a4424" stroke-width="2"/><circle cx="29" cy="90" r="22" fill="none" stroke="#6b6f7a" stroke-width="4"/><circle cx="29" cy="90" r="22" fill="none" ${line}/><circle cx="29" cy="90" r="6" fill="#b7bcc7" ${line}/>`;
  return "";
}
function scarf() {
  return `<path d="M41 63 C50 70 72 70 81 63 L83 70 C72 77 50 77 39 70 Z" fill="#2e6bf0" ${line}/><path d="M44 70 L37 86 L46 83 Z" fill="#1d45b0" ${line}/>`;
}
function fur() {
  return `<path d="M34 70 C34 60 44 58 48 62 C52 56 60 58 61 62 C64 56 74 58 76 62 C80 58 90 62 88 70 C82 74 40 76 34 70 Z" fill="#7a5a3a" ${line}/><path d="M42 64 l2 4 M54 61 l1 4 M68 61 l-1 4 M80 64 l-2 4" stroke="#a07a52" stroke-width="2" stroke-linecap="round"/>`;
}
function ears(cat, hidden) {
  if (hidden) return "";
  return `<path d="M33 36 L29 6 L55 23 Z" fill="url(#fur)" ${line}/><path d="M36 30 L34 13 L49 23 Z" fill="${cat.ear}"/><path d="M87 36 L91 6 L65 23 Z" fill="url(#fur)" ${line}/><path d="M84 30 L86 13 L71 23 Z" fill="${cat.ear}"/>`;
}
function eyes(cat, fierce) {
  const one = (cx) =>
    cat.eye
      ? `<ellipse cx="${cx}" cy="45" rx="7.5" ry="8.5" fill="${cat.eye}" stroke="${INK}" stroke-width="2"/><ellipse cx="${cx}" cy="46" rx="4.5" ry="6" fill="#1d1626"/><circle cx="${cx + 2.6}" cy="41.5" r="2.6" fill="#fff"/><circle cx="${cx - 2}" cy="49" r="1.2" fill="#fff"/>`
      : `<ellipse cx="${cx}" cy="45" rx="7.5" ry="8.5" fill="#1d1626"/><circle cx="${cx + 2.6}" cy="41.5" r="2.8" fill="#fff"/><circle cx="${cx - 2}" cy="49" r="1.3" fill="#fff"/>`;
  const brows = fierce
    ? `<path d="M40 34 L54 38 M80 34 L66 38" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`
    : "";
  return one(47) + one(73) + brows;
}
function face(cat, roar) {
  const mouth = roar
    ? `<path d="M53 57 Q60 68 67 57 Z" fill="#7a2238" ${line}/><path d="M55 58 l2 4 l2 -4" fill="#fff"/>`
    : `<path d="M60 55.5 v2.5 M60 58 q-3 3 -6 1 M60 58 q3 3 6 1" stroke="${INK}" stroke-width="1.8" fill="none" stroke-linecap="round"/>`;
  return `<ellipse cx="60" cy="56" rx="15" ry="10" fill="${cat.muzzle}"/><ellipse cx="40" cy="54" rx="4.5" ry="2.6" fill="#ff9fb2" opacity="0.55"/><ellipse cx="80" cy="54" rx="4.5" ry="2.6" fill="#ff9fb2" opacity="0.55"/><path d="M56.5 51.5 h7 l-3.5 4 z" fill="#f39aa8" stroke="${INK}" stroke-width="1.5" stroke-linejoin="round"/>${mouth}<path d="M44 56 L28 54 M44 59 L29 62 M76 56 L92 54 M76 59 L91 62" stroke="${INK}" stroke-width="1.2" opacity="0.5" stroke-linecap="round"/>`;
}
function head(cat, id) {
  const stripes = cat.stripe
    ? `<path d="M54 19 q2 6 0 10 M60 17 v11 M66 19 q-2 6 0 10" stroke="${cat.stripe}" stroke-width="3" fill="none" stroke-linecap="round"/>`
    : "";
  const gear =
    id === "guardian"
      ? `<path d="M27 41 C27 19 42 10 60 10 C78 10 93 19 93 41 Z" fill="url(#steel)" ${line}/><rect x="26" y="34" width="68" height="8" rx="3" fill="#9aa2b6" ${line}/><path d="M38 38 h6 M50 38 h6 M64 38 h6 M76 38 h6" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/><path d="M40 20 C46 14 54 12 60 12" stroke="#fff" stroke-width="3" opacity="0.6" fill="none" stroke-linecap="round"/><path d="M56 12 C52 5 60 1.5 75 3 C71 6 68 9 66 13 Z" fill="#e0413c" ${line}/><path d="M58 9 C61 6 66 5 70 5" stroke="#ff8a7a" stroke-width="2" fill="none" stroke-linecap="round"/>`
      : id === "sprinter"
        ? `<path d="M29 36 C29 17 44 8 60 8 C76 8 91 17 91 36 Z" fill="#6b6f7a" ${line}/><rect x="28" y="28" width="64" height="8" rx="2" fill="#b07a3c" ${line}/><rect x="57" y="10" width="6" height="18" fill="#b07a3c"/><rect x="56.5" y="30" width="7" height="20" rx="3" fill="#8b909c" ${line}/><g fill="#e7c48a"><circle cx="36" cy="32" r="1.6"/><circle cx="46" cy="32" r="1.6"/><circle cx="74" cy="32" r="1.6"/><circle cx="84" cy="32" r="1.6"/></g>`
        : id === "acrobat"
          ? `<path d="M76 22 C70 12 62 16 68 24 C62 30 70 34 76 26 C82 34 90 30 84 24 C90 16 82 12 76 22 Z" fill="#f48fb1" ${line}/><circle cx="76" cy="24" r="3" fill="#e4648f" stroke="${INK}" stroke-width="2"/>`
          : "";
  const hidden = id === "guardian" || id === "sprinter";
  return `${ears(cat, hidden)}<ellipse cx="60" cy="45" rx="33" ry="27" fill="url(#fur)" ${line}/>${hidden ? "" : stripes}${eyes(cat, id === "sprinter")}${face(cat, id === "sprinter")}${gear}`;
}
export function catBody(id) {
  const cat = CATS[id];
  const back = id === "acrobat" ? cape() : tail(cat);
  return `${defs(cat)}${back}${boots(cat.armor)}${torso(cat.armor)}${
    id === "sprinter" ? fur() : id === "collector" ? scarf() : ""
  }${arms(cat.armor)}${shield(cat.shield)}${head(cat, id)}`;
}

const blade = `${gradient(
  "blade",
  [
    [0, "#ffffff"],
    [0.5, "#d9dee8"],
    [1, "#9aa2b6"],
  ],
  false,
)}`;
// 96 × 96 canvas, weapon pointing straight up from its grip pivot.
export function weapon(kind) {
  if (kind === "spear")
    return `<defs>${blade}</defs><rect x="45" y="22" width="6" height="72" rx="3" fill="#d8452f" ${line}/><rect x="46.5" y="24" width="2" height="66" fill="#ff8a6a" opacity="0.6"/><path d="M48 2 L57 18 L48 28 L39 18 Z" fill="url(#blade)" ${line}/><rect x="43" y="27" width="10" height="6" rx="2" fill="#e8c08a" ${line}/><rect x="43" y="58" width="10" height="10" rx="2" fill="#e8c08a" ${line}/>`;
  if (kind === "longsword")
    return `<defs>${blade}</defs><path d="M44.5 6 L48 1 L51.5 6 L52 62 L44 62 Z" fill="url(#blade)" ${line}/><path d="M48 8 V58" stroke="#9aa2b6" stroke-width="1.5"/><rect x="33" y="61" width="30" height="6" rx="3" fill="#f2c14e" ${line}/><circle cx="48" cy="64" r="4" fill="#f9dc8a" ${line}/><rect x="45" y="67" width="6" height="14" rx="2" fill="#7a4a2a" ${line}/><circle cx="48" cy="85" r="5" fill="#f2c14e" ${line}/>`;
  if (kind === "sword")
    return `<defs>${blade}</defs><path d="M44 22 L48 15 L52 22 L52 64 L44 64 Z" fill="url(#blade)" ${line}/><path d="M48 24 V60" stroke="#9aa2b6" stroke-width="1.5"/><rect x="35" y="63" width="26" height="6" rx="3" fill="#b8862b" ${line}/><rect x="45" y="69" width="6" height="12" rx="2" fill="#5e3a22" ${line}/><circle cx="48" cy="84" r="4.5" fill="#b8862b" ${line}/>`;
  return `<defs>${blade}</defs><rect x="45" y="18" width="6" height="74" rx="3" fill="#8a5d34" ${line}/><path d="M50 14 C68 8 80 20 80 38 C72 32 62 32 50 38 Z" fill="url(#blade)" ${line}/><path d="M46 18 L34 24 L46 30 Z" fill="#9aa2b6" ${line}/><rect x="43" y="66" width="10" height="12" rx="2" fill="#3d2a1a" ${line}/>`;
}
// Portrait: the body with its weapon held at rest.
export function catPortrait(id) {
  const cat = CATS[id];
  const pivot = WEAPON_PIVOT[cat.weapon];
  // Matches the in-game weapon scale relative to the body.
  const scale = 0.85;
  const x = HAND.x - pivot.x * scale;
  const y = HAND.y - pivot.y * scale;
  return `<g transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(14 ${(pivot.x * scale).toFixed(2)} ${(pivot.y * scale).toFixed(2)}) scale(${scale})">${weapon(cat.weapon)}</g>${catBody(id)}`;
}
