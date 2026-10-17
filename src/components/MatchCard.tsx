import { memo, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import type { Match } from "../types";
import { useI18n } from "../i18n/context";
import { usePrefetchMatch } from "../hooks/usePrefetch";
import { formatKickoff } from "../lib/format";
import { cx } from "../lib/cx";
import { Num, TeamBadge } from "./ui";

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

  const isLive = match.status === "live";
  const isFinished = match.status === "finished";
  const homeScore = match.homeScore ?? 0;
  const awayScore = match.awayScore ?? 0;

  // Middle column content: score or kickoff time.
  const midContent = (() => {
    if (isLive) {
      return (
        <span dir="ltr" className="flex flex-col items-center" aria-live="polite">
          <span className={cx("text-2xl font-bold", homeScore > awayScore ? "text-ink" : "text-ink-2")}>
            {homeScore}–{awayScore}
          </span>
          <span className="flex items-center gap-1 mt-0.5">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#ff5a4d]" />
            <Num className="text-[11px] text-ink-3">{match.minute}</Num>
          </span>
        </span>
      );
    }
    if (isFinished) {
      return (
        <span dir="ltr" className="text-2xl font-bold">
          {homeScore}–{awayScore}
        </span>
      );
    }
    return (
      <span dir="ltr" className="text-xl font-bold text-ink-2">
        {formatKickoff(new Date(match.kickoffAt), lang === "fa" ? "fa-IR" : undefined)}
      </span>
    );
  })();

  return (
    <li className="list-in" style={{ "--stagger": `${Math.min(index, 8) * 40}ms` } as CSSProperties}>
      <Link
        to={`/match/${match.id}`}
        onPointerDown={() => prefetchMatch(match.id)}
        aria-label={`${localize(match.home.shortName)} ${t("common.versus")} ${localize(match.away.shortName)}`}
        className="block rounded-card border bg-surface p-3 transition-[background-color] duration-[var(--t-fast)] hover:bg-elevated active:bg-elevated focus-visible:outline-2 focus-visible:outline-volt focus-visible:outline-offset-2"
        style={{
          borderColor: isLive
            ? "color-mix(in srgb, var(--live) 60%, transparent)"
            : "var(--line)",
          backgroundImage: isLive
            ? "linear-gradient(180deg, color-mix(in srgb, var(--live) 8%, transparent) 0%, transparent 50%)"
            : undefined,
        }}
      >
        {/* League label — small, muted, top-left. No status chip. */}
        <div className="mb-2 flex items-start justify-between gap-2">
          <span className="truncate text-[12px] font-bold text-ink-3">
            {match.gameweek > 0
              ? t("matches.cardMeta", {
                  league: t(`league.${match.home.league}`),
                  gw: match.gameweek,
                })
              : t(`league.${match.home.league}`)}
          </span>
        </div>

        {/* 3-column grid: team1 | mid | team2 */}
        <div className="grid grid-cols-[1fr_64px_1fr] items-center gap-2">
          {/* Left team */}
          <div className="flex flex-col items-start gap-1.5">
            <TeamBadge team={match.home} />
            <span className="truncate text-sm font-bold text-ink">
              {localize(match.home.shortName)}
            </span>
          </div>

          {/* Middle: score or kickoff — always LTR */}
          <div className="flex flex-col items-center justify-center">
            {midContent}
          </div>

          {/* Right team — right-aligned */}
          <div className="flex flex-col items-end gap-1.5">
            <TeamBadge team={match.away} />
            <span className="truncate text-sm font-bold text-ink">
              {localize(match.away.shortName)}
            </span>
          </div>
        </div>
      </Link>
    </li>
  );
});
