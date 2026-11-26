// Shown instead of the app on touch devices held upright (rotate-gate.css).
// Server-rendered, so it is in place at first paint, before any script.
export default function RotateGate() {
  return (
    <section className="rotate-gate" aria-labelledby="rotate-gate-title">
      <svg
        className="rotate-gate-device"
        viewBox="0 0 64 64"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="22" y="8" width="20" height="36" rx="3.5" />
        <path d="M29 39h6" />
        <path d="M14 50a20 20 0 0 0 34 4" />
        <path d="M48 46v8h-8" />
      </svg>
      <h2 id="rotate-gate-title" className="rotate-gate-title">
        Rotate your device
      </h2>
      <p className="rotate-gate-text">Dungeon Warriors plays in landscape.</p>
    </section>
  );
}
