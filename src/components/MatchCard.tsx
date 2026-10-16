import { memo, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import type { Match } from "../types";
import { useI18n } from "../i18n/context";
import { useFavorites } from "../hooks/useFavorites";
import { usePrefetchMatch } from "../hooks/usePrefetch";
import { formatKickoff, formatKickoffDate } from "../lib/format";
import { ScoreOdometer } from "./ScoreOdometer";
import { cx } from "../lib/cx";
import { Chip, LiveDot, Num, PredictionIcons, TeamBadge } from "./ui";
import { StarFilledIcon, TargetIcon } from "./icons";

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
  index = 0,
}: {
  match: Match;
  flash?: boolean;
  /** Position in its list, for the entrance stagger. */
  index?: number;
}) {
  const { t, lang, localize } = useI18n();
  const { isFavorite } = useFavorites();
  const prefetchMatch = usePrefetchMatch();

  const homeLeading = (match.homeScore ?? 0) > (match.awayScore ?? 0);
  const awayLeading = (match.awayScore ?? 0) > (match.homeScore ?? 0);
  const isLive = match.status === "live";

  return (
    <li className="list-in" style={{ "--stagger": `${Math.min(index, 8) * 40}ms` } as CSSProperties}>
      {/* One transparent hit area covers the card body, so "tap anywhere opens
          the match" survives while the deadline link in the footer can sit
          above it as its own target (stretched-link pattern). The overlay is
          z-0 and the pick link z-10, both below the sticky header's z-20, so a
          card scrolling under the header never paints over it. */}
      <div
        className={cx(
          "relative overflow-hidden rounded-card border p-3 transition-[background-color,transform] duration-[var(--t-fast)] hover:bg-elevated active:scale-[0.99]",
          // A goal in flight owns the card; otherwise a live match wears the
          // cyan halo (see .live-glow), and everything else stays on the
          // neutral surface so live is the only card that glows.
          flash
            ? "goal-flash border-volt/50 bg-elevated"
            : isLive
              ? "live-glow bg-surface"
              : "border-line bg-surface",
        )}
      >
        <Link
          to={`/match/${match.id}`}
          onPointerDown={() => prefetchMatch(match.id)}
          aria-label={`${localize(match.home.shortName)} ${t("common.versus")} ${localize(match.away.shortName)}`}
          className="absolute inset-0 z-0 rounded-card focus-visible:outline-offset-[-4px]"
        />
        <div className="pointer-events-none">
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
        </div>

        <div className="mt-2 flex items-center justify-between gap-2 border-t border-line pt-1.5">
          <span className="text-[11px] text-ink-3">
            {formatKickoff(new Date(match.kickoffAt), lang === "fa" ? "fa-IR" : undefined)}
          </span>
          {match.status === "finished" ? (
            <PredictionIcons kinds={match.predictions} />
          ) : (
            /* The one action on this card with a deadline. Negative margins
               keep the pill visually small while the hit area stays on the
               44px floor; it sits above the stretched link at z-10. */
            <Link
              to={`/match/${match.id}?tab=predict`}
              onPointerDown={() => prefetchMatch(match.id)}
              aria-label={t("predict.makePicks")}
              className="relative z-10 -my-1.5 inline-flex min-h-11 items-center gap-1 rounded-full border border-volt px-2.5 text-[11px] font-bold text-volt transition-colors duration-[var(--t-fast)] hover:bg-elevated"
            >
              <TargetIcon className="h-3.5 w-3.5" />
              {match.predictions.length > 0 ? (
                <Num>{match.predictions.length}/5</Num>
              ) : (
                t("matchCard.predict")
              )}
            </Link>
          )}
        </div>
      </div>
    </li>
  );
});
