import type Phaser from "phaser";
import type { AssetManifest } from "../game/assets";
import type { CatId } from "../game/catalog";
import { type Enemy, enemyStats } from "./enemies";
import { AMBUSH_WARNING_TICKS } from "./generate";
import { DUSK, drawScenery } from "./render-scenery";
import type { DungeonRunner } from "./replay";
import { type DungeonRoom, type EnemyKind, moverSurface } from "./rooms";
import { PHYSICS } from "./rules";
import {
  type DungeonFrame,
  roomBudgetMs,
  SWING_TICKS,
  wardensLeft,
} from "./simulation";
import { WARRIORS } from "./warriors";

type Options = {
  runner: () => DungeonRunner | null;
  playing: () => boolean;
  now: () => number;
  reduced: () => boolean;
  onReady: () => void;
  onError: () => void;
  onTimeout: () => void;
  preloaded: ReadonlyMap<string, Blob>;
};
// Body art is 128 px with feet at y = 120; the cat stands about 66 px tall.
const BODY_SCALE = 0.56;
const WEAPON_SCALE = BODY_SCALE * 0.85;
const HAND = { x: 93 - 61, y: 86 - 120 };
// Top of each foe's body on its canvas (scripts/assets/enemy-art.mjs).
const ENEMY_TOP: Readonly<Record<EnemyKind, number>> = {
  slime: 66,
  skeleton: 26,
  bat: 44,
  warden: 10,
};
const ENEMY_FEET: Readonly<Record<EnemyKind, number>> = {
  slime: 120,
  skeleton: 120,
  bat: 90,
  warden: 120,
};
const POOL = 24;
type Ghost = { sprite: Phaser.GameObjects.Image; started: number };
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

export function renderDungeon(
  engine: typeof Phaser,
  parent: HTMLElement,
  manifest: AssetManifest,
  cat: CatId,
  options: Options,
) {
  const warrior = WARRIORS[cat];
  const weaponId = `weapon-${warrior.weapon}`;
  const weaponArt = manifest.assets.find((a) => a.id === weaponId);
  if (!weaponArt) throw new Error("ASSETS_NOT_READY");
  const grip = weaponArt.anchor;
  class DungeonScene extends engine.Scene {
    private scenery?: Phaser.GameObjects.Graphics;
    private live?: Phaser.GameObjects.Graphics;
    private body?: Phaser.GameObjects.Image;
    private weapon?: Phaser.GameObjects.Image;
    private mist?: Phaser.GameObjects.Rectangle;
    private foes: Phaser.GameObjects.Image[] = [];
    private ghosts: Ghost[] = [];
    private seen = new Map<
      number,
      { kind: EnemyKind; x: number; y: number; scale: number; flip: boolean }
    >();
    private labels: Phaser.GameObjects.Text[] = [];
    private sealed?: Phaser.GameObjects.Text;
    private lastRunner?: DungeonRunner | null;
    private notified = false;
    preload() {
      this.load.on("loaderror", () => options.onError());
      const urls: string[] = [];
      for (const [id, blob] of options.preloaded) {
        const url = URL.createObjectURL(blob);
        urls.push(url);
        const size = id.startsWith("weapon-") ? 192 : 256;
        this.load.svg(id, url, { width: size, height: size });
      }
      const release = () => {
        for (const url of urls.splice(0)) URL.revokeObjectURL(url);
      };
      this.load.once("complete", release);
      this.events.once("shutdown", release);
    }
    create() {
      this.scenery = this.add.graphics().setDepth(0);
      this.live = this.add.graphics().setDepth(6);
      this.foes = Array.from({ length: POOL }, () =>
        this.add.image(0, 0, "enemy-skeleton").setDepth(8).setVisible(false),
      );
      this.ghosts = Array.from({ length: 8 }, () => ({
        // A white silhouette that swells and fades where a foe was beaten.
        sprite: this.add
          .image(0, 0, "enemy-skeleton")
          .setTint(0xffffff)
          .setTintMode(engine.TintModes.FILL)
          .setDepth(8)
          .setVisible(false),
        started: -Infinity,
      }));
      this.weapon = this.add
        .image(0, 0, weaponId)
        .setOrigin(grip.x / 96, grip.y / 96)
        .setDisplaySize(96 * WEAPON_SCALE, 96 * WEAPON_SCALE)
        .setDepth(9);
      this.body = this.add
        .image(0, 0, `body-${cat}`)
        .setOrigin(61 / 128, 120 / 128)
        .setDisplaySize(128 * BODY_SCALE, 128 * BODY_SCALE)
        .setDepth(10);
      this.sealed = this.add
        .text(0, 0, "Defeat the warden to open the gates", {
          fontFamily: "Geist, Arial, sans-serif",
          fontSize: "15px",
          fontStyle: "600",
          color: "#fff1cf",
          backgroundColor: "#2f2b45",
          padding: { x: 10, y: 6 },
        })
        .setOrigin(0.5, 1)
        .setDepth(12)
        .setVisible(false);
      this.mist = this.add
        .rectangle(0, 0, 1, 600, DUSK.gas, 0.25)
        .setOrigin(0)
        .setDepth(15)
        .setScrollFactor(0);
      this.fit();
      options.onReady();
    }
    fit() {
      const width = Math.max(1, parent.clientWidth);
      const height = Math.max(1, parent.clientHeight);
      this.scale.resize(width, height);
      this.cameras.main.setSize(width, height).setZoom(height / 600);
    }
    private build(room: DungeonRoom) {
      if (this.scenery) drawScenery(this.scenery, room);
      for (const label of this.labels) label.destroy();
      this.labels = room.gates.map((gate) =>
        this.add
          .text(gate.x, gate.y - 118, String(gate.id + 1), {
            fontFamily: "Geist, Arial, sans-serif",
            fontSize: "18px",
            fontStyle: "700",
            color: "#fff1cf",
            backgroundColor: "#2f2b45",
            padding: { x: 7, y: 2 },
          })
          .setOrigin(0.5)
          .setDepth(5),
      );
      this.seen.clear();
      this.cameras.main.setBounds(0, 0, room.width, room.height);
    }
    override update(time: number) {
      try {
        this.paint(time);
      } catch {
        this.scene.pause();
        options.onError();
      }
    }
    private paint(time: number) {
      const runner = options.runner();
      if (runner && runner !== this.lastRunner) {
        this.lastRunner = runner;
        this.notified = false;
        this.build(runner.room);
      }
      if (!runner || !this.live) return;
      const frame = options.playing()
        ? runner.advance(options.now())
        : runner.frame;
      const still = options.reduced();
      const room = runner.room;
      const g = this.live;
      g.clear();
      this.drawMovers(g, room, frame);
      this.drawHourglass(g, room, frame, time, still);
      this.drawFoes(g, room, frame, time, still);
      this.drawWarnings(g, room, frame, time, still);
      this.drawCat(g, runner, frame, time, still);
      const open = wardensLeft(frame) === 0;
      const first = room.gates[0];
      if (this.sealed && first)
        this.sealed
          .setPosition(room.gates[1]?.x ?? first.x, first.y - 150)
          .setVisible(!open && !frame.timedOut);
      if (!open)
        for (const gate of room.gates) {
          g.fillStyle(
            DUSK.danger,
            still ? 0.5 : 0.35 + Math.sin(time / 260) * 0.15,
          );
          g.fillRect(gate.x - 26, gate.y - 60, 52, 6);
          g.fillRect(gate.x - 26, gate.y - 30, 52, 6);
        }
      const budget =
        roomBudgetMs(room, runner.cat, runner.rules) +
        (frame.hourglass ? runner.rules.hourglassMs : 0);
      const progress = Math.min(
        1,
        (frame.tick * 1000) / (budget * PHYSICS.ticksPerSecond),
      );
      const visibleWidth = this.scale.width / (this.scale.height / 600);
      this.mist
        ?.setSize(Math.max(1, visibleWidth * progress * 0.5), 600)
        .setAlpha(frame.timedOut ? 0.6 : 0.08 + progress * 0.22);
      if (frame.timedOut && !this.notified) {
        this.notified = true;
        options.onTimeout();
      }
    }
    private drawMovers(
      g: Phaser.GameObjects.Graphics,
      room: DungeonRoom,
      frame: DungeonFrame,
    ) {
      for (const m of room.movers) {
        const s = moverSurface(m, frame.tick);
        g.fillStyle(DUSK.ink);
        g.fillRoundedRect(s.x - 2, s.y - 2, s.width + 4, 22, 5);
        g.fillStyle(DUSK.gate);
        g.fillRoundedRect(s.x, s.y, s.width, 18, 4);
        g.fillStyle(DUSK.lip);
        g.fillRect(s.x + 2, s.y, s.width - 4, 3);
        g.fillStyle(DUSK.gold);
        g.fillCircle(s.x + 10, s.y + 11, 3);
        g.fillCircle(s.x + s.width - 10, s.y + 11, 3);
      }
    }
    private drawHourglass(
      g: Phaser.GameObjects.Graphics,
      room: DungeonRoom,
      frame: DungeonFrame,
      time: number,
      still: boolean,
    ) {
      if (frame.hourglass) return;
      const { x } = room.hourglass;
      const y = room.hourglass.y + (still ? 0 : Math.sin(time / 300) * 3);
      g.fillStyle(DUSK.halo, 0.18);
      g.fillCircle(x, y, 18);
      g.fillStyle(DUSK.gold);
      g.fillRect(x - 8, y - 12, 16, 3);
      g.fillRect(x - 8, y + 9, 16, 3);
      g.fillStyle(0xa8ecf5);
      g.fillTriangle(x - 6, y - 9, x + 6, y - 9, x, y);
      g.fillStyle(0xffe08a);
      g.fillTriangle(x - 6, y + 9, x + 6, y + 9, x, y);
    }
    private drawFoes(
      g: Phaser.GameObjects.Graphics,
      room: DungeonRoom,
      frame: DungeonFrame,
      time: number,
      still: boolean,
    ) {
      const present = new Set<number>();
      frame.enemies.forEach((e: Enemy, i) => {
        const sprite = this.foes[i];
        if (!sprite) return;
        const s = enemyStats(e.kind, room.level);
        const scale = s.height / (ENEMY_FEET[e.kind] - ENEMY_TOP[e.kind]);
        const cx = e.x / 256 + s.width / 2;
        const feet = e.y / 256 + s.height;
        const bob = still
          ? 0
          : e.kind === "bat"
            ? Math.sin(time / 90 + e.id) * 2
            : Math.abs(Math.sin(time / 140 + e.id)) * -1.5;
        const squash =
          e.kind === "slime" && !still
            ? 1 + Math.sin(time / 160 + e.id) * 0.06
            : 1;
        sprite
          .setTexture(`enemy-${e.kind}`)
          .setOrigin(0.5, ENEMY_FEET[e.kind] / 128)
          .setDisplaySize(128 * scale * (2 - squash), 128 * scale * squash)
          .setPosition(cx, feet + bob)
          .setFlipX(e.dir > 0)
          .setVisible(true);
        if (e.stagger > 0) sprite.setTint(0xffb8b8);
        else sprite.clearTint();
        present.add(e.id);
        this.seen.set(e.id, {
          kind: e.kind,
          x: cx,
          y: feet,
          scale,
          flip: e.dir > 0,
        });
        bar(
          g,
          cx,
          feet - s.height - 10,
          Math.max(26, s.width),
          e.hp / e.maxHp,
          DUSK.danger,
        );
      });
      for (let i = frame.enemies.length; i < this.foes.length; i++)
        this.foes[i]?.setVisible(false);
      for (const [id, spot] of this.seen) {
        if (present.has(id)) continue;
        this.seen.delete(id);
        if (still) continue;
        const ghost =
          this.ghosts.find((gh) => !gh.sprite.visible) ?? this.ghosts[0];
        ghost?.sprite
          .setTexture(`enemy-${spot.kind}`)
          .setOrigin(0.5, ENEMY_FEET[spot.kind] / 128)
          .setPosition(spot.x, spot.y)
          .setFlipX(spot.flip)
          .setVisible(true);
        if (ghost) {
          ghost.started = time;
          ghost.sprite.setData("scale", spot.scale);
        }
      }
      for (const ghost of this.ghosts) {
        if (!ghost.sprite.visible) continue;
        const t = (time - ghost.started) / 320;
        if (t >= 1) {
          ghost.sprite.setVisible(false);
          continue;
        }
        const scale = Number(ghost.sprite.getData("scale")) * (1 + t * 0.5);
        ghost.sprite.setDisplaySize(128 * scale, 128 * scale).setAlpha(1 - t);
      }
    }
    private drawWarnings(
      g: Phaser.GameObjects.Graphics,
      room: DungeonRoom,
      frame: DungeonFrame,
      time: number,
      still: boolean,
    ) {
      room.ambushes.forEach((ambush, i) => {
        const fired = frame.ambushes[i] ?? 0;
        if (fired === 0 || frame.tick >= fired + AMBUSH_WARNING_TICKS) return;
        if (!still && Math.floor(time / 120) % 2 === 1) return;
        for (const s of ambush.spawns) {
          const ground = room.surfaces[s.surface];
          const y =
            s.kind === "bat" || !ground
              ? s.y
              : ground.y +
                Math.trunc((ground.rise * (s.x - ground.x)) / ground.width) -
                70;
          g.fillStyle(DUSK.ink);
          g.fillRoundedRect(s.x - 11, y - 30, 22, 34, 6);
          g.fillStyle(DUSK.gold);
          g.fillRoundedRect(s.x - 9, y - 28, 18, 30, 5);
          g.fillStyle(DUSK.ink);
          g.fillRect(s.x - 2, y - 23, 4, 14);
          g.fillRect(s.x - 2, y - 6, 4, 4);
        }
      });
    }
    private drawCat(
      g: Phaser.GameObjects.Graphics,
      runner: DungeonRunner,
      frame: DungeonFrame,
      time: number,
      still: boolean,
    ) {
      const body = this.body;
      const weapon = this.weapon;
      if (!body || !weapon) return;
      const position = runner.position(options.now());
      const x = (position.x + PHYSICS.width / 2) / 256;
      const feet = (position.y + PHYSICS.height) / 256;
      const dir = frame.facing;
      const moving = frame.grounded && frame.axis !== 0 && !still;
      const step = moving ? Math.sin(time / 70) : 0;
      const lift = moving ? -Math.abs(step) * 3 : 0;
      const lean = moving
        ? step * 0.05
        : !frame.grounded && !still
          ? -0.04 * dir
          : 0;
      const stretch =
        !frame.grounded && !still ? (frame.vy < 0 ? 1.05 : 0.97) : 1;
      g.fillStyle(DUSK.ink, 0.3);
      g.fillEllipse(x, feet, 30, 6);
      body
        .setPosition(x, feet + lift)
        .setFlipX(dir < 0)
        .setRotation(frame.timedOut ? 1.3 * dir : lean)
        .setDisplaySize(
          128 * BODY_SCALE * (2 - stretch),
          128 * BODY_SCALE * stretch,
        )
        .setAlpha(
          frame.invuln > 0 && !still && Math.floor(time / 60) % 2 === 0
            ? 0.45
            : 1,
        );
      if (frame.timedOut) body.setTint(0x8f88ad);
      else body.clearTint();
      // Weapon swing: wind up, then sweep forward; the spear thrusts instead.
      const p = frame.swing > 0 ? 1 - frame.swing / SWING_TICKS : -1;
      let angle = 0.28;
      let reach = 0;
      if (p >= 0 && !still) {
        if (warrior.weapon === "spear") {
          angle = 1.45;
          reach = Math.sin(Math.min(1, p * 1.6) * Math.PI) * 16;
        } else angle = -1.1 + ease(Math.min(1, p * 1.5)) * 3;
      } else if (p >= 0) angle = 1.2;
      weapon
        .setPosition(
          x + (HAND.x * BODY_SCALE + reach) * dir,
          feet + lift + HAND.y * BODY_SCALE,
        )
        .setFlipX(dir < 0)
        .setRotation(angle * dir)
        .setAlpha(body.alpha)
        .setVisible(!frame.timedOut);
      bar(g, x, feet - 74, 40, frame.hp / warrior.hp, 0x7be07a);
      this.cameras.main.centerOn(Math.max(300, x + 120), 300);
    }
  }
  function bar(
    g: Phaser.GameObjects.Graphics,
    cx: number,
    y: number,
    width: number,
    fraction: number,
    color: number,
  ) {
    const f = Math.max(0, Math.min(1, fraction));
    g.fillStyle(DUSK.ink, 0.9);
    g.fillRoundedRect(cx - width / 2 - 2, y - 2, width + 4, 8, 3);
    g.fillStyle(0x4a2a3a);
    g.fillRoundedRect(cx - width / 2, y, width, 4, 2);
    if (f > 0) {
      g.fillStyle(color);
      g.fillRoundedRect(cx - width / 2, y, Math.max(2, width * f), 4, 2);
    }
  }
  const scene = new DungeonScene({ key: "Dungeon" });
  const game = new engine.Game({
    type: engine.AUTO,
    parent,
    backgroundColor: "#322e48",
    width: Math.max(1, parent.clientWidth),
    height: Math.max(1, parent.clientHeight),
    antialias: true,
    scene: [scene],
    audio: { noAudio: true },
  });
  const observer = new ResizeObserver(
    () => scene.scene?.isActive() && scene.fit(),
  );
  observer.observe(parent);
  return () => {
    observer.disconnect();
    game.destroy(true);
  };
}
