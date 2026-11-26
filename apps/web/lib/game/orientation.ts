// Touch devices held upright (2026-11-26): the app plays in landscape only.
// Media queries read the hardware pointer and the layout viewport, so a
// mobile browser's desktop mode still matches, while a narrow desktop window
// with a mouse does not. Keep in step with rotate-gate.css.
export const PORTRAIT_TOUCH = "(orientation: portrait) and (pointer: coarse)";
