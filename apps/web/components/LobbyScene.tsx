"use client";

import { useEffect, useRef } from "react";
import { lobbyMusic } from "../lib/audio/lobby-music";
import type { CatId } from "../lib/game/catalog";

type Walker = {
  el: HTMLElement;
  x: number;
  y: number;
  vy: number;
  target: number;
  speed: number;
  facing: 1 | -1;
  distance: number;
  restUntil: number;
};

const random = (min: number, max: number) => min + Math.random() * (max - min);

// Decorative lobby scene: the player's warrior cats march, rest and hop along
// the ground. Motion writes to the DOM directly, never through React state.
export default function LobbyScene({
  cats,
}: {
  readonly cats: readonly CatId[];
}) {
  const stage = useRef<HTMLDivElement>(null);
  const roster = cats.join(" ");
  useEffect(() => {
    const root = stage.current;
    if (!root || roster === "") return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const size = () =>
      root.querySelector<HTMLElement>("[data-cat]")?.offsetWidth ?? 120;
    const width = () => Math.max(0, root.clientWidth - size());
    const walkers: Walker[] = [];
    const elements = root.querySelectorAll<HTMLElement>("[data-cat]");
    elements.forEach((el, index) => {
      const x = ((index + 0.5) / elements.length) * width();
      walkers.push({
        el,
        x,
        y: 0,
        vy: 0,
        target: x,
        speed: 0,
        facing: index % 2 === 0 ? 1 : -1,
        distance: 0,
        restUntil: performance.now() + random(300, 2200),
      });
    });
    const paint = (w: Walker, marching: boolean) => {
      // Whole device pixels keep motion smooth and the art sharp.
      const dpr = window.devicePixelRatio || 1;
      const px = Math.round(w.x * dpr) / dpr;
      const stride = marching ? Math.sin(w.distance / 9) : 0;
      const py = Math.round((w.y + Math.abs(stride) * 4) * dpr) / dpr;
      const tilt = w.y > 0 ? -4 * w.facing : stride * 4;
      w.el.style.transform = `translate3d(${px}px, ${-py}px, 0) scaleX(${w.facing}) rotate(${tilt.toFixed(2)}deg)`;
      w.el.style.visibility = "visible";
    };
    const step = (w: Walker, now: number, dt: number, span: number) => {
      const scale = size() / 120;
      if (w.y > 0 || w.vy > 0) {
        w.vy -= 1900 * dt;
        w.y += w.vy * scale * dt;
        if (w.y <= 0) {
          w.y = 0;
          w.vy = 0;
        }
      }
      if (now < w.restUntil) {
        paint(w, false);
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
        w.speed = random(60, 110) * scale * 2;
        w.facing = w.target >= w.x ? 1 : -1;
      }
      const move = Math.min(Math.abs(w.target - w.x), w.speed * dt);
      w.x += move * w.facing;
      w.distance += move;
      if (w.y === 0 && w.vy === 0 && Math.random() < dt * 0.25) {
        w.vy = 380;
        lobbyMusic.hop(span > 0 ? (w.x / span) * 2 - 1 : 0);
      }
      if (Math.abs(w.target - w.x) < 1 && w.y === 0) {
        w.speed = 0;
        w.restUntil = now + random(900, 3200);
      }
      paint(w, w.y === 0);
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
        for (const walker of walkers) paint(walker, false);
        return;
      }
      last = performance.now();
      handle = requestAnimationFrame(tick);
    };
    const resize = () => {
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
  }, [roster]);

  return (
    <div className="lobby-scene" aria-hidden="true" ref={stage}>
      <div className="lobby-ground" />
      {cats.map((cat) => (
        <div key={cat} className="lobby-cat" data-cat={cat} />
      ))}
    </div>
  );
}
