import type Phaser from "phaser";

// Combat feedback (2026-11-24): numbers that pop and rise where HP changes,
// and HP bars whose lost chunk lingers, then drains, so each hit reads.
// Presentation only; every value comes from the simulated frame.
export type Change = "dealt" | "taken" | "heal";
const COLORS: Readonly<Record<Change, string>> = {
  dealt: "#ffe08a",
  taken: "#ff6b6b",
  heal: "#8ef08a",
};
const LIFE_MS = 820;
const HOLD_MS = 260;
// Fraction of a full bar drained per second after the hold.
const DRAIN = 1.4;
const INK = 0x1e1626;

type Pop = {
  text: Phaser.GameObjects.Text;
  born: number;
  x: number;
  y: number;
};
type Trail = {
  shown: number;
  last: number;
  hitAt: number;
  at: number;
  seen: boolean;
};
// Pops grow past full size, then settle: 0.6 → 1.25 → 1.
function popScale(t: number) {
  if (t < 0.12) return 0.6 + (t / 0.12) * 0.65;
  if (t < 0.28) return 1.25 - ((t - 0.12) / 0.16) * 0.25;
  return 1;
}

export function uiFont(): string {
  const family = getComputedStyle(document.documentElement)
    .getPropertyValue("--font-geist-sans")
    .trim();
  return family ? `${family}, Arial, sans-serif` : "Arial, sans-serif";
}

export class CombatFeedback {
  private pops: Pop[];
  private next = 0;
  private trails = new Map<string, Trail>();

  constructor(scene: Phaser.Scene, depth: number, font: string) {
    this.pops = Array.from({ length: 16 }, () => ({
      text: scene.add
        .text(0, 0, "", {
          fontFamily: font,
          fontSize: "20px",
          fontStyle: "800",
          color: COLORS.dealt,
          stroke: "#1e1626",
          strokeThickness: 5,
        })
        .setOrigin(0.5, 1)
        .setDepth(depth)
        .setVisible(false),
      born: -Infinity,
      x: 0,
      y: 0,
    }));
  }

  pop(x: number, y: number, amount: number, change: Change, time: number) {
    if (amount <= 0) return;
    const slot = this.pops[this.next];
    if (!slot) return;
    // Alternate sides so quick hits do not stack on one spot.
    const side = this.next % 2 === 0 ? -1 : 1;
    this.next = (this.next + 1) % this.pops.length;
    slot.born = time;
    slot.x = x + side * 7;
    slot.y = y;
    slot.text
      .setText(`${change === "heal" ? "+" : "\u2212"}${amount}`)
      .setColor(COLORS[change])
      .setFontSize(change === "dealt" ? "20px" : "18px")
      .setVisible(true);
  }

  update(time: number, still: boolean) {
    for (const p of this.pops) {
      if (!p.text.visible) continue;
      const t = (time - p.born) / LIFE_MS;
      if (t >= 1) {
        p.text.setVisible(false);
        continue;
      }
      const rise = still ? 0 : 1 - (1 - t) ** 3;
      p.text
        .setPosition(p.x, p.y - 34 * rise)
        .setScale(still ? 1 : popScale(t))
        .setAlpha(t > 0.55 ? 1 - (t - 0.55) / 0.45 : 1);
    }
  }

  // Marks every trail unseen; bars drawn this frame mark theirs again.
  begin() {
    for (const trail of this.trails.values()) trail.seen = false;
  }
  end() {
    for (const [key, trail] of this.trails)
      if (!trail.seen) this.trails.delete(key);
  }

  bar(
    g: Phaser.GameObjects.Graphics,
    key: string,
    cx: number,
    y: number,
    width: number,
    fraction: number,
    color: number,
    time: number,
    still: boolean,
  ) {
    const f = Math.max(0, Math.min(1, fraction));
    let trail = this.trails.get(key);
    if (!trail) {
      trail = { shown: f, last: f, hitAt: -Infinity, at: time, seen: true };
      this.trails.set(key, trail);
    }
    trail.seen = true;
    if (f < trail.last) trail.hitAt = time;
    const dt = Math.max(0, time - trail.at) / 1000;
    trail.at = time;
    trail.last = f;
    if (f >= trail.shown || still) trail.shown = f;
    else if (time - trail.hitAt > HOLD_MS)
      trail.shown = Math.max(f, trail.shown - DRAIN * dt);
    const x = cx - width / 2;
    g.fillStyle(INK, 0.92);
    g.fillRoundedRect(x - 2, y - 2, width + 4, 9, 4);
    g.fillStyle(0x3a2230);
    g.fillRoundedRect(x, y, width, 5, 2.5);
    if (trail.shown > f) {
      g.fillStyle(0xfff1cf, 0.85);
      g.fillRoundedRect(x, y, Math.max(2, width * trail.shown), 5, 2.5);
    }
    if (f > 0) {
      g.fillStyle(color);
      g.fillRoundedRect(x, y, Math.max(2, width * f), 5, 2.5);
      g.fillStyle(0xffffff, 0.35);
      g.fillRect(x + 1, y + 0.5, Math.max(0, width * f - 2), 1.5);
    }
  }
}
