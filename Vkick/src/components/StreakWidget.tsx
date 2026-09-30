import { useQuery } from "@tanstack/react-query";
import { api, type ApiStreak } from "../lib/api";
import { useI18n } from "../i18n/I18nProvider";
import { Card, Chip, cx } from "./ui";

/**
 * Favorite-club streak (scoring-rules.md §6): how many consecutive anchor-club
 * matches you've scored on, and how far to the next one-time threshold bonus
 * (+2 at 3, +5 at 5, +10 at 10 — once each per season). A miss — including no
 * predictions at all — resets the run, so the widget shows the reset state
 * just as plainly as the hot hand.
 */
export function StreakWidget({ className }: { className?: string }) {
  const { t } = useI18n();
  // Streaks change on resolution (post-match), so a slow poll is enough.
  const query = useQuery({
    queryKey: ["myStreak"],
    queryFn: () => api.getMyStreak(),
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const streak: ApiStreak | null = query.data?.streak ?? null;
  if (query.isLoading || !streak) return null;

  const next = streak.nextThreshold;
  const gap = streak.nextThresholdGap ?? 0;
  const dotsNeeded = next ?? streak.current; // when all thresholds are paid, show the full run
  const dots = Math.min(Math.max(dotsNeeded, 1), 10);
  const filled = next !== null ? Math.min(streak.current, next) : dots;

  return (
    <Card className={cx("p-3", className)}>
      <div className="flex items-center gap-2">
        <span
          className={cx(
            "grid h-8 w-8 flex-none place-items-center rounded-full border text-sm",
            streak.active ? "border-volt text-volt" : "border-line text-ink-3",
          )}
          aria-hidden="true"
        >
          🔥
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-ink">{t("streak.title")}</p>
          <p className="truncate text-[11px] text-ink-3">
            {streak.active
              ? t("streak.activeSubtitle", { count: streak.current })
              : t("streak.idleSubtitle", { count: streak.current })}
          </p>
        </div>
        {next !== null ? (
          <Chip tone="volt">{t("streak.next", { count: gap, bonus: streak.nextBonus ?? 0 })}</Chip>
        ) : (
          <Chip tone="gold">{t("streak.maxed")}</Chip>
        )}
      </div>

      {/* Threshold dots: one per match toward the next bonus. */}
      <div className="mt-2 flex items-center gap-1" aria-hidden="true">
        {Array.from({ length: dots }, (_, i) => (
          <span
            key={i}
            className={cx(
              "h-1.5 flex-1 rounded-full",
              i < filled ? (streak.active ? "bg-volt" : "bg-ink-3/40") : "bg-line",
            )}
          />
        ))}
      </div>
    </Card>
  );
}
