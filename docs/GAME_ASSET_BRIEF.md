# PURRPS game asset brief

## Ownership and handoff

**User decision — 2026-11-17:** The user supplies the game artwork manually. Coins must look like dimensional gold coins rotating on the ramp in a flat 2D side-view game. This brief specifies the delivery; it does not generate artwork or add gameplay features.

We are at **P1-06 asset planning**. The developer will explicitly flag the asset handoff before **P2-05 Phaser scene integration**. Pure simulation, prediction and contract work can continue while artwork is prepared. Final media/version validation is part of P5-03; do not leave the first playable scene waiting until P5 to request its core art.

Start with one cat's run cycle, the gold coin spin and one grass/stone ramp material set. Check their scale and readability together before producing every cat animation. Then deliver the remaining first-scene assets. No real game entry should depend on missing media or a locally invented cat.

## Visual direction

- Side-view pixel-art arcade runner: Pop Cat identity, expressive face, blue scarf/goggles, forest, grass, stone, water and bridges. Preserve the same character identity across all four cat types.
- Use a consistent native pixel grid, crisp silhouettes, restrained shading and a shared upper-left light direction. Match outline thickness and shadow colors across cats, objects and terrain.
- Cats, gold coins and hazards must read immediately against quieter backgrounds. Reserve strong hazard shapes for collidable hazards; decoration must not resemble obstacles.
- Coins have shaded faces, a visible beveled rim and changing sidewall width. This supplies the 3D impression inside the 2D scene. Keep their finish consistent with the pixel art.
- Distinguish Collector, Acrobat, Guardian and Sprinter with restrained palette/face/accessory details and their power icon. Keep blue scarf/goggles recognizable. Cat levels 1–5 reuse the same art; upgrades change cooldowns, not costumes or body size.
- Rarity uses a shared frame/badge plus a text label: Common, Rare, Epic. Supply one upgrade symbol reused across those grades.

## Delivery formats and scale

These are **recommended authoring sizes**, chosen for the current 960 × 540 logical game view. They are presentation settings; they do not change the published physics. Confirm the first sample set before making all sheets.

| Asset type | Delivery | Authoring rules |
|---|---|---|
| Characters, pickups, effects, terrain | Lossless transparent RGBA PNG | Native 1× pixels; no JPEG, baked background or image upscaling |
| Animation | PNG sheet with equal-size cells + JSON frame metadata | Named clips, frame order, frame dimensions, duration/FPS, loop flag and anchor; untrimmed sheets are simplest |
| Packed atlas, if already available | PNG + matching Phaser-compatible JSON | Retain original PNG frames/source; include original sizes, trim offsets and pivots; do not rotate packed frames |
| Background layers | Separate PNGs | Opaque sky may be RGB; other layers transparent and horizontally seamless |
| Wordmark and interface icons | Existing logo PNGs; SVG for ordinary UI icons | Reuse `apps/web/public/logo.png` / `logo-no-bg.png`; text stays live in the UI |
| Font, if supplying one | Licensed WOFF2 + license | Pixel display face may be used for short game labels; keep balances and long text readable |
| Audio | WAV masters; OGG and MP3 web exports | 44.1 or 48 kHz; short effects mono, music/ambience stereo; no clipping; supply loop points where applicable |
| Editable sources | Original `.aseprite`, layered PSD or equivalent | Keep separate from runtime exports; include palette and usage/license information |

Keep logical sprite sizes at 1× even if you also supply an explicitly named 2× preview. Rendering uses nearest-neighbor sampling; viewport scaling must preserve the pixel grid as far as the device allows. Do not bake UI labels, prices, balances, cooldowns, rarity text or cat levels into images.

## Asset inventory

### First playable scene

| Set | What to supply | Suggested size / animation |
|---|---|---|
| Four cats | Collector / Magnet, Acrobat / Double Jump, Guardian / Shield, Sprinter / Extra Dash; each faces right | 48 × 48 cells; shared feet anchor `(24, 40)`; transparent margin for scarf/ears |
| Cat clips, per cat | Idle, run, jump, fall, dash, hit, defeat | Starting budget: 4 / 8 / 2 / 2 / 2 / 2 / 4 frames respectively; idle 6 FPS, run 12 FPS, dash 16 FPS, hit/defeat 10 FPS; jump/fall follow movement state |
| Grass/stone ramp materials | Tileable grass surface strip, stone/earth fill, left/right platform ends and underside | Grass strip 32 × 8; fill/end tiles 32 × 32; align seams and the visible collision edge |
| Bridge | Repeating deck, ends and supports | Deck 32 × 16; ends/supports 32 × 32; supports are decorative unless simulation says otherwise |
| Water | Seamless surface and fill | 32 × 32 cells; 4-frame surface loop around 6 FPS; avoid distracting sparkle |
| Hazard | One clearly dangerous obstacle silhouette and matching pit-edge treatment | 32 × 32 cells initially; exact occupied bounds follow P2's hazard geometry, not image transparency |
| Gold coin | Full rotating sheet and separate ground shadow | 16 × 32 × 32 frames, one 512 × 32 PNG; details below |
| Bonus star | One distinct score-only star sprite | 24 × 24; static is sufficient; optional 4-frame restrained twinkle |
| Four booster pickups | Magnet, Double Jump, Shield, Extra Dash symbols | 24 × 24 each, with distinct silhouettes; can reuse matching HUD symbols |
| Power feedback | Magnet ring, extra-jump burst, shield active/contact, extra-dash activation | Transparent 64 × 64 effect cells, 4–6 frames around 12 FPS; reuse across cats; no cosmetic trail catalog |
| Shared action feedback | Landing/dash dust, coin pickup, hit | 32 × 32 cells, 4–6 frames; short, pooled effects that leave hazards visible |
| Background | Sky, distant forest and near forest layers | 960 × 540 layers; horizontally seamless; separate near foliage so it never hides the route |
| HUD/control symbols | Jump, Dash, Boost, Cash Out, sound/mute, pause/status, rotate-device and the four powers | 24 × 24 icon canvas, optional 48 × 48 export; actual touch buttons remain at least 44 × 44 CSS px |

The current physics body is **24 × 28 logical pixels**, with a base pickup radius of **16 pixels**. The 48 × 48 cat frame includes transparent margin and accessories; it is not a 48 × 48 collision body. Keep feet stable between frames and provide the occupied artwork bounds. Physics and entity definitions remain authoritative.

Ramp artwork supplies repeatable **surface materials**, rather than one giant pre-painted course. The renderer follows generated terrain geometry, including rising/falling sections, while preserving its visible top edge. Do not draw a fixed full-level path or require an artist-made image for every possible slope. One sample showing flat, rising and falling material treatment is useful as a visual reference.

Cat clips show movement already determined by simulation. Jump height, dash duration and power duration are not encoded by a sheet's playback length; clips hold, loop or end according to game state. A defeat clip presents an outcome and never delays settlement or usable controls.

### Collection, shop and remaining screens

| Set | What to supply | Suggested format / size |
|---|---|---|
| Cat portraits | Four portraits matching the gameplay cats | Transparent PNG, 96 × 96; may reuse/crop a clean pose |
| Cat capsule | Shared closed/open cat capsule | 64 × 64 cells; optional short 6–8-frame opening clip; outcome is supplied by finalized game state |
| Upgrade capsule | Shared closed/open upgrade capsule, distinct from cat capsule | 64 × 64 cells; reuse opening timing/layout |
| Upgrade item | One common symbol, shown with three rarity treatments | 32 × 32 PNG or pixel-aligned vector; no per-level item catalog |
| Rarity treatment | Common / Rare / Epic frame or badge | Reusable border pieces or SVG; pair each with the live rarity label |
| Brand/UI | Existing logo, BTC/ETH/SOL/USDC marks, collection/shop/account/history/leaderboard/settings icons | SVG for UI, approved official token marks; size icons consistently at 20–24 px |
| Sound effects | Jump, dash, pickup, power activation, hit/loss, checkpoint, capsule open/reveal and UI action | Short WAV masters + OGG/MP3; reuse sounds where they convey the same event |
| Music/ambience | One gameplay loop and one forest ambience loop, if desired | WAV + OGG/MP3 with clean loop points; muted playback remains fully usable |

Buttons, panels, progress meters, timers, amounts, pending states and LEVEL UP text are rendered by the application. No full-screen image exports are needed. No extra skins, NFT variations, separate level outfits, fashion inventory or celebration asset catalog is required.

## Gold coin: dimensional rotation on a 2D ramp

**Required look:** An upright gold coin, visibly thick at its edge, spinning about its vertical axis while its world position remains anchored to the route. The scene stays side-on; this is a shaded sprite animation, not a 3D model or a flat disc spinning like a wheel.

Supply `coin-spin.png`: **16 equal 32 × 32 cells in one row**, total **512 × 32**, transparent RGBA. Frame names run `coin_spin_00` through `coin_spin_15`.

| Frames | Pose |
|---|---|
| 00 | Full front face |
| 01–03 | Front narrows through three-quarter views; shaded rim becomes more visible |
| 04 | Thin edge, still showing gold thickness |
| 05–07 | Rear face widens |
| 08 | Full rear face |
| 09–11 | Rear narrows toward the opposite edge |
| 12 | Opposite thin edge |
| 13–15 | Front widens back toward frame 00 |

- Start with **16 FPS**, one revolution per second. Do not duplicate frame 00 at the end; the wrap must be seamless.
- Keep the coin centered at `(16, 16)`, its main visible face about 24 px tall, with a consistent bottom/contact anchor at `(16, 28)`. Only projected width and shading change; the frame and pivot never wobble.
- Keep a visible 2–3-pixel gold rim/sidewall at edge-on poses. Shade the bevel, sidewall and face separately, with restrained highlights. Use a paw/cat mark if desired; avoid reversed lettering on the back.
- Supply `coin-shadow.png`, a separate **16 × 6** transparent pixel ellipse. Do not bake a shadow into the spin sheet.
- The renderer aligns the coin's contact anchor just above the sampled ramp surface and aligns its shadow with the local slope. The coin stays upright as the ramp rises/falls. For elevated pickup paths, keep the shadow on the surface beneath it.
- Default presentation has no extra bobbing or rolling down the slope. Coin positions come from the generated route; spin is cosmetic. The pickup collider does not become thinner when the sprite turns edge-on.
- Reuse the spin for designated and extra coins. A separate small marker/outline can identify checkpoint-eligible coins, with the HUD explaining the 3-of-5 target. A new currency design is unnecessary.
- With reduced motion, show the front face and static shadow. Pickup, checkpoint timing and score remain unchanged.

## File organization and metadata

Use lowercase kebab-case filenames and stable type identifiers: `collector`, `acrobat`, `guardian`, `sprinter`, `magnet`, `double-jump`, `shield`, `extra-dash`.

Deliver source/export folders together, for example:

```text
purrps-art-v1/
  sources/
  exports/
    cats/
    terrain/
    pickups/
    effects/
    backgrounds/
    ui/
    audio/
  asset-notes.json
  licenses/
```

`asset-notes.json` should describe each exported file's identifier, path, pixel dimensions, frame dimensions/count/order, clip names, playback timing, loop behavior, pivot/contact point and occupied bounds. Include seamless-repeat direction and audio loop points where relevant. A plain written sheet map is also acceptable for the initial sample; the developer converts it into the final versioned runtime manifest.

The final runtime destination is `apps/web/public/game-assets/v1/`, with a manifest recording stable IDs, dimensions/frame/anchor metadata and content hashes. This folder and manifest are created during integration, not populated with dummy artwork now. Published versions must remain available; a later art revision gets a new version instead of silently overwriting files referenced by a published catalog. Editable sources are not shipped in the public website output. Verification fixtures/config remain only in root `tests/`.

## Handoff acceptance

- The developer notifies the user before P2-05 needs real media, then checks the first cat + ramp + spinning coin together.
- Sheets open at their declared size; transparency is clean, fixed-cell alignment/pivots match, loops wrap without jumps, and ramp/background seams join.
- Cats, pickups and hazards remain distinct on the logical game view and supported landscape mobile screens; decoration does not hide collision surfaces.
- All supplied names, powers, rarity grades and upgrade visuals match the existing four-cat catalog. There are no unnecessary per-level variants.
- Entry checks load the required versioned media; missing files fail clearly before a new affected action. Artwork and animation never attest to grants, cash-out acceptance or settlement.
- User-run browser/device checks verify nearest-neighbor scaling, animation speed, reduced motion, loading, audio controls and frame/memory behavior. This brief alone does not verify those results.
