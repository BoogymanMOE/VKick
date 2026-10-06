import { RefreshIcon } from "./icons";
import { THRESHOLD } from "../hooks/usePullToRefresh";

const TRAVEL = 56;

/**
 * The pull progress marker. Transform-only (no height animation): it slides in
 * under the sticky TopBar and snaps to volt once armed, so the drag costs a
 * composite layer rather than a layout pass on the low-end webviews we target.
 *
 * Decorative by design — the TopBar refresh button carries the same action for
 * anyone not dragging, so this stays out of the accessibility tree.
 */
export function PullIndicator({ pull }: { pull: number }) {
  if (pull <= 0) return null;
  const progress = Math.min(pull / THRESHOLD, 1);
  const armed = pull >= THRESHOLD;
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
        className="grid h-9 w-9 place-items-center rounded-full border bg-elevated transition-colors duration-[var(--t-fast)]"
        style={{
          borderColor: armed ? "var(--volt)" : "var(--border-subtle)",
          color: armed ? "var(--volt)" : "var(--text-muted)",
        }}
      >
        <RefreshIcon
          className="transition-transform duration-[var(--t-fast)]"
          style={{ transform: `rotate(${Math.round(progress * 180)}deg)` }}
        />
      </span>
    </div>
  );
}
