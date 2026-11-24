// Line icons for the metal UI; they take the current text colour.
const PATHS = {
  check: "M5 12.5l4.5 4.5L19 7.5",
  cross: "M6 6l12 12M18 6L6 18",
  alert: "M12 4v10M12 19.5v.01",
  copy: "M9 9h10v10H9zM5 15V5h10",
  power: "M12 3v9M6.3 6.6a8 8 0 1 0 11.4 0",
  back: "M15 5l-7 7 7 7",
} as const;
export type UiIconName = keyof typeof PATHS;

export function UiIcon({
  name,
  size = 16,
}: {
  readonly name: UiIconName;
  readonly size?: number;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
