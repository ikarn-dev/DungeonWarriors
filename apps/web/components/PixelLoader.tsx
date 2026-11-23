// Pixel running cat used for loading states. The label is for screen readers;
// the animation stops under reduced motion.
export default function PixelLoader({
  label = "Loading",
}: {
  readonly label?: string;
}) {
  return (
    <output className="pixel-loader">
      <span className="pixel-loader-cat" aria-hidden="true" />
      <span className="pixel-loader-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <span className="sr-only">{label}</span>
    </output>
  );
}
