import { memo, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import type { Match } from "../types";
import { useI18n } from "../i18n/context";
import { usePrefetchMatch } from "../hooks/usePrefetch";
import { useCompetitionLabel } from "../hooks/useApi";
import { formatKickoff } from "../lib/format";
import { LiveDot, Num, TeamBadge } from "./ui";

/**
 * Memoized: the live feed re-renders its page every tick, and neither prop
 * changes between ticks, so the whole card tree is skipped.
 */
export const MatchCard = memo(function MatchCard({
  match,
  index = 0,
}: {
  match: Match;
  /** Position in its list, for the entrance stagger. */
  index?: number;
}) {
  const { t, lang, localize } = useI18n();
  const prefetchMatch = usePrefetchMatch();
  const locale = lang === "fa" ? "fa-IR" : undefined;

  // Competition comes from the MATCH, not from the team: `home.league` is a
  // big-five alias that falls back to "PL" for cups and extra leagues, which
  // labelled every Champions League card "Premier League".
  const competition = useCompetitionLabel(match.league);

  const isHalftime = match.status === "halftime";
  const isLive = match.status === "live" || isHalftime;
  const isFinished = match.status === "finished";
  const hasScore = isLive || isFinished;
  const homeScore = match.homeScore ?? 0;
  const awayScore = match.awayScore ?? 0;
  const kickoff = formatKickoff(new Date(match.kickoffAt), locale);
  // Half-time has no minute on the clock; name the break instead of showing an
  // empty slot. The adapter currently folds halftime into "live", so this is
  // the defensive branch for data that still carries the real status.
  const minuteLabel = isHalftime ? match.minute || t("timeline.halftime") : match.minute;
  const home = localize(match.home.shortName);
  const away = localize(match.away.shortName);

  // The link's accessible name carries the state: score + minute when in play,
  // final score when finished, kickoff time when upcoming.
  const status = isLive
    ? `${t("status.live")} ${minuteLabel ?? ""}`.trim()
    : isFinished
      ? t("status.finished")
      : kickoff;
  const label = hasScore
    ? `${home} ${homeScore}, ${away} ${awayScore}, ${status}`
    : `${home} ${t("common.versus")} ${away}, ${kickoff}`;

  const meta =
    match.gameweek > 0 ? t("matches.cardMeta", { league: competition, gw: match.gameweek }) : competition;

  return (
    <li className="list-in" style={{ "--stagger": `${Math.min(index, 8) * 40}ms` } as CSSProperties}>
      <Link
        to={`/match/${match.id}`}
        onPointerDown={() => prefetchMatch(match.id)}
        aria-label={label}
        className="block rounded-card border bg-surface p-3 transition-[background-color] duration-[var(--t-fast)] hover:bg-elevated active:bg-elevated focus-visible:outline-2 focus-visible:outline-volt focus-visible:outline-offset-2"
        style={{
          borderColor: isLive ? "color-mix(in srgb, var(--live) 60%, transparent)" : "var(--line)",
          backgroundImage: isLive
            ? "linear-gradient(180deg, color-mix(in srgb, var(--live) 8%, transparent) 0%, transparent 50%)"
            : undefined,
        }}
      >
        <p className="mb-2 truncate text-xs font-bold text-ink-3">{meta}</p>

        <div className="grid grid-cols-[minmax(0,1fr)_72px_minmax(0,1fr)] items-center gap-2">
          <div className="flex min-w-0 flex-col items-start gap-1.5">
            <TeamBadge team={match.home} />
            <span className="line-clamp-2 break-words text-sm font-bold leading-tight text-ink">{home}</span>
          </div>

          {/* Middle: score or kickoff, always LTR */}
          <div dir="ltr" className="flex flex-col items-center gap-1 leading-none">
            {hasScore ? (
              <span className="text-2xl font-extrabold text-ink">
                {homeScore}–{awayScore}
              </span>
            ) : (
              <span className="text-xl font-bold text-ink-2">{kickoff}</span>
            )}
            {isLive ? (
              <span className="flex items-center gap-1 text-xs font-bold text-[color:var(--live)]">
                <LiveDot />
                <Num>{minuteLabel}</Num>
              </span>
            ) : isFinished ? (
              <span className="text-xs text-ink-3">{t("status.finished")}</span>
            ) : null}
          </div>

          <div className="flex min-w-0 flex-col items-end gap-1.5 text-end">
            <TeamBadge team={match.away} />
            <span className="line-clamp-2 break-words text-sm font-bold leading-tight text-ink">{away}</span>
          </div>
        </div>
      </Link>
    </li>
  );
});
