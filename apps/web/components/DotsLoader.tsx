// Minimal loading state: three gold dots rising in turn. The label is for
// screen readers; under reduced motion the dots pulse in place instead.
export default function DotsLoader({
  label = "Loading",
}: {
  readonly label?: string;
}) {
  return (
    <output className="dots-loader">
      <span aria-hidden="true" />
      <span aria-hidden="true" />
      <span aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </output>
  );
}
