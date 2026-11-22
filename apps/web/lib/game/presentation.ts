import { RULES_V1 } from "./rules";

export const UI_TOKENS = {
  background: "var(--background)",
  foreground: "var(--foreground)",
  font: "var(--font-geist-sans), Arial, Helvetica, sans-serif",
  amountFont: "var(--font-geist-mono), monospace",
  spacing: [4, 8, 12, 16, 24, 32],
  touchTargetCssPixels: 44,
  bodyFontCssPixels: 16,
  smallFontCssPixels: 14,
  focusRingCssPixels: 2,
  focusOffsetCssPixels: 2,
  feedbackMs: 100,
  reducedMotionMs: 0,
} as const;
export const GAME_VIEW = {
  width: RULES_V1.physics.viewportWidthPixels,
  height: RULES_V1.physics.viewportHeightPixels,
  hitboxWidth: RULES_V1.physics.hitboxWidthSubpixels / 256,
  hitboxHeight: RULES_V1.physics.hitboxHeightSubpixels / 256,
  imageRendering: "pixelated",
  antialias: false,
  emergencyCashOutDuringPortrait: true,
} as const;

// Full-screen run view. The world keeps its 540 px height and widens up to the
// generated lookahead (2 segments behind, 8 ahead of the runner); taller
// screens gain sky above. Rendering zooms by an integer so pixel art stays crisp.
export const RUN_VIEW = {
  height: GAME_VIEW.height,
  minWidth: GAME_VIEW.width,
  maxWidth: 1216,
  maxHeight: 720,
  runnerScreenX: 232,
  groundOffset: Math.round(GAME_VIEW.height * 0.18),
  maxZoom: 4,
} as const;
export function runViewport(cssWidth: number, cssHeight: number, dpr: number) {
  if (
    [cssWidth, cssHeight, dpr].some((n) => !Number.isFinite(n) || n <= 0) ||
    dpr > 8
  )
    throw new Error("INVALID_VIEWPORT");
  const aspect = cssWidth / cssHeight;
  let width = Math.round(RUN_VIEW.height * aspect);
  let height: number = RUN_VIEW.height;
  if (width < RUN_VIEW.minWidth) {
    width = RUN_VIEW.minWidth;
    height = Math.min(
      RUN_VIEW.maxHeight,
      Math.round(RUN_VIEW.minWidth / aspect),
    );
  }
  width = Math.min(RUN_VIEW.maxWidth, width);
  const display = Math.min(cssWidth / width, cssHeight / height) * dpr;
  const zoom = Math.max(1, Math.min(RUN_VIEW.maxZoom, Math.round(display)));
  return { width, height, zoom, skyRows: height - RUN_VIEW.height };
}
export type RunViewport = ReturnType<typeof runViewport>;

// Safe-area/control space is excluded by the caller before fitting the canvas.
export function fitGameViewport(width: number, height: number, dpr: number) {
  if (
    [width, height, dpr].some((n) => !Number.isFinite(n) || n <= 0) ||
    dpr > 8
  )
    throw new Error("INVALID_VIEWPORT");
  const fit = Math.min(width / GAME_VIEW.width, height / GAME_VIEW.height);
  const physicalScale = fit * dpr;
  const scale = physicalScale >= 1 ? Math.floor(physicalScale) / dpr : fit;
  const canvasWidth = GAME_VIEW.width * scale;
  const canvasHeight = GAME_VIEW.height * scale;
  return {
    scale,
    width: canvasWidth,
    height: canvasHeight,
    left: Math.floor(((width - canvasWidth) * dpr) / 2) / dpr,
    top: Math.floor(((height - canvasHeight) * dpr) / 2) / dpr,
    pixelAligned: physicalScale >= 1,
    gameplayAllowed: width >= height,
  };
}
export function logicalPointer(
  x: number,
  y: number,
  viewport: ReturnType<typeof fitGameViewport>,
) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const px = (x - viewport.left) / viewport.scale;
  const py = (y - viewport.top) / viewport.scale;
  return px >= 0 && py >= 0 && px < GAME_VIEW.width && py < GAME_VIEW.height
    ? { x: px, y: py }
    : null;
}

// Spin is cosmetic. It never changes the generated pickup collider or reward.
export function coinFrame(elapsedMs: number, reducedMotion: boolean): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0)
    throw new Error("INVALID_ANIMATION_TIME");
  return reducedMotion ? 0 : Math.floor(((elapsedMs % 1000) * 16) / 1000);
}
export function coinPlacement(
  surfaceY: number,
  rise: number,
  run: number,
  lift: number,
) {
  if (
    [surfaceY, rise, run, lift].some((n) => !Number.isFinite(n)) ||
    run <= 0 ||
    lift < 0
  )
    throw new Error("INVALID_SURFACE");
  return {
    coinY: surfaceY - lift,
    coinRotation: 0,
    shadowY: surfaceY,
    shadowRotation: Math.atan2(rise, run),
    anchor: { x: 16, y: 28 },
  };
}
