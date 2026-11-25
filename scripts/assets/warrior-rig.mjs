// Rigged side-view warrior cats (2026-11-24): each cat in a three-quarter
// view facing right, split into eight parts that share one 128 × 128 body
// space (feet on y = 120). Drawn at their pivots with no rotation, the parts
// rebuild the whole figure; the renderer turns them about those pivots to
// walk, breathe, jump and swing. Same palettes, metals and edge as the
// portraits in warrior-art.mjs, and only elements check-assets.mjs allows.
import {
  CATS,
  defs,
  EDGE,
  edge,
  gripHand,
  LOOK,
  shield,
} from "./warrior-art.mjs";

// Back to front, as the renderer layers them; the torso's tassets cover the
// tops of both legs. Pivots are in body space.
export const RIG = [
  ["tail", { x: 46, y: 97 }],
  ["cape", { x: 60, y: 64 }],
  ["arm-far", { x: 74, y: 72 }],
  ["leg-far", { x: 67, y: 99 }],
  ["leg-near", { x: 56, y: 99 }],
  ["torso", { x: 62, y: 99 }],
  ["head", { x: 63, y: 66 }],
  ["arm-near", { x: 52, y: 72 }],
];
// The weapon hand at the end of the near arm.
export const RIG_HAND = { x: 70, y: 88 };

// Far limbs sit in shadow: the same shapes again in black at low opacity, so
// only painted pixels darken.
function shaded(svg) {
  const ink = svg
    .replace(/fill="(?!none)[^"]*"/g, 'fill="#000000"')
    .replace(/stroke="[^"]*"/g, 'stroke="#000000"');
  return `${svg}<g opacity="0.24">${ink}</g>`;
}

function tail(cat) {
  const d = "M46 98 C36 106 22 106 16 96 C11 88 13 78 18 72";
  return `<path d="${d}" stroke="${EDGE}" stroke-width="9.4" stroke-linecap="round" fill="none"/><path d="${d}" stroke="url(#fur)" stroke-width="7" stroke-linecap="round" fill="none"/>${
    cat.stripe
      ? `<path d="M30 103.5 l-1 4 M21 100 l-3 3 M15 88 l-4 0" stroke="${cat.stripe}" stroke-width="2.4" stroke-linecap="round"/>`
      : ""
  }<circle cx="18" cy="72" r="3.2" fill="${cat.fur[0]}"/>`;
}

function cape(hem) {
  return `<path d="M54 62 C44 74 36 94 31 116 C42 120 54 118 64 119 C67 106 70 84 72 64 Z" fill="url(#cape)" ${edge()}/><path d="M44 84 C41 96 39 106 38 115 M54 74 C52 90 51 104 52 117" stroke="#00000033" stroke-width="2.4" fill="none" stroke-linecap="round"/>${
    hem
      ? `<path d="M32 114 C43 118 54 116 64 117" stroke="url(#gold)" stroke-width="2.2" fill="none"/>`
      : ""
  }`;
}

// Armoured leg from the hip to a boot with its toe forward (right).
function leg(x, far, trim) {
  const dx = x - 56;
  const at = (v) => (v + dx).toFixed(1);
  const parts = `<path d="M${at(50)} 97 h12 l0.8 13 h-12.8 z" fill="url(#steel)" ${edge()}/><ellipse cx="${at(56.4)}" cy="104" rx="6.4" ry="4" fill="url(#steelv)" ${edge(1.1)}/>${
    trim
      ? `<path d="M${at(50.6)} 108 h11.8" stroke="url(#gold)" stroke-width="1.5"/>`
      : ""
  }<path d="M${at(48)} 110.5 h14.5 c3.4 0 6.6 2.4 7.4 5.6 v1.4 c0 1.4 -1 2.5 -2.4 2.5 h-19.5 c-1.2 0 -2 -1 -2 -2.2 z" fill="url(#steelv)" ${edge()}/><path d="M${at(51)} 115.5 h12" stroke="#ffffff" stroke-width="0.9" opacity="0.7"/>`;
  return far ? shaded(parts) : parts;
}

function torso(id, look) {
  const shell =
    "M47 70 C47 64 53 61 62 61 C72 61 78 65 79.5 72 L80.5 94 C80.5 99 73 102 63 102 C53 102 46 99 46 94 Z";
  let chest;
  if (look.torso === "scale") {
    const rows = [];
    for (let row = 0; row < 6; row++)
      for (let x = 48 + (row % 2) * 3.5; x < 78; x += 7)
        rows.push(`M${x} ${67 + row * 5} q3.5 5 7 0`);
    chest = `<path d="${shell}" fill="url(#iron)" ${edge()}/><path d="${rows.join("")}" fill="none" stroke="#2f343d" stroke-width="1"/><path d="${rows.join("")}" fill="none" stroke="#e3e7ee" stroke-width="0.6" opacity="0.5" transform="translate(0 -0.8)"/>`;
  } else
    chest = `<path d="${shell}" fill="url(#steel)" ${edge()}/><path d="M69 63 C71 74 71 88 69 100" stroke="#7d8595" stroke-width="1.2" fill="none"/><path d="M71 66 C75 68 77 72 77.5 78 L76 90 C74 88 72 84 71.5 80 Z" fill="#ffffff" opacity="0.34"/><path d="M48 80 C55 84 70 85 79 80 M48 88 C55 92 70 93 79 88" stroke="#6e7686" stroke-width="1" fill="none" opacity="0.7"/>${
      look.trim
        ? `<path d="M48 70 C53 66 60 64 66 64 C72 64 77 66 79 70" stroke="url(#gold)" stroke-width="1.8" fill="none"/><path d="M64 70 L69 75 L74 70" stroke="url(#gold)" stroke-width="1.6" fill="none"/>`
        : ""
    }`;
  const tassets =
    look.tassets === "scale"
      ? `<path d="M64 97 L64 109 L77 108 L78 96 Z M46 96 L45 106 L54 108 L56 98 Z" fill="url(#iron)" ${edge()}/>`
      : `<path d="M64 98 L64 109 C68 110 73 110 78 108 L78 96 Z M46 96 L45 106 C48 108 51 108 55 107 L56 98 Z" fill="url(#steelv)" ${edge()}/><path d="M64.5 107 C68 108 73 108 77.5 106" stroke="url(#gold)" stroke-width="1.4" fill="none"/>`;
  const belt = `<path d="M46 92 C54 96 74 96 80.5 92 L80.5 99 C74 103 54 103 46 99 Z" fill="url(#leather)" ${edge()}/><rect x="65" y="92.5" width="10" height="9" rx="1.6" fill="none" stroke="url(#gold)" stroke-width="2.4"/><path d="M70 95 v4" stroke="url(#gold)" stroke-width="1.6"/>`;
  const collar =
    id === "collector"
      ? `<path d="M48 63 C55 58 74 58 80 63 C78 69 70 71 63 71 C56 71 49 69 48 63 Z" fill="url(#cape)" ${edge()}/><circle cx="72" cy="66" r="4.4" fill="url(#gold)" ${edge(1)}/><path d="M70.4 65.4 a1.6 1.6 0 0 1 3.2 0 M71 67.8 h2" stroke="#6d4610" stroke-width="0.9" fill="none"/>`
      : id === "acrobat"
        ? `<path d="M47 63 C55 57 74 57 81 63 C78 70 70 72 63 72 C56 72 49 70 47 63 Z" fill="url(#cape)" ${edge()}/><path d="M49 64 C57 60 72 60 79 64" stroke="url(#gold)" stroke-width="1.3" fill="none"/><circle cx="71" cy="67" r="4.2" fill="url(#gold)" ${edge(1)}/>`
        : `<path d="M49 62 C56 58 73 58 80 62 C79 68 72 71 64 71 C56 71 50 68 49 62 Z" fill="url(#cape)" ${edge()}/><path d="M54 64 C59 67 70 67 75 64" stroke="#00000033" stroke-width="1.6" fill="none"/>`;
  // The near shoulder plate stays on the torso while the arm turns under it.
  return chest + tassets + belt + collar + pauldron(52);
}

// Three-quarter head facing right: the far eye is narrower and the muzzle
// sits forward of centre.
function head(id, cat, look) {
  const ear = (tipX, baseL, baseR, inner) =>
    `<path d="M${baseL} 36 L${tipX} 5 L${baseR} 21 Z" fill="url(#fur)" ${edge()}/><path d="M${inner[0]} 31 L${inner[1]} 11 L${inner[2]} 22 Z" fill="${cat.ear}"/>`;
  const ears =
    ear(39, 34, 58, [38, 40.5, 52]) + ear(89, 72, 94, [76, 87.5, 91]);
  const shape = `<path d="M34 44 C33 27 47 17 64 17 C82 17 96 27 95 44 C95 51 93 56 89 59 L93 62 L86 62 C80 66 72 68 64 68 C56 68 49 66 45 62 L39 63 L41 60 C37 56 34 51 34 44 Z" fill="url(#fur)" ${edge()}/>`;
  const stripes = cat.stripe
    ? `<path d="M59 21 C60 25 60 29 59 32 L61 32 C62 28 62 24 61 21 Z M65 19.5 C65.6 24 65.6 28 65 32 L67 32 C67.6 28 67.6 24 67 19.5 Z M71 21 C70 25 70 29 71 32 L73 32 C74 28 74 24 73 21 Z M36 42 C40 41 43 42 45 44 C42 44 39 44 36 45 Z M36 49 C39 48.5 41 49.5 43 51 C40 51 38 51 36 52 Z" fill="${cat.stripe}" opacity="0.85"/>`
    : "";
  const mood = look.mood;
  const eye = (cx, rx) => {
    const lid =
      mood === "stern"
        ? `<path d="M${cx - rx} 43 C${cx - rx / 2.5} 39.5 ${cx + rx / 2.5} 39.5 ${cx + rx} 42" stroke="${EDGE}" stroke-width="2.4" fill="none" stroke-linecap="round"/><path d="M${cx - rx - 0.5} 40 C${cx - rx / 4} 38 ${cx + rx / 2} 38 ${cx + rx + 0.5} 40.5 L${cx + rx + 0.5} 37 L${cx - rx - 0.5} 37 Z" fill="url(#fur)"/>`
        : `<path d="M${cx - rx} 43.5 C${cx - rx / 2} 37.5 ${cx + rx / 2} 37.5 ${cx + rx} 43.5" stroke="${EDGE}" stroke-width="2" fill="none" stroke-linecap="round"/>`;
    const pupil = mood === "roar" ? 3.6 : 2.4;
    return `<ellipse cx="${cx}" cy="45" rx="${rx}" ry="7.8" fill="url(#iris)" ${edge(1.2)}/><ellipse cx="${cx + rx * 0.18}" cy="45.5" rx="${(pupil * rx) / 7.4}" ry="6" fill="#120b10"/><circle cx="${cx + rx * 0.4}" cy="42.2" r="2" fill="#ffffff"/><circle cx="${cx - rx * 0.3}" cy="48.6" r="0.9" fill="#ffffff" opacity="0.8"/>${lid}`;
  };
  const muzzle = `<path d="M62 53 C64 60 70 63 77 63 C84 63 89 59 90 53 C87 49 82 48 77 50 C71 48 65 49 62 53 Z" fill="${cat.muzzle}"/><path d="M74 50.8 h6.4 c0.6 0 0.9 0.6 0.5 1.1 l-2.7 2.8 c-0.5 0.5 -1.3 0.5 -1.9 0 l-2.8 -2.8 c-0.4 -0.5 -0.1 -1.1 0.5 -1.1 z" fill="#ee8f98" stroke="#a8555e" stroke-width="0.7"/>`;
  const mouth =
    mood === "roar"
      ? `<path d="M71 56.5 C73 63.5 82 63.5 84 56.5 C80 58 75 58 71 56.5 Z" fill="#7a2232" ${edge(1.2)}/><path d="M74 60.3 C75.5 62.3 79.5 62.3 81 60.3 C79.5 59.4 75.5 59.4 74 60.3 Z" fill="#f08a9a"/><path d="M72.6 57.4 l1.2 2.8 l1.2 -2.6 M80.4 57.6 l1.2 2.6 l1.2 -2.8" fill="#ffffff" stroke="${EDGE}" stroke-width="0.5"/>`
      : mood === "smile"
        ? `<path d="M77.4 54.2 v2.2 M77.4 56.4 C75.6 59.2 72.4 59.2 71.2 57.2 M77.4 56.4 C79.2 59.2 82.4 59.2 83.6 57.2" stroke="${EDGE}" stroke-width="1.5" fill="none" stroke-linecap="round"/>`
        : `<path d="M77.4 54.2 v2 M77.4 56.2 C76 57.8 73.6 57.8 72.6 56.8 M77.4 56.2 C78.8 57.8 81.2 57.8 82.2 56.8" stroke="${EDGE}" stroke-width="1.4" fill="none" stroke-linecap="round"/>`;
  const whiskers = `<path d="M86 55 C94 53 101 53 108 55 M86 57.5 C93 57 100 58 106 60.5 M63 55 C58 54 53 54 49 55" stroke="#ffffff" stroke-width="0.8" fill="none" opacity="0.85"/>`;
  return (
    ears +
    shape +
    stripes +
    eye(57, 7.2) +
    eye(81, 5.4) +
    muzzle +
    mouth +
    whiskers +
    headgear(id)
  );
}

function headgear(id) {
  if (id === "collector")
    return `<path d="M33 38 C33 20 48 11 64 11 C81 11 96 20 96 38 C92 36 86 34.5 80 34 L66 28 L50 34 C44 34.5 38 36 33 38 Z" fill="url(#steel)" ${edge()}/><path d="M66 11 L66 28" stroke="#8a92a3" stroke-width="1.4"/><path d="M34 37.5 C39 35.5 45 34.4 50.5 34 L66 28.4 L79.5 34 C84 34.4 90 35.5 95 37.5" stroke="url(#gold)" stroke-width="2.2" fill="none"/><path d="M33 38 C30 46 31 56 36 61 L40 58 C37 52 37 45 39 39 Z" fill="url(#steelv)" ${edge()}/><path d="M50 18 C54 15 59 14 62 14.5" stroke="#ffffff" stroke-width="2.4" opacity="0.6" fill="none" stroke-linecap="round"/>`;
  if (id === "guardian")
    return `<path d="M58 12 C55 2 64 -1 77 3 C85 5 89 12 87 18 C81 13 74 12 66 13 Z" fill="#c8202b" ${edge()}/><path d="M61 9 C67 5 77 5 83 10" stroke="#ff6a6a" stroke-width="1.6" fill="none" opacity="0.8"/><path d="M31 40 C31 22 46 12 64 12 C83 12 97 22 97 40 L97 42 L31 42 Z" fill="url(#steel)" ${edge()}/><path d="M31 30 H97 V40 H31 Z" fill="url(#steelv)" ${edge(1.1)}/><path d="M31 30 H97 M31 40 H97" stroke="url(#gold)" stroke-width="1.8"/>${[
      44, 52, 60, 74, 82, 90,
    ]
      .map(
        (x) =>
          `<rect x="${x - 1.6}" y="32.4" width="3.2" height="5.4" rx="0.8" fill="${EDGE}"/>`,
      )
      .join(
        "",
      )}<circle cx="32" cy="41" r="3.4" fill="url(#gold)" ${edge(1)}/><rect x="60" y="9.5" width="12" height="4.5" rx="1.6" fill="url(#gold)" ${edge(1)}/><path d="M44 19 C50 15 57 13.5 62 13.5" stroke="#ffffff" stroke-width="2.4" opacity="0.6" fill="none" stroke-linecap="round"/>`;
  if (id === "sprinter")
    return `<path d="M33 36 C33 18 47 9 64 9 C81 9 95 18 95 36 Z" fill="url(#iron)" ${edge()}/><path d="M41 18 C47 13 55 11 61 11" stroke="#ffffff" stroke-width="2.2" opacity="0.45" fill="none" stroke-linecap="round"/><path d="M65 9.2 H73 V33 H65 Z" fill="url(#gold)" ${edge(1)}/><path d="M32 31 C42 28.5 86 28.5 96 31 L96 37.5 C86 35 42 35 32 37.5 Z" fill="url(#gold)" ${edge()}/>${[
      38, 46, 54, 80, 88,
    ]
      .map((x) => `<circle cx="${x}" cy="33.6" r="1.4" fill="#5a3a0e"/>`)
      .join(
        "",
      )}<path d="M65.6 33 H72.4 V47 C72.4 49 70.9 50.5 69 50.5 C67.1 50.5 65.6 49 65.6 47 Z" fill="url(#iron)" ${edge()}/>`;
  return `<path d="M52 21 C46 12 38 15 42 22 C37 27 44 31 51 24 C56 32 64 29 60 23 C66 16 58 12 52 21 Z" fill="#e88aa0" ${edge()}/><ellipse cx="51.6" cy="22.6" rx="3" ry="2.6" fill="#d06d86" ${edge(1)}/>`;
}

function pauldron(cx) {
  return `<path d="M${cx - 11} 70 C${cx - 11} 62 ${cx + 6} 60 ${cx + 11} 68 C${cx + 7} 72 ${cx - 4} 74 ${cx - 11} 70 Z" fill="url(#steelv)" ${edge()}/><path d="M${cx - 9} 74 C${cx - 7} 69 ${cx + 6} 68 ${cx + 10} 73 C${cx + 6} 77 ${cx - 4} 78 ${cx - 9} 74 Z" fill="url(#steelv)" ${edge(1.1)}/><path d="M${cx - 10} 69.5 C${cx - 4} 72.5 ${cx + 6} 71.5 ${cx + 10} 67.5" stroke="url(#gold)" stroke-width="1.3" fill="none"/>`;
}
function armStroke(d) {
  return `<path d="${d}" stroke="${EDGE}" stroke-width="10.4" stroke-linecap="round" fill="none"/><path d="${d}" stroke="url(#steelv)" stroke-width="8" stroke-linecap="round" fill="none"/>`;
}

// Near arm holds the weapon; it turns under the torso's shoulder plate.
function armNear(look) {
  return `${armStroke(`M52 74 C58 78 64 82 ${RIG_HAND.x} ${RIG_HAND.y}`)}<path d="M60 80 l4.5 -3.6" stroke="url(#gold)" stroke-width="1.4"/>${gripHand(look.paw, RIG_HAND)}`;
}
// Far arm carries the shield forward, foreshortened in the three-quarter
// view; a cat without one rests its gauntlet in front of the belt.
function armFar(look) {
  const arm = shaded(armStroke("M74 74 C80 78 84 82 86 87"));
  if (!look.shield)
    return shaded(
      `${armStroke("M74 74 C80 78 84 82 86 87")}<rect x="81" y="83" width="11" height="10" rx="3.5" fill="url(#steelv)" ${edge()}/>`,
    );
  const cy = look.shield === "oval" ? 88 : 89;
  return `${arm}<g transform="translate(89 ${cy}) scale(0.64 1) translate(-27 -${cy})">${shield(look.shield)}</g>`;
}

export function rigPart(id, part) {
  const cat = CATS[id];
  const look = LOOK[id];
  const body = {
    tail: () => tail(cat),
    cape: () => cape(id !== "sprinter"),
    "arm-far": () => armFar(look),
    "leg-far": () => leg(67, true, look.trim),
    torso: () => torso(id, look),
    "leg-near": () => leg(56, false, look.trim),
    head: () => head(id, cat, look),
    "arm-near": () => armNear(look),
  }[part];
  if (!body) throw new Error(`Unknown rig part: ${part}`);
  return defs(cat) + body();
}
