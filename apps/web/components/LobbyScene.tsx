"use client";

import { useEffect, useRef, useState } from "react";
import { MEDIA_ROOT, parseAssetManifest } from "../lib/game/assets";
import type { CatId } from "../lib/game/catalog";

type Clip = { start: number; count: number; fps: number };
type Sheet = {
  frames: number;
  idle: Clip;
  run: Clip;
  jump: Clip;
  fall: Clip;
  land: Clip;
};
type Walker = {
  el: HTMLElement;
  sheet: Sheet;
  x: number;
  y: number;
  vy: number;
  target: number;
  speed: number;
  facing: 1 | -1;
  distance: number;
  restUntil: number;
  landedAt: number;
};

const FRAME = 48;
const random = (min: number, max: number) => min + Math.random() * (max - min);

async function readSheets(signal: AbortSignal) {
  const response = await fetch(`${MEDIA_ROOT}/manifest.json`, { signal });
  if (!response.ok) throw new Error("ASSETS_NOT_READY");
  const manifest = parseAssetManifest(await response.json());
  const sheets = new Map<string, Sheet>();
  for (const asset of manifest.assets) {
    if (!asset.id.startsWith("cat-")) continue;
    const clip = (name: string): Clip => {
      const found = asset.clips.find((entry) => entry.name === name);
      if (!found) throw new Error("ASSETS_NOT_READY");
      return found;
    };
    sheets.set(asset.id.slice(4), {
      frames: asset.frames,
      idle: clip("idle"),
      run: clip("run"),
      jump: clip("jump"),
      fall: clip("fall"),
      land: clip("land"),
    });
  }
  return sheets;
}

// Decorative lobby scene: the player's cats wander, rest and hop along the
// ground. Motion writes to the DOM directly, never through React state.
export default function LobbyScene({
  cats,
}: {
  readonly cats: readonly CatId[];
}) {
  const stage = useRef<HTMLDivElement>(null);
  const [sheets, setSheets] = useState<Map<string, Sheet> | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    readSheets(controller.signal).then(setSheets, () => {
      // Without the manifest the scenery still renders; only the cats are absent.
    });
    return () => controller.abort();
  }, []);

  const roster = cats.join(" ");
  useEffect(() => {
    const root = stage.current;
    if (!root || !sheets || roster === "") return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const readScale = () =>
      Number(getComputedStyle(root).getPropertyValue("--ck")) || 3;
    let scale = readScale();
    const measure = () => {
      scale = readScale();
      for (const walker of walkers)
        walker.el.style.backgroundSize = `${walker.sheet.frames * FRAME * scale}px ${FRAME * scale}px`;
    };
    const width = () => Math.max(0, root.clientWidth - FRAME * scale);
    const walkers: Walker[] = [];
    const elements = root.querySelectorAll<HTMLElement>("[data-cat]");
    elements.forEach((el, index) => {
      const sheet = sheets.get(el.getAttribute("data-cat") ?? "");
      if (!sheet) return;
      const x = ((index + 0.5) / elements.length) * width();
      walkers.push({
        el,
        sheet,
        x,
        y: 0,
        vy: 0,
        target: x,
        speed: 0,
        facing: index % 2 === 0 ? 1 : -1,
        distance: 0,
        restUntil: performance.now() + random(300, 2200),
        landedAt: -Infinity,
      });
    });
    measure();
    const paint = (w: Walker, frame: number) => {
      // Whole device pixels keep motion smooth without blurring the sprite.
      const dpr = window.devicePixelRatio || 1;
      const px = Math.round(w.x * dpr) / dpr;
      const py = Math.round(w.y * dpr) / dpr;
      w.el.style.transform = `translate3d(${px}px, ${-py}px, 0) scaleX(${w.facing})`;
      w.el.style.backgroundPosition = `${-frame * FRAME * scale}px 0`;
      w.el.style.visibility = "visible";
    };
    const loop = (clip: Clip, now: number) =>
      clip.start + (Math.floor((now * clip.fps) / 1000) % clip.count);
    const step = (w: Walker, now: number, dt: number, span: number) => {
      if (w.y > 0 || w.vy > 0) {
        // Hop physics in art-scale pixels per second.
        w.vy -= 1900 * dt;
        w.y += w.vy * scale * dt;
        if (w.y <= 0) {
          w.y = 0;
          w.vy = 0;
          w.landedAt = now;
        }
      }
      if (now < w.restUntil) {
        paint(
          w,
          now - w.landedAt < 120 ? w.sheet.land.start : loop(w.sheet.idle, now),
        );
        return;
      }
      if (w.speed === 0) {
        let target = random(0, span);
        for (
          let tries = 0;
          tries < 4 && Math.abs(target - w.x) < span * 0.2;
          tries++
        )
          target = random(0, span);
        w.target = target;
        w.speed = random(60, 110) * scale;
        w.facing = w.target >= w.x ? 1 : -1;
      }
      const move = Math.min(Math.abs(w.target - w.x), w.speed * dt);
      w.x += move * w.facing;
      w.distance += move;
      if (w.y === 0 && w.vy === 0 && Math.random() < dt * 0.25) w.vy = 380;
      if (Math.abs(w.target - w.x) < 1 && w.y === 0) {
        w.speed = 0;
        w.restUntil = now + random(900, 3200);
      }
      const airborne = w.y > 0 || w.vy > 0;
      const frame = airborne
        ? w.vy > 0
          ? loop(w.sheet.jump, now)
          : loop(w.sheet.fall, now)
        : now - w.landedAt < 120
          ? w.sheet.land.start
          : w.sheet.run.start +
            (Math.floor(w.distance / (8 * scale)) % w.sheet.run.count);
      paint(w, frame);
    };
    let handle = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const span = width();
      for (const walker of walkers) step(walker, now, dt, span);
      handle = requestAnimationFrame(tick);
    };
    const start = () => {
      cancelAnimationFrame(handle);
      if (reduced.matches) {
        for (const walker of walkers) paint(walker, walker.sheet.idle.start);
        return;
      }
      last = performance.now();
      handle = requestAnimationFrame(tick);
    };
    const resize = () => {
      measure();
      if (reduced.matches) start();
    };
    window.addEventListener("resize", resize);
    reduced.addEventListener("change", start);
    start();
    return () => {
      cancelAnimationFrame(handle);
      window.removeEventListener("resize", resize);
      reduced.removeEventListener("change", start);
    };
  }, [sheets, roster]);

  return (
    <div className="lobby-scene" aria-hidden="true" ref={stage}>
      <div className="lobby-ground" />
      {cats.map((cat) => (
        <div key={cat} className="lobby-cat" data-cat={cat} />
      ))}
    </div>
  );
}
