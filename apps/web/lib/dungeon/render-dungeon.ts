import type Phaser from "phaser";
import type { AssetManifest } from "../game/assets";
import type { CatId } from "../game/catalog";
import { type Enemy, enemyStats } from "./enemies";
import { EnemyRig } from "./render-enemy";
import { CombatFeedback, uiFont } from "./render-feedback";
import { GasSmog } from "./render-gas";
import { GATE } from "./render-gates";
import { drawHourglass, drawMovers, drawWarnings } from "./render-props";
import { DUSK, drawScenery } from "./render-scenery";
import { Torches } from "./render-torch";
import { GateTrap, TRAP_HIT_MS } from "./render-trap";
import { WarriorRig } from "./render-warrior";
import type { DungeonRunner } from "./replay";
import type { DungeonRoom, EnemyKind } from "./rooms";
import { PHYSICS } from "./rules";
import {
  type DungeonFrame,
  roomOver,
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
  onRoomOver: () => void;
  trap: () => number | null;
  preloaded: ReadonlyMap<string, Blob>;
};
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
const FLASH_MS = 90;
type Ghost = { sprite: Phaser.GameObjects.Image; started: number };
type Track = { px: number; py: number; x: number; y: number; hp: number };

export function renderDungeon(
  engine: typeof Phaser,
  parent: HTMLElement,
  manifest: AssetManifest,
  cat: CatId,
  options: Options,
) {
  const warrior = WARRIORS[cat];
  const font = uiFont();
  class DungeonScene extends engine.Scene {
    private scenery?: Phaser.GameObjects.Graphics;
    private props?: Phaser.GameObjects.Graphics;
    private shadows?: Phaser.GameObjects.Graphics;
    private live?: Phaser.GameObjects.Graphics;
    private rig?: WarriorRig;
    private feedback?: CombatFeedback;
    private gas?: GasSmog;
    private torches?: Torches;
    private trap?: GateTrap;
    private trapHurt = false;
    private foes: EnemyRig[] = [];
    private ghosts: Ghost[] = [];
    private seen = new Map<
      number,
      { kind: EnemyKind; x: number; y: number; scale: number; flip: boolean }
    >();
    private tracks = new Map<number, Track>();
    private flashed = new Map<number, number>();
    private labels: Phaser.GameObjects.Text[] = [];
    private sealed?: Phaser.GameObjects.Text;
    private lastRunner?: DungeonRunner | null;
    private lastTick = -1;
    private lastHp: number = warrior.hp;
    private lastResets = 0;
    private lastDefeated = 0;
    private ground: number | null = null;
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
      // Lifts sit under shadows and characters, like the static floors.
      this.props = this.add.graphics().setDepth(3);
      this.shadows = this.add.graphics().setDepth(4);
      this.live = this.add.graphics().setDepth(12);
      this.foes = Array.from(
        { length: POOL },
        () => new EnemyRig(this, engine, manifest, 8),
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
      this.rig = new WarriorRig(this, manifest, cat, 10);
      this.feedback = new CombatFeedback(this, 14, font);
      this.sealed = this.add
        .text(0, 0, "Defeat the warden to open the gates", {
          fontFamily: font,
          fontSize: "15px",
          fontStyle: "600",
          color: "#fff1cf",
          backgroundColor: "#0b1716",
          padding: { x: 10, y: 6 },
        })
        .setOrigin(0.5, 1)
        .setDepth(13)
        .setVisible(false);
      this.torches = new Torches(this, engine, 1);
      this.gas = new GasSmog(this, engine, 15);
      this.trap = new GateTrap(this, engine, 13, 2.5);
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
      this.torches?.build(room);
      for (const label of this.labels) label.destroy();
      this.labels = room.gates.map((gate) =>
        this.add
          // On the keystone's plate (render-gates.ts).
          .text(gate.x, gate.y - GATE.plate, String(gate.id + 1), {
            fontFamily: font,
            fontSize: "14px",
            fontStyle: "700",
            color: "#fbe7a6",
          })
          .setOrigin(0.5)
          .setDepth(5),
      );
      this.seen.clear();
      this.tracks.clear();
      this.flashed.clear();
      this.lastTick = -1;
      this.lastHp = warrior.hp;
      this.lastResets = 0;
      this.lastDefeated = 0;
      this.ground = null;
      this.gas?.reset();
      this.trap?.reset();
      this.trapHurt = false;
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
      if (
        !runner ||
        !this.live ||
        !this.props ||
        !this.shadows ||
        !this.feedback
      )
        return;
      const now = options.now();
      const frame = options.playing() ? runner.advance(now) : runner.frame;
      // Progress through the current tick, for smooth motion between ticks.
      const fraction = Math.max(
        0,
        Math.min(
          1,
          ((now - runner.startedAt) * PHYSICS.ticksPerSecond) / 1000 -
            frame.tick,
        ),
      );
      const still = options.reduced();
      const room = runner.room;
      const g = this.live;
      g.clear();
      this.props.clear();
      this.shadows.clear();
      this.feedback.begin();
      drawMovers(this.props, room, frame);
      this.torches?.update(time, still, this.cameras.main.worldView);
      drawHourglass(g, room, frame, time, still);
      const cat = runner.position(now);
      this.trap?.spring(time, room, options.trap(), cat, still);
      this.drawFoes(g, room, frame, fraction, time, still, {
        x: (cat.x + PHYSICS.width / 2) / 256,
        y: (cat.y + PHYSICS.height / 2) / 256,
      });
      drawWarnings(g, room, frame, time, still);
      this.drawCat(g, runner, frame, fraction, time, still);
      this.trap?.update(time);
      this.feedback.end();
      this.feedback.update(time, still);
      this.lastTick = frame.tick;
      const open = wardensLeft(frame) === 0;
      const first = room.gates[0];
      if (this.sealed && first) {
        // Over the gates, but kept inside the view so it never runs off
        // the edge of the screen.
        const view = this.cameras.main.worldView;
        const half = this.sealed.width / 2 + 16;
        const x = Math.max(
          view.x + half,
          Math.min(room.gates[1]?.x ?? first.x, view.right - half),
        );
        this.sealed
          .setPosition(x, first.y - 150)
          .setVisible(!open && !roomOver(frame));
      }
      // Sealed gates: two glowing red bars across each door, behind the cat.
      if (!open)
        for (const gate of room.gates) {
          this.props.fillStyle(
            DUSK.danger,
            still ? 0.55 : 0.4 + Math.sin(time / 260) * 0.15,
          );
          const w = GATE.half - 3;
          this.props.fillRect(gate.x - w, gate.y - 64, w * 2, 5);
          this.props.fillRect(gate.x - w, gate.y - 34, w * 2, 5);
        }
      if (frame.timedOut)
        this.gas?.start(time, () => this.cameras.main.worldView, still);
      this.gas?.update(time, this.cameras.main);
      if (roomOver(frame) && !this.notified) {
        this.notified = true;
        options.onRoomOver();
      }
    }
    // Foe positions between ticks, so they glide instead of stepping.
    private track(e: Enemy, tick: number, fraction: number) {
      let t = this.tracks.get(e.id);
      if (!t) {
        t = { px: e.x, py: e.y, x: e.x, y: e.y, hp: e.hp };
        this.tracks.set(e.id, t);
      } else if (tick !== this.lastTick) {
        t.px = tick === this.lastTick + 1 ? t.x : e.x;
        t.py = tick === this.lastTick + 1 ? t.y : e.y;
        t.x = e.x;
        t.y = e.y;
      }
      return {
        x: (t.px + (t.x - t.px) * fraction) / 256,
        y: (t.py + (t.y - t.py) * fraction) / 256,
        track: t,
      };
    }
    private drawFoes(
      g: Phaser.GameObjects.Graphics,
      room: DungeonRoom,
      frame: DungeonFrame,
      fraction: number,
      time: number,
      still: boolean,
      cat: { x: number; y: number },
    ) {
      const feedback = this.feedback;
      const shadows = this.shadows;
      if (!feedback || !shadows) return;
      const present = new Set<number>();
      frame.enemies.forEach((e: Enemy, i) => {
        const sprite = this.foes[i];
        if (!sprite) return;
        const s = enemyStats(e.kind, room.level);
        const scale = s.height / (ENEMY_FEET[e.kind] - ENEMY_TOP[e.kind]);
        const at = this.track(e, frame.tick, fraction);
        const cx = at.x + s.width / 2;
        const feet = at.y + s.height;
        if (e.hp < at.track.hp) {
          feedback.pop(
            cx,
            feet - s.height - 14,
            at.track.hp - e.hp,
            "dealt",
            time,
          );
          this.flashed.set(e.id, time);
        }
        at.track.hp = e.hp;
        const hitAge = time - (this.flashed.get(e.id) ?? -Infinity);
        const recoil = still ? 0 : Math.max(0, 1 - hitAge / 160);
        const bob =
          still || e.kind !== "bat" ? 0 : Math.sin(time / 90 + e.id) * 2;
        if (e.kind !== "bat")
          shadows
            .fillStyle(DUSK.ink, 0.35)
            .fillEllipse(cx, feet, s.width * 1.1, 7);
        sprite.update(
          {
            id: e.id,
            kind: e.kind,
            x: cx,
            feet: feet + bob,
            scale,
            flip: e.dir > 0,
            engaged:
              Math.abs(cx - cat.x) < s.width / 2 + 34 &&
              Math.abs(feet - s.height / 2 - cat.y) < s.height / 2 + 40,
            staggered: e.stagger > 0,
            flash: hitAge < FLASH_MS,
            recoil,
          },
          time,
          still,
        );
        present.add(e.id);
        this.seen.set(e.id, {
          kind: e.kind,
          x: cx,
          y: feet,
          scale,
          flip: e.dir > 0,
        });
        feedback.bar(
          g,
          `foe-${e.id}`,
          cx,
          feet - s.height - 12,
          Math.max(28, s.width),
          e.hp / e.maxHp,
          DUSK.danger,
          time,
          still,
        );
      });
      for (let i = frame.enemies.length; i < this.foes.length; i++)
        this.foes[i]?.hide();
      const beaten = frame.defeated > this.lastDefeated;
      this.lastDefeated = frame.defeated;
      for (const [id, spot] of this.seen) {
        if (present.has(id)) continue;
        this.seen.delete(id);
        const last = this.tracks.get(id);
        this.tracks.delete(id);
        this.flashed.delete(id);
        // The final blow removes whatever HP the foe had left.
        if (beaten && last && last.hp > 0)
          feedback.pop(spot.x, spot.y - 40, last.hp, "dealt", time);
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
    private drawCat(
      g: Phaser.GameObjects.Graphics,
      runner: DungeonRunner,
      frame: DungeonFrame,
      fraction: number,
      time: number,
      still: boolean,
    ) {
      const rig = this.rig;
      const feedback = this.feedback;
      if (!rig || !feedback || !this.shadows) return;
      const position = runner.position(options.now());
      const x = (position.x + PHYSICS.width / 2) / 256;
      const feet = (position.y + PHYSICS.height) / 256;
      // The cat stands about 64 px tall at BODY_SCALE.
      const head = feet - 84;
      let hurt = false;
      const sprung = this.trap?.started ?? null;
      const trapped = sprung !== null && time - sprung >= TRAP_HIT_MS;
      if (trapped && !this.trapHurt) {
        this.trapHurt = true;
        hurt = true;
      }
      if (frame.resets !== this.lastResets) {
        // A knockout respawns at the checkpoint with full HP; no heal pop.
        this.lastResets = frame.resets;
      } else if (frame.hp < this.lastHp) {
        feedback.pop(x, head, this.lastHp - frame.hp, "taken", time);
        hurt = true;
      } else if (frame.hp > this.lastHp)
        feedback.pop(x, head, frame.hp - this.lastHp, "heal", time);
      this.lastHp = frame.hp;
      if (frame.grounded) this.ground = feet;
      const ground = this.ground ?? feet;
      const height = Math.max(0, ground - feet);
      const spread = Math.max(0.45, 1 - height / 140);
      this.shadows
        .fillStyle(DUSK.ink, 0.4 * spread)
        .fillEllipse(x, ground, 40 * spread, 8 * spread);
      const swing =
        frame.swing > 0
          ? Math.max(0, Math.min(1, 1 - (frame.swing - fraction) / SWING_TICKS))
          : null;
      rig.update(
        {
          x,
          feet,
          dir: frame.facing,
          grounded: frame.grounded,
          // Walking means the player is steering; riding a lift is not.
          stepping: frame.axis !== 0 && frame.knock === 0,
          vy: frame.vy,
          swing,
          hurt,
          blink: frame.invuln > 0 && !still && Math.floor(time / 60) % 2 === 0,
          down: roomOver(frame) || trapped,
        },
        time,
        still,
      );
      feedback.bar(
        g,
        "cat",
        x,
        feet - 76,
        44,
        roomOver(frame) || trapped ? 0 : frame.hp / warrior.hp,
        // Gold while invulnerable after a hit or respawn.
        frame.invuln > 0 ? 0xfbe7a6 : 0x7be07a,
        time,
        still,
      );
      this.cameras.main.centerOn(Math.max(300, x + 120), 300);
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
    banner: false,
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
