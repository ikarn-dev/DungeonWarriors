// Pixel segmented control: a labelled group of toggle buttons, one pressed.
export function LobbySegment<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  readonly label: string;
  readonly options: readonly (readonly [T, string])[];
  readonly value: T;
  readonly onChange: (value: T) => void;
}) {
  return (
    <fieldset className="lobby-segment">
      <legend className="sr-only">{label}</legend>
      {options.map(([id, text]) => (
        <button
          key={id}
          type="button"
          className="pixel-button"
          data-tone={value === id ? "gold" : undefined}
          aria-pressed={value === id}
          onClick={() => onChange(id)}
        >
          {text}
        </button>
      ))}
    </fieldset>
  );
}
