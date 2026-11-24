// Smooth vector catacomb foes, 128 × 128, feet on y = 120, facing left
// (towards a cat coming from the left is mirrored by the renderer).
const INK = "#2a2033";
const line = `stroke="${INK}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"`;
const grad = (id, stops) =>
  `<linearGradient id="${id}" gradientTransform="rotate(90)">${stops
    .map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`)
    .join("")}</linearGradient>`;
const eye = (cx, cy, r, glow) =>
  `<circle cx="${cx}" cy="${cy}" r="${r + 2}" fill="${glow}" opacity="0.35"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="${glow}"/><circle cx="${cx - r / 3}" cy="${cy - r / 3}" r="${r / 3}" fill="#fff"/>`;

// Top of each foe's body on its canvas; the renderer fits this to the hitbox.
export const ENEMY_TOP = { slime: 66, skeleton: 26, bat: 44, warden: 10 };

function slime() {
  return `<defs>${grad("goo", [
    [0, "#9ff0b8"],
    [0.5, "#55c98a"],
    [1, "#2c8e60"],
  ])}</defs><ellipse cx="64" cy="121" rx="38" ry="5" fill="#000" opacity="0.18"/><path d="M24 118 C20 96 34 68 64 66 C94 68 108 96 104 118 C96 122 32 122 24 118 Z" fill="url(#goo)" ${line}/><path d="M38 86 C44 76 54 72 62 72" stroke="#e8fff0" stroke-width="5" fill="none" stroke-linecap="round" opacity="0.8"/><circle cx="88" cy="100" r="4" fill="#e8fff0" opacity="0.5"/><path d="M42 92 L56 98 M86 92 L72 98" stroke="${INK}" stroke-width="3.5" stroke-linecap="round"/><ellipse cx="51" cy="103" rx="5" ry="6" fill="${INK}"/><ellipse cx="77" cy="103" rx="5" ry="6" fill="${INK}"/><circle cx="52.5" cy="101" r="1.8" fill="#fff"/><circle cx="78.5" cy="101" r="1.8" fill="#fff"/><path d="M56 112 Q64 108 72 112" stroke="${INK}" stroke-width="2.5" fill="none" stroke-linecap="round"/>`;
}
function skeleton() {
  return `<defs>${grad("bone", [
    [0, "#fbf6ea"],
    [1, "#c9bfa8"],
  ])}${grad("rust", [
    [0, "#d6dae2"],
    [1, "#8d8478"],
  ])}</defs><ellipse cx="64" cy="121" rx="26" ry="4" fill="#000" opacity="0.18"/><path d="M29 84 L24 60" stroke="${INK}" stroke-width="9" stroke-linecap="round"/><path d="M29 84 L24 60" stroke="#7a4a2a" stroke-width="4" stroke-linecap="round"/><path d="M20 56 L12 16 L20 13 L28 54 Z" fill="url(#rust)" ${line}/><path d="M18 50 L14 22" stroke="#fff" stroke-width="1.5" opacity="0.6"/><rect x="11" y="53" width="24" height="6" rx="3" fill="#7a4a2a" ${line}/><path d="M54 96 L50 118 M74 96 L78 118" stroke="${INK}" stroke-width="10" stroke-linecap="round"/><path d="M54 96 L50 118 M74 96 L78 118" stroke="url(#bone)" stroke-width="5" stroke-linecap="round"/><path d="M44 66 C44 60 84 60 84 66 L80 96 C76 100 52 100 48 96 Z" fill="#5b3f7a" ${line}/><path d="M50 72 H78 M51 80 H77 M53 88 H75" stroke="url(#bone)" stroke-width="4" stroke-linecap="round"/><path d="M64 66 V96" stroke="#efe8d8" stroke-width="3"/><path d="M46 72 L31 82" stroke="${INK}" stroke-width="10" stroke-linecap="round"/><path d="M46 72 L31 82" stroke="url(#bone)" stroke-width="5" stroke-linecap="round"/><circle cx="29" cy="82" r="5" fill="url(#bone)" ${line}/><path d="M82 72 L94 92" stroke="${INK}" stroke-width="10" stroke-linecap="round"/><path d="M82 72 L94 92" stroke="url(#bone)" stroke-width="5" stroke-linecap="round"/><path d="M38 44 C36 22 52 14 64 14 C78 14 92 22 90 44 C90 54 84 58 80 60 L78 68 H50 L48 60 C42 58 38 54 38 44 Z" fill="url(#bone)" ${line}/><path d="M44 40 C46 32 54 32 56 40 C56 46 46 48 44 40 Z M72 40 C74 32 82 32 84 40 C84 46 74 48 72 40 Z" fill="${INK}"/>${eye(51, 40, 3.2, "#ff5a5a")}${eye(78, 40, 3.2, "#ff5a5a")}<path d="M62 48 L64 53 L66 48 Z" fill="${INK}"/><path d="M52 60 V66 M58 60 V67 M64 60 V67 M70 60 V67 M76 60 V66" stroke="${INK}" stroke-width="2"/><path d="M52 22 L56 28 L60 24" stroke="#c9bfa8" stroke-width="2" fill="none"/>`;
}
function bat() {
  return `<defs>${grad("wing", [
    [0, "#8a6bc8"],
    [1, "#4b3478"],
  ])}${grad("batbody", [
    [0, "#7d5fb8"],
    [1, "#46306e"],
  ])}</defs><path d="M52 70 C40 54 22 50 6 58 C14 62 16 70 14 78 C22 74 28 78 30 86 C36 80 44 80 52 84 Z" fill="url(#wing)" ${line}/><path d="M76 70 C88 54 106 50 122 58 C114 62 112 70 114 78 C106 74 100 78 98 86 C92 80 84 80 76 84 Z" fill="url(#wing)" ${line}/><path d="M18 62 L40 72 M110 62 L88 72" stroke="#2f1f52" stroke-width="2" opacity="0.6"/><path d="M50 52 L46 36 L58 46 Z M78 52 L82 36 L70 46 Z" fill="url(#batbody)" ${line}/><ellipse cx="64" cy="70" rx="18" ry="20" fill="url(#batbody)" ${line}/><ellipse cx="64" cy="78" rx="9" ry="8" fill="#a68bd8" opacity="0.6"/>${eye(57, 64, 3.4, "#ff4d5a")}${eye(71, 64, 3.4, "#ff4d5a")}<path d="M58 75 L60 80 L62 75 M66 75 L68 80 L70 75" fill="#fff" stroke="${INK}" stroke-width="1.2"/><path d="M57 74 Q64 78 71 74" stroke="${INK}" stroke-width="2" fill="none"/>`;
}
function warden() {
  return `<defs>${grad("plate", [
    [0, "#7b8299"],
    [0.5, "#4a4f63"],
    [1, "#2d3142"],
  ])}${grad("axe", [
    [0, "#f1f3f8"],
    [1, "#9aa2b6"],
  ])}${grad("bone", [
    [0, "#fbf6ea"],
    [1, "#c9bfa8"],
  ])}</defs><ellipse cx="64" cy="122" rx="40" ry="4" fill="#000" opacity="0.2"/><path d="M38 52 C26 70 22 98 26 120 L102 120 C106 98 102 70 90 52 Z" fill="#5b3f7a" ${line}/><path d="M30 118 l6 -10 l6 10 l6 -8 l6 8 M74 118 l6 -8 l6 8 l6 -10 l6 10" stroke="#3d2858" stroke-width="2" fill="none"/><path d="M18 116 L18 26" stroke="#5e3a22" stroke-width="7" stroke-linecap="round"/><path d="M20 22 C40 18 46 38 40 56 C32 48 26 46 20 48 Z" fill="url(#axe)" ${line}/><path d="M16 22 C4 26 2 40 6 52 C10 44 12 42 16 42 Z" fill="url(#axe)" ${line}/><rect x="50" y="96" width="12" height="22" rx="4" fill="url(#plate)" ${line}/><rect x="68" y="96" width="12" height="22" rx="4" fill="url(#plate)" ${line}/><path d="M40 60 C40 50 88 50 88 60 L86 98 C80 104 48 104 42 98 Z" fill="url(#plate)" ${line}/><path d="M50 62 C52 58 60 57 64 58 L62 88 C56 88 52 86 50 82 Z" fill="#fff" opacity="0.18"/><path d="M48 70 C58 76 70 76 80 70 M50 82 C58 86 70 86 78 82" stroke="#2d3142" stroke-width="2.5" fill="none"/><circle cx="64" cy="76" r="6" fill="#ff6b3d" opacity="0.85" ${line}/><ellipse cx="40" cy="62" rx="13" ry="11" fill="url(#plate)" ${line}/><ellipse cx="88" cy="62" rx="13" ry="11" fill="url(#plate)" ${line}/><path d="M28 60 l-4 -6 M100 60 l4 -6" stroke="#e8dcc4" stroke-width="4" stroke-linecap="round"/><path d="M28 64 L20 80" stroke="${INK}" stroke-width="13" stroke-linecap="round"/><path d="M28 64 L20 80" stroke="url(#plate)" stroke-width="8" stroke-linecap="round"/><circle cx="19" cy="80" r="6.5" fill="url(#plate)" ${line}/><path d="M44 34 C44 18 54 12 64 12 C74 12 84 18 84 34 C84 44 78 50 64 50 C50 50 44 44 44 34 Z" fill="url(#bone)" ${line}/><path d="M42 30 C42 14 54 6 64 6 C74 6 86 14 86 30 L86 34 H42 Z" fill="url(#plate)" ${line}/><path d="M42 22 C34 18 30 8 34 0 C38 8 42 12 48 14 Z M86 22 C94 18 98 8 94 0 C90 8 86 12 80 14 Z" fill="#e8dcc4" ${line}/><rect x="61" y="10" width="6" height="26" rx="2" fill="#2d3142"/><path d="M50 36 h10 M68 36 h10" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>${eye(55, 37, 2.6, "#ff6b3d")}${eye(73, 37, 2.6, "#ff6b3d")}<path d="M56 44 V49 M60 44 V50 M64 44 V50 M68 44 V50 M72 44 V49" stroke="${INK}" stroke-width="1.8"/>`;
}
export const ENEMIES = { slime, skeleton, bat, warden };
