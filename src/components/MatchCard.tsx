import { memo } from "react";
import { Link } from "react-router-dom";
import type { Match } from "../types";
import { useI18n } from "../i18n/I18nProvider";
import { useFavorites } from "../hooks/useFavorites";
import { usePrefetchMatch } from "../hooks/usePrefetch";
import { formatKickoff, formatKickoffDate } from "../lib/format";
import { ScoreOdometer } from "./ScoreOdometer";
import { Chip, LiveDot, Num, PredictionIcons, TeamBadge, cx } from "./ui";
import { PlayIcon, StarFilledIcon } from "./icons";

function StatusChip({ match }: { match: Match }) {
  const { t, lang } = useI18n();

  if (match.status === "live") {
    return (
      <Chip tone="live">
        <LiveDot />
        {t("status.live")} <Num>{match.minute}</Num>
      </Chip>
    );
  }
  if (match.status === "finished") {
    return <Chip tone="muted">{t("status.finished")}</Chip>;
  }
  // Upcoming: the real kickoff date replaces the generic SCHEDULED badge.
  return (
    <Chip tone="volt">
      <Num>{formatKickoffDate(new Date(match.kickoffAt), lang === "fa" ? "fa-IR" : undefined)}</Num>
    </Chip>
  );
}

/**
 * `flash` fires the volt goal sweep — set briefly by the caller when a goal lands,
 * so the card reads as part of the live moment rather than a static row.
 *
 * Memoized: the live feed re-renders its page every tick, and neither prop
 * changes between ticks, so the whole card tree is skipped.
 */
export const MatchCard = memo(function MatchCard({
  match,
  flash = false,
}: {
  match: Match;
  flash?: boolean;
}) {
  const { t, lang, localize } = useI18n();
  const { isFavorite } = useFavorites();
  const prefetchMatch = usePrefetchMatch();

  const homeLeading = (match.homeScore ?? 0) > (match.awayScore ?? 0);
  const awayLeading = (match.awayScore ?? 0) > (match.homeScore ?? 0);

  return (
    <li>
      <Link
        to={`/match/${match.id}`}
        onPointerDown={() => prefetchMatch(match.id)}
        className={cx(
          "relative block overflow-hidden rounded-card border p-3 transition-colors duration-[var(--t-fast)] hover:bg-elevated",
          flash ? "goal-flash border-volt/50 bg-elevated" : "border-line bg-surface",
        )}
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="label truncate text-ink-3">
            {match.gameweek > 0
              ? t("matches.cardMeta", {
                  league: t(`league.${match.home.league}`),
                  gw: match.gameweek,
                })
              : t(`league.${match.home.league}`)}
          </span>
          <StatusChip match={match} />
        </div>

        {/* One scoreline: "PSG ★ 2 – 1 CHE ★". Scores share a baseline with the
            separator, so the result reads as a single unit at a glance. */}
        <div className="flex items-center gap-2">
          <TeamBadge team={match.home} />
          <span className="min-w-0 flex-1 truncate text-sm font-bold text-ink">
            {localize(match.home.shortName)}
            {isFavorite(match.home.id) ? (
              <StarFilledIcon className="ms-1 inline-block h-3 w-3 align-[-1px] text-volt" />
            ) : null}
          </span>
          <ScoreOdometer
            value={match.homeScore}
            className={cx("flex-none text-2xl leading-none", homeLeading ? "text-ink" : "text-ink-2")}
          />
          <Num className="flex-none text-base text-ink-3">–</Num>
          <ScoreOdometer
            value={match.awayScore}
            className={cx("flex-none text-2xl leading-none", awayLeading ? "text-ink" : "text-ink-2")}
          />
          <span className="min-w-0 flex-1 truncate text-end text-sm font-bold text-ink">
            {isFavorite(match.away.id) ? (
              <StarFilledIcon className="me-1 inline-block h-3 w-3 align-[-1px] text-volt" />
            ) : null}
            {localize(match.away.shortName)}
          </span>
          <TeamBadge team={match.away} />
        </div>

        <div className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-2">
          <span className="text-[11px] text-ink-3">
            {formatKickoff(new Date(match.kickoffAt), lang === "fa" ? "fa-IR" : undefined)}
          </span>
          {match.status === "finished" ? (
            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-volt">
              <PlayIcon />
              {t("replay.title")}
            </span>
          ) : (
            <PredictionIcons kinds={match.predictions} />
          )}
        </div>
      </Link>
    </li>
  );
});
