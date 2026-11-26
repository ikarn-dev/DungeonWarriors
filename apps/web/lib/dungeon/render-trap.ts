import type Phaser from "phaser";
import { GATE } from "./render-gates";
import type { DungeonRoom } from "./rooms";
import { PHYSICS } from "./rules";

// Trapped gate (2026-11-26; supersedes the 2026-11-25 effects that fired from
// above and beside the door). When the server reports that the chosen gate
// was the trap, its double door bursts open on a dark passage and the trap
// comes out of that doorway at the warrior standing in it: a blast of fire
// with smoke, a volley of arrows, or three spears. Projectiles start small
// and dim deep in the passage and grow as they come out, so they read as
// coming from inside. The warrior falls at TRAP_HIT_MS. One kind per room and
// gate. Presentation only; the server decided the outcome.
export type TrapKind = "flames" | "arrows" | "spears";
const KINDS: readonly TrapKind[] = ["flames", "arrows", "spears"];
export const TRAP_HIT_MS = 380;
const EMBER = "trap-ember";
const OPEN_MS = 160;

type Point = { x: number; y: number };
type Shot = { delay: number; from: Point; to: Point };

function emberTexture(scene: Phaser.Scene) {
  if (scene.textures.exists(EMBER)) return;
  const texture = scene.textures.createCanvas(EMBER, 64, 64);
  if (!texture) return;
  const context = texture.getContext();
  const fill = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  fill.addColorStop(0, "rgba(255,255,255,1)");
  fill.addColorStop(0.35, "rgba(255,255,255,0.6)");
  fill.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = fill;
  context.fillRect(0, 0, 64, 64);
  texture.refresh();
}

const clamp = (t: number) => Math.max(0, Math.min(1, t));
const easeOut = (t: number) => 1 - (1 - t) ** 3;

export class GateTrap {
  // Behind the warrior: the opened doorway. In front: the projectiles.
  private readonly back: Phaser.GameObjects.Graphics;
  private readonly front: Phaser.GameObjects.Graphics;
  private emitters: Phaser.GameObjects.Particles.ParticleEmitter[] = [];
  private startedAt: number | null = null;
  private kind: TrapKind = "flames";
  private gate: Point = { x: 0, y: 0 };
  private shots: Shot[] = [];
  private still = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly engine: typeof Phaser,
    depth: number,
    backDepth: number,
  ) {
    emberTexture(scene);
    this.front = scene.add.graphics().setDepth(depth);
    this.back = scene.add.graphics().setDepth(backDepth);
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
    this.startedAt = time;
    this.kind = KINDS[(room.index + gate.id) % KINDS.length] ?? "flames";
    this.gate = { x: gate.x, y: gate.y };
    this.still = still;
    const body = {
      x: (cat.x + PHYSICS.width / 2) / 256,
      y: (cat.y + PHYSICS.height) / 256 - 24,
    };
    // Launch points spread over the lower passage, deep inside the door.
    const inside = (i: number, n: number): Point => ({
      x: gate.x + ((i + 0.5) / n - 0.5) * GATE.half * 1.2,
      y: gate.y - 20 - ((i * 37) % 50),
    });
    if (this.kind === "arrows")
      this.shots = Array.from({ length: 6 }, (_, i) => ({
        delay: OPEN_MS + i * 50,
        from: inside(i, 6),
        to: { x: body.x + (i - 2.5) * 3, y: body.y - 8 + ((i * 11) % 22) },
      }));
    if (this.kind === "spears")
      this.shots = Array.from({ length: 3 }, (_, i) => ({
        delay: OPEN_MS + 40 + i * 30,
        from: inside(i, 3),
        to: { x: body.x + (i - 1) * 6, y: body.y - 6 + i * 9 },
      }));
    if (this.kind === "flames" && !still) this.blast();
  }

  // Fire wells out of the passage, growing as it comes toward the warrior,
  // with smoke rolling up past the arch.
  private blast() {
    const { x, y } = this.gate;
    const mouth = {
      type: "random",
      source: {
        getRandomPoint: (point: Phaser.Types.Math.Vector2Like) => {
          point.x = x + (Math.random() - 0.5) * GATE.half * 1.5;
          point.y = y - 12 - Math.random() * (GATE.spring - 20);
        },
      },
    };
    const delay = OPEN_MS - 40;
    this.emitters = [
      this.scene.add
        .particles(0, 0, EMBER, {
          emitZone: mouth,
          delay,
          duration: 1300,
          frequency: 12,
          quantity: 3,
          lifespan: { min: 380, max: 680 },
          speedX: { min: -55, max: 55 },
          speedY: { min: -95, max: -15 },
          scale: { start: 0.35, end: 1.9, ease: "Quad.easeOut" },
          alpha: { values: [0, 0.95, 0.7, 0] },
          tint: [0xfff3b0, 0xffc24a, 0xff8a24, 0xff5a1f, 0xd9341a],
          blendMode: this.engine.BlendModes.ADD,
        })
        .setDepth(this.front.depth + 1),
      this.scene.add
        .particles(0, 0, EMBER, {
          emitZone: mouth,
          delay: delay + 200,
          duration: 1400,
          frequency: 40,
          lifespan: { min: 900, max: 1400 },
          speedX: { min: -20, max: 20 },
          speedY: { min: -70, max: -35 },
          scale: { start: 0.8, end: 2.6 },
          alpha: { values: [0, 0.35, 0] },
          tint: [0x2a2430, 0x3a3340],
        })
        .setDepth(this.front.depth),
    ];
  }

  update(time: number) {
    this.back.clear();
    this.front.clear();
    if (this.startedAt === null) return;
    const t = this.still ? 1000 : time - this.startedAt;
    this.drawDoorway(t);
    if (this.kind === "arrows") this.drawArrows(t);
    else if (this.kind === "spears") this.drawSpears(t);
  }

  reset() {
    this.startedAt = null;
    for (const emitter of this.emitters) emitter.destroy();
    this.emitters = [];
    this.shots = [];
    this.back.clear();
    this.front.clear();
  }

  // The leaves swing open on a dark passage; for fire the passage glows.
  private drawDoorway(t: number) {
    const g = this.back;
    const { x, y } = this.gate;
    const { half, spring } = GATE;
    const top = y - spring;
    const open = easeOut(clamp(t / OPEN_MS));
    g.fillStyle(0x07050a);
    g.fillRect(x - half, top, half * 2, spring - 5);
    g.fillCircle(x, top, half);
    // Depth: the passage narrows into darkness.
    for (let i = 1; i <= 4; i++) {
      g.fillStyle(0x000000, 0.18);
      g.fillRect(
        x - half + i * 4,
        top + i * 3,
        (half - i * 4) * 2,
        spring - 5 - i * 3,
      );
    }
    if (this.kind === "flames") {
      const heat = clamp((t - 60) / 120) * clamp(1 - (t - 1500) / 400);
      g.fillStyle(0xff6a24, 0.55 * heat);
      g.fillRect(x - half, top, half * 2, spring - 5);
      g.fillCircle(x, top, half);
      g.fillStyle(0xffd27a, 0.6 * heat);
      g.fillRect(x - half * 0.55, top + 14, half * 1.1, spring - 19);
      g.fillCircle(x, top + 14, half * 0.55);
    }
    // Each leaf turns on its outer hinge and is seen edge-on, foreshortened.
    const leaf = half * (1 - 0.8 * open);
    for (const side of [-1, 1]) {
      const hinge = x + side * half;
      const edge = hinge - side * leaf;
      const lift = 6 * open;
      g.fillStyle(0x5b3a27);
      g.fillTriangle(
        hinge,
        top - half * 0.6,
        edge,
        top - half * 0.6 + lift,
        edge,
        y - 5 - lift,
      );
      g.fillTriangle(hinge, top - half * 0.6, hinge, y - 5, edge, y - 5 - lift);
      g.fillStyle(0x24212d);
      g.fillRect(Math.min(hinge, edge), top + 6, Math.abs(hinge - edge), 5);
      g.fillRect(Math.min(hinge, edge), top + 66, Math.abs(hinge - edge), 5);
    }
  }

  // Arrows fly out of the passage, growing from far to near, and stay lodged.
  private drawArrows(t: number) {
    const g = this.front;
    for (const shot of this.shots) {
      const p = this.still ? 1 : clamp((t - shot.delay) / 170);
      if (p <= 0) continue;
      const k = 0.35 + 0.65 * p;
      const x = shot.from.x + (shot.to.x - shot.from.x) * p;
      const y = shot.from.y + (shot.to.y - shot.from.y) * p;
      const angle = Math.atan2(
        shot.to.y - shot.from.y,
        shot.to.x - shot.from.x,
      );
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      // Lodged arrows sink in, leaving the shaft and fletching.
      const length = (p < 1 ? 26 : 18) * k;
      const tx = x - cos * length;
      const ty = y - sin * length;
      g.lineStyle(2.4 * k, 0x6b4222, 0.5 + 0.5 * p);
      g.lineBetween(tx, ty, x, y);
      if (p < 1) {
        g.fillStyle(0xd7dde6, 0.5 + 0.5 * p);
        g.fillTriangle(
          x + cos * 7 * k,
          y + sin * 7 * k,
          x - sin * 3.5 * k,
          y + cos * 3.5 * k,
          x + sin * 3.5 * k,
          y - cos * 3.5 * k,
        );
      }
      g.fillStyle(0xe9e2cf, 0.5 + 0.5 * p);
      g.fillTriangle(
        tx,
        ty,
        tx - cos * 7 * k - sin * 4 * k,
        ty - sin * 7 * k + cos * 4 * k,
        tx - cos * 7 * k + sin * 4 * k,
        ty - sin * 7 * k - cos * 4 * k,
      );
    }
  }

  // Spears drive out of the passage, thickening toward their tips, hold a
  // moment and pull back into the dark.
  private drawSpears(t: number) {
    const g = this.front;
    for (const shot of this.shots) {
      const thrust = this.still ? 1 : easeOut(clamp((t - shot.delay) / 140));
      const back = this.still ? 0 : clamp((t - 1500) / 260);
      const reach = thrust * (1 - back);
      if (reach <= 0) continue;
      const x = shot.from.x + (shot.to.x - shot.from.x) * reach;
      const y = shot.from.y + (shot.to.y - shot.from.y) * reach;
      const angle = Math.atan2(
        shot.to.y - shot.from.y,
        shot.to.x - shot.from.x,
      );
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const k = 0.4 + 0.6 * reach;
      // Shaft from the dark passage to the head.
      g.lineStyle(1.5, 0x3b2418, 1);
      g.lineBetween(shot.from.x, shot.from.y, x, y);
      g.lineStyle(3.5 * k, 0x6b4222, 1);
      g.lineBetween(
        shot.from.x + (x - shot.from.x) * 0.5,
        shot.from.y + (y - shot.from.y) * 0.5,
        x,
        y,
      );
      g.fillStyle(0xe6ebf2, 1);
      g.fillTriangle(
        x + cos * 15 * k,
        y + sin * 15 * k,
        x - sin * 5 * k,
        y + cos * 5 * k,
        x + sin * 5 * k,
        y - cos * 5 * k,
      );
      g.fillStyle(0x8a92a3, 1);
      g.fillRect(x - 2 * k, y - 2 * k, 4 * k, 4 * k);
    }
  }
}
