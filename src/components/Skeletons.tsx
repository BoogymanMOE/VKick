import { cx } from "../lib/cx";

const bar = "shimmer rounded";

/**
 * Matchday feed loading state, shaped exactly like the live layout's league
 * group (rounded-16px container, teal-dot header band, kickoff-sorted rows
 * with a 44px time column and 22px crests) so the real feed swaps in without
 * a jump. Cups keeps the old MatchCardSkeleton — this one is Matches-only.
 */
export function LeagueGroupSkeleton({ groups = 2, rows = 3 }: { groups?: number; rows?: number }) {
  return (
    <div className="space-y-3" aria-hidden="true">
      {Array.from({ length: groups }, (_, group) => (
        <div key={group} className="overflow-hidden rounded-2xl border border-line bg-surface">
          <div className="flex items-center gap-2 px-3.5 py-[7px]">
            <span className={cx(bar, "h-2 w-2 rounded-sm")} />
            <span className={cx(bar, "h-3 w-28")} />
            <span className="flex-1" />
            <span className={cx(bar, "h-2.5 w-12")} />
          </div>
          {Array.from({ length: rows }, (_, row) => (
            <div
              key={row}
              className="flex items-center gap-3 border-t border-[#1d2b26] px-3.5 py-[9px]"
            >
              <div className="flex min-w-11 flex-none flex-col items-center gap-1">
                <span className={cx(bar, "h-3.5 w-9")} />
                <span className={cx(bar, "h-2 w-8")} />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-[7px]">
                <div className="flex items-center gap-[9px]">
                  {/* Inline radius (not a rounded-full class): the shimmer's
                      scoped `rounded` rule must not race it on CSS order. */}
                  <span className={cx(bar, "h-[22px] w-[22px]")} style={{ borderRadius: "9999px" }} />
                  <span className={cx(bar, "h-3.5 w-24")} />
                </div>
                <div className="flex items-center gap-[9px]">
                  <span className={cx(bar, "h-[22px] w-[22px]")} style={{ borderRadius: "9999px" }} />
                  <span className={cx(bar, "h-3.5 w-16")} />
                </div>
              </div>
              <span className={cx(bar, "h-3 w-3")} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Signature animation 8: 1.4s shimmer sweep, shaped like the real component.
 *  Height matches a filled match card (≈108px): verified in the Task 3 check. */
export function MatchCardSkeleton() {
  return (
    <li className="rounded-card border border-line bg-surface p-2">
      <div className="mb-1.5 flex items-center justify-between">
        <span className={cx(bar, "h-3 w-28")} />
        <span className={cx(bar, "h-5 w-16 rounded-md")} />
      </div>
      {/* Square crest placeholders, not circles: TeamBadge renders the crest in
          a square footprint so nothing changes shape when the card fills in. */}
      <div className="flex items-center gap-2">
        <span className={cx(bar, "h-8 w-8")} />
        <span className={cx(bar, "h-4 w-20")} />
        <span className="flex-1" />
        <span className={cx(bar, "h-7 w-5")} />
        <span className={cx(bar, "h-4 w-2")} />
        <span className={cx(bar, "h-7 w-5")} />
        <span className={cx(bar, "h-4 w-20")} />
        <span className={cx(bar, "h-8 w-8")} />
      </div>
      <div className="mt-2 flex items-center justify-between border-t border-line pt-1">
        <span className={cx(bar, "h-3 w-20")} />
        <span className={cx(bar, "h-5 w-24 rounded-full")} />
      </div>
    </li>
  );
}

export function TimelineSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <ul className="space-y-2 ps-4">
      {Array.from({ length: rows }, (_, index) => (
        <li key={index} className="rounded-card border border-line bg-surface p-3">
          <div className="flex items-center gap-2">
            <span className={cx(bar, "h-6 w-10 rounded-md")} />
            <span className={cx(bar, "h-5 w-20 rounded-md")} />
          </div>
          <span className={cx(bar, "mt-2 block h-3 w-3/4")} />
          <span className={cx(bar, "mt-1.5 block h-3 w-1/3")} />
        </li>
      ))}
    </ul>
  );
}

export function RowSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <ul className="space-y-2">
      {Array.from({ length: rows }, (_, index) => (
        <li key={index} className="flex items-center gap-3 rounded-card border border-line bg-surface p-3">
          <span className={cx(bar, "h-6 w-6 rounded-full")} />
          <div className="flex-1 space-y-1.5">
            <span className={cx(bar, "block h-3 w-32")} />
            <span className={cx(bar, "block h-2.5 w-20")} />
          </div>
          <span className={cx(bar, "h-6 w-8")} />
          <span className={cx(bar, "h-6 w-8")} />
        </li>
      ))}
    </ul>
  );
}

export function PanelSkeleton({ height = 120 }: { height?: number }) {
  return <div className={cx(bar, "w-full rounded-card")} style={{ height }} />;
}

/** Match-detail score hero: badges + big score line + status chip. */
export function ScoreHeroSkeleton() {
  return (
    <div className="rounded-card border border-line bg-surface p-4">
      <div className={cx(bar, "mx-auto mb-3 h-3 w-40")} />
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col items-center gap-2">
          <span className={cx(bar, "h-12 w-12 rounded-full")} />
          <span className={cx(bar, "h-3 w-14")} />
        </div>
        <span className={cx(bar, "h-9 w-20 rounded-md")} />
        <div className="flex flex-col items-center gap-2">
          <span className={cx(bar, "h-12 w-12 rounded-full")} />
          <span className={cx(bar, "h-3 w-14")} />
        </div>
      </div>
    </div>
  );
}

/** Predictions hub: the five mechanic cards, badge + two lines + chip each. */
export function PredictionsHubSkeleton() {
  return (
    <ul className="space-y-2">
      {Array.from({ length: 5 }, (_, i) => (
        <li key={i} className="rounded-card border border-line bg-surface p-3">
          <div className="flex items-center gap-2">
            <span className={cx(bar, "h-8 w-8 rounded-full")} />
            <div className="flex-1 space-y-1.5">
              <span className={cx(bar, "block h-3 w-36")} />
              <span className={cx(bar, "block h-2.5 w-48")} />
            </div>
            <span className={cx(bar, "h-5 w-14 rounded-md")} />
          </div>
          <div className="mt-2 flex justify-end">
            <span className={cx(bar, "h-9 w-20 rounded-full")} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Ratings list rows: badge, name+meta, crowd number, stat number. */
export function RatingsSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <ul className="space-y-2">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="flex items-center gap-3 rounded-card border border-line bg-surface p-3">
          <span className={cx(bar, "h-6 w-6 rounded-full")} />
          <div className="flex-1 space-y-1.5">
            <span className={cx(bar, "block h-3 w-32")} />
            <span className={cx(bar, "block h-2.5 w-24")} />
          </div>
          <span className={cx(bar, "h-6 w-10 rounded-md")} />
          <span className={cx(bar, "h-6 w-8 rounded-md")} />
        </li>
      ))}
    </ul>
  );
}

/** Stats tab: two team tables (header + 5 stat rows each). */
export function StatsTableSkeleton() {
  return (
    <div className="space-y-3">
      {[0, 1].map((t) => (
        <div key={t} className="overflow-hidden rounded-card border border-line bg-surface">
          <div className="flex items-center gap-2 border-b border-line p-3">
            <span className={cx(bar, "h-2.5 w-2.5 rounded-full")} />
            <span className={cx(bar, "h-3 w-24")} />
          </div>
          <div className="p-2">
            {Array.from({ length: 5 }, (_, i) => (
              <div
                key={i}
                className="flex items-center justify-between border-t border-line p-2 first:border-t-0"
              >
                <div className="flex items-center gap-2">
                  <span className={cx(bar, "h-3 w-24")} />
                  <span className={cx(bar, "h-2.5 w-10")} />
                </div>
                <div className="flex gap-6">
                  <span className={cx(bar, "h-3 w-4")} />
                  <span className={cx(bar, "h-3 w-4")} />
                  <span className={cx(bar, "h-3 w-4")} />
                  <span className={cx(bar, "h-3 w-4")} />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Lineups tab: segmented control + formation chips grid + bench rows. */
export function LineupsSkeleton() {
  return (
    <div className="space-y-3">
      <div className={cx(bar, "h-12 w-full rounded-full")} />
      <div className="rounded-card border border-line bg-surface p-3">
        <div className="mb-3 flex items-center gap-2">
          <span className={cx(bar, "h-6 w-6 rounded-full")} />
          <span className={cx(bar, "h-3 w-24")} />
          <span className={cx(bar, "ml-auto h-5 w-14 rounded-md")} />
        </div>
        <div className="grid grid-cols-4 gap-2">
          {Array.from({ length: 11 }, (_, i) => (
            <div key={i} className="flex flex-col items-center gap-1">
              <span className={cx(bar, "h-8 w-8 rounded-full")} />
              <span className={cx(bar, "h-2 w-12")} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Browse/Cups competition rows: badge + two lines + chevron. */
export function CompRowSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <ul className="space-y-2">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="flex items-center gap-3 rounded-card border border-line bg-surface p-3">
          <span className={cx(bar, "h-9 w-9 rounded-full")} />
          <div className="flex-1 space-y-1.5">
            <span className={cx(bar, "block h-3 w-36")} />
            <span className={cx(bar, "block h-2.5 w-24")} />
          </div>
          <span className={cx(bar, "h-4 w-3")} />
        </li>
      ))}
    </ul>
  );
}
