import { BallIcon } from "./icons";
import { THRESHOLD } from "../hooks/usePullToRefresh";

const TRAVEL = 56;
/** The progress ring in the indicator's 36px box. */
const RING_RADIUS = 16;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/**
 * The pull progress marker: a ball turning inside a volt ring that fills as the
 * gesture grows, so the drag reads as winding the feed up rather than as a
 * generic spinner. The disc also scales in with the pull.
 *
 * Transform- and stroke-dashoffset-only (no height animation): it slides in
 * under the sticky TopBar and turns volt once armed, so the drag costs a
 * composite layer rather than a layout pass on the low-end webviews we target.
 *
 * Decorative by design — the TopBar refresh button carries the same action for
 * anyone not dragging, so this stays out of the accessibility tree.
 */
export function PullIndicator({ pull }: { pull: number }) {
  if (pull <= 0) return null;
  const progress = Math.min(pull / THRESHOLD, 1);
  const armed = pull >= THRESHOLD;
  const tone = armed ? "var(--volt)" : "var(--text-muted)";
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 top-1 z-10 flex justify-center"
      style={{
        transform: `translateY(${Math.round((progress - 1) * TRAVEL)}px)`,
        opacity: progress,
      }}
    >
      <span
        className="relative grid h-9 w-9 place-items-center rounded-full border bg-elevated"
        style={{
          borderColor: armed ? "var(--volt)" : "var(--border-subtle)",
          boxShadow: armed ? "0 0 14px -4px var(--volt)" : undefined,
          transform: `scale(${(0.86 + progress * 0.14).toFixed(3)})`,
        }}
      >
        {/* Progress ring: starts at twelve o'clock and draws clockwise as the
            pull approaches the threshold. */}
        <svg viewBox="0 0 36 36" className="absolute inset-0 h-full w-full -rotate-90" aria-hidden="true">
          <circle
            cx="18"
            cy="18"
            r={RING_RADIUS}
            fill="none"
            stroke="var(--volt)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray={RING_LENGTH}
            strokeDashoffset={RING_LENGTH * (1 - progress)}
          />
        </svg>
        <BallIcon
          className="h-4 w-4"
          strokeWidth={2}
          style={{ color: tone, transform: `rotate(${Math.round(progress * 360)}deg)` }}
        />
      </span>
    </div>
  );
}
