import type Phaser from "phaser";
import type { DungeonRoom } from "./rooms";
import { PHYSICS } from "./rules";

// Trapped gate (2026-11-25): when the server reports that the chosen gate was
// the trap, the gate fights back before the result card shows. One of three
// traps fires from the doorway, chosen by room and gate: a gout of flame, a
// volley of arrows, or spears and floor spikes. The warrior falls at HIT_MS.
// Presentation only; the server decided the outcome.
export type TrapKind = "flames" | "arrows" | "spears";
const KINDS: readonly TrapKind[] = ["flames", "arrows", "spears"];
export const TRAP_HIT_MS = 380;
const EMBER = "trap-ember";
// Door geometry in render-scenery.ts: 44 wide, its arch top 106 above the floor.
const DOOR = { half: 22, top: 106 };

type Target = { x: number; feet: number };
type Arrow = { delay: number; from: Target; to: Target; angle: number };

function emberTexture(scene: Phaser.Scene) {
  if (scene.textures.exists(EMBER)) return;
  const texture = scene.textures.createCanvas(EMBER, 64, 64);
  if (!texture) return;
  const context = texture.getContext();
  const fill = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  fill.addColorStop(0, "rgba(255,255,255,1)");
  fill.addColorStop(0.35, "rgba(255,255,255,0.7)");
  fill.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = fill;
  context.fillRect(0, 0, 64, 64);
  texture.refresh();
}

export class GateTrap {
  private readonly g: Phaser.GameObjects.Graphics;
  private flames: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  private startedAt: number | null = null;
  private kind: TrapKind = "flames";
  private gate: Target = { x: 0, feet: 0 };
  private cat: Target = { x: 0, feet: 0 };
  private arrows: Arrow[] = [];
  private still = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly engine: typeof Phaser,
    private readonly depth: number,
  ) {
    emberTexture(scene);
    this.g = scene.add.graphics().setDepth(depth);
  }

  get started() {
    return this.startedAt;
  }

  // Fires once the server has named the trapped gate; cat is the warrior's
  // simulation position in subpixels.
  spring(
    time: number,
    room: DungeonRoom,
    gateId: number | null,
    cat: { x: number; y: number },
    still: boolean,
  ) {
    const gate = room.gates.find((g) => g.id === gateId);
    if (!gate || this.startedAt !== null) return;
    this.start(
      time,
      KINDS[(room.index + gate.id) % KINDS.length] ?? "flames",
      { x: gate.x, feet: gate.y },
      {
        x: (cat.x + PHYSICS.width / 2) / 256,
        feet: (cat.y + PHYSICS.height) / 256,
      },
      still,
    );
  }

  private start(
    time: number,
    kind: TrapKind,
    gate: Target,
    cat: Target,
    still: boolean,
  ) {
    if (this.startedAt !== null) return;
    this.startedAt = time;
    this.kind = kind;
    this.gate = gate;
    this.cat = cat;
    this.still = still;
    if (still) return;
    if (kind === "flames") {
      const { x, feet } = gate;
      this.flames = this.scene.add
        .particles(0, 0, EMBER, {
          emitZone: {
            type: "random",
            source: {
              getRandomPoint: (point: Phaser.Types.Math.Vector2Like) => {
                point.x = x - DOOR.half + Math.random() * DOOR.half * 2;
                point.y = feet - 10 - Math.random() * (DOOR.top - 30);
              },
            },
          },
          duration: 1500,
          frequency: 10,
          quantity: 4,
          lifespan: { min: 420, max: 820 },
          speedX: { min: -150, max: 150 },
          speedY: { min: -170, max: -30 },
          scale: { start: 0.55, end: 1.7, ease: "Sine.easeOut" },
          alpha: { values: [0, 0.95, 0.6, 0] },
          tint: [0xfff1a8, 0xffc24a, 0xff8a24, 0xff5a1f, 0xd9341a],
          blendMode: this.engine.BlendModes.ADD,
        })
        .setDepth(this.depth + 1);
    } else if (kind === "arrows") {
      // A fanned volley from the arch, aimed at the warrior's body.
      this.arrows = Array.from({ length: 7 }, (_, i) => {
        const from = {
          x: gate.x + (i % 2 === 0 ? -1 : 1) * (6 + i * 3),
          feet: gate.feet - DOOR.top + 14 + i * 4,
        };
        const to = {
          x: cat.x + (i - 3) * 4,
          feet: cat.feet - 26 - ((i * 7) % 22),
        };
        return {
          delay: i * 55,
          from,
          to,
          angle: Math.atan2(to.feet - from.feet, to.x - from.x),
        };
      });
    }
  }

  update(time: number) {
    const g = this.g;
    g.clear();
    if (this.startedAt === null) return;
    const t = time - this.startedAt;
    if (this.kind === "flames") this.drawGlow(t);
    else if (this.kind === "arrows") this.drawArrows(t);
    else this.drawSpears(t);
  }

  reset() {
    this.startedAt = null;
    this.flames?.destroy();
    this.flames = null;
    this.arrows = [];
    this.g.clear();
  }

  // The doorway glows white-hot and the light fades as the flames die down.
  private drawGlow(t: number) {
    const heat = this.still
      ? 0.6
      : Math.max(0, Math.min(1, t / 120)) * Math.max(0, 1 - (t - 1300) / 500);
    if (heat <= 0) return;
    const { x, feet } = this.gate;
    this.g.fillStyle(0xff7a2a, 0.22 * heat).fillCircle(x, feet - 52, 90);
    this.g
      .fillStyle(0xffd27a, 0.5 * heat)
      .fillRect(x - DOOR.half, feet - 84, DOOR.half * 2, 84);
    this.g.fillCircle(x, feet - 84, DOOR.half);
  }

  private drawArrows(t: number) {
    const g = this.g;
    for (const arrow of this.arrows) {
      const flight = this.still
        ? 1
        : Math.max(0, Math.min(1, (t - arrow.delay) / 180));
      if (flight <= 0) continue;
      const x = arrow.from.x + (arrow.to.x - arrow.from.x) * flight;
      const y = arrow.from.feet + (arrow.to.feet - arrow.from.feet) * flight;
      // Lodged arrows sink a little and stay with the fallen warrior.
      const cos = Math.cos(arrow.angle);
      const sin = Math.sin(arrow.angle);
      const tailX = x - cos * 26;
      const tailY = y - sin * 26;
      g.lineStyle(2.5, 0x6b4222, 1).lineBetween(tailX, tailY, x, y);
      g.fillStyle(0xd7dde6, 1).fillTriangle(
        x + cos * 7,
        y + sin * 7,
        x - sin * 3.5,
        y + cos * 3.5,
        x + sin * 3.5,
        y - cos * 3.5,
      );
      g.fillStyle(0xe9e2cf, 1).fillTriangle(
        tailX,
        tailY,
        tailX - cos * 7 - sin * 4,
        tailY - sin * 7 + cos * 4,
        tailX - cos * 7 + sin * 4,
        tailY - sin * 7 - cos * 4,
      );
    }
  }

  // Spikes burst from the floor across the doorway and two spears thrust
  // down from the arch; both pull back after a moment.
  private drawSpears(t: number) {
    const g = this.g;
    const rise = this.still ? 1 : Math.max(0, Math.min(1, (t - 120) / 220));
    const fall = this.still ? 0 : Math.max(0, Math.min(1, (t - 1600) / 300));
    const reach = rise * (1 - fall);
    if (reach <= 0) return;
    const { x, feet } = this.gate;
    for (let i = -4; i <= 4; i++) {
      const sx = x + i * 11;
      const height = (38 + ((i + 4) % 3) * 8) * reach;
      g.fillStyle(0x3a3f4d, 1).fillRect(
        sx - 2,
        feet - height + 8,
        4,
        height - 8,
      );
      g.fillStyle(0xd7dde6, 1).fillTriangle(
        sx - 4.5,
        feet - height + 10,
        sx + 4.5,
        feet - height + 10,
        sx,
        feet - height - 4,
      );
    }
    for (const side of [-1, 1]) {
      const fromX = x + side * DOOR.half;
      const fromY = feet - DOOR.top + 18;
      const toX = this.cat.x - side * 4;
      const toY = this.cat.feet - 34;
      const px = fromX + (toX - fromX) * reach;
      const py = fromY + (toY - fromY) * reach;
      const angle = Math.atan2(toY - fromY, toX - fromX);
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      g.lineStyle(4, 0x6b4222, 1).lineBetween(fromX, fromY, px, py);
      g.fillStyle(0xe6ebf2, 1).fillTriangle(
        px + cos * 14,
        py + sin * 14,
        px - sin * 5,
        py + cos * 5,
        px + sin * 5,
        py - cos * 5,
      );
    }
  }
}
