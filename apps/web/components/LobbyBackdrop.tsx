import Image from "next/image";

// Ember positions are a fixed function of the index, so server and client
// render the same markup. CSS drives the motion (transform and opacity only)
// and hides it under reduced motion.
const EMBERS = Array.from({ length: 42 }, (_, i) => {
  const left = (i * 37 + (i % 5) * 11) % 100;
  const size = 2 + ((i * 7) % 4);
  const duration = 9 + ((i * 13) % 10);
  const delay = -((i * 29) % (duration * 10)) / 10;
  // Sideways sway bucket, styled in CSS.
  const drift = (i * 3) % 5;
  const tone = i % 6 === 0 ? "cool" : i % 3 === 0 ? "bright" : "warm";
  return { id: `ember-${i}`, left, size, duration, delay, drift, tone };
});

// Shared title and lobby backdrop: the moonlit castle, a vignette and embers
// rising from the torches below.
export default function LobbyBackdrop() {
  return (
    <div className="lobby-backdrop" aria-hidden="true">
      <Image
        src="/game_bg/home_bg.png"
        alt=""
        fill
        sizes="100vw"
        quality={80}
        className="lobby-backdrop-image"
      />
      <div className="lobby-backdrop-shade" />
      <div className="lobby-embers">
        {EMBERS.map((e) => (
          <span
            key={e.id}
            data-tone={e.tone}
            data-drift={e.drift}
            style={{
              left: `${e.left}%`,
              width: `${e.size}px`,
              height: `${e.size}px`,
              animationDuration: `${e.duration}s`,
              animationDelay: `${e.delay}s`,
            }}
          />
        ))}
      </div>
    </div>
  );
}
