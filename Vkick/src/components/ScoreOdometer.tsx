import { cx } from "./ui";

/**
 * Signature animation 2: score odometer.
 * Each character is keyed by its own value, so only the digit that actually
 * changed remounts and animates — the rest of the number stays perfectly still.
 */
export function ScoreOdometer({ value, className }: { value: number | null; className?: string }) {
  const text = value === null ? "–" : String(value);

  return (
    <span className={cx("num-display tabular-nums inline-flex overflow-hidden", className)}>
      {[...text].map((char, index) => (
        <span key={`${index}:${char}`} className="score-tick inline-block">
          {char}
        </span>
      ))}
    </span>
  );
}
