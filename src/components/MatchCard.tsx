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
  // Half-time is a neutral pause, not a running match: only `live` gets the red
  // dot and live tint. (The adapter folds halftime into "live" for the feed, so
  // this is the defensive branch for data that still carries the real status.)
  const isLive = match.status === "live";
  const isFinished = match.status === "finished";
  const hasScore = isLive || isHalftime || isFinished;
  const homeScore = match.homeScore ?? 0;
  const awayScore = match.awayScore ?? 0;
  const kickoff = formatKickoff(new Date(match.kickoffAt), locale);
  // Half-time has no minute on the clock; name the break instead of showing an
  // empty slot.
  const minuteLabel = isHalftime ? match.minute || t("timeline.halftime") : match.minute;
  const home = localize(match.home.shortName);
  const away = localize(match.away.shortName);

  // The link's accessible name carries the state: score + minute when in play,
  // final score when finished, kickoff time when upcoming.
  const status = isLive
    ? `${t("status.live")} ${minuteLabel ?? ""}`.trim()
    : isHalftime
      ? t("timeline.halftime")
      : isFinished
        ? t("status.finished")
        : kickoff;
  const label = hasScore
    ? `${home} ${homeScore}, ${away} ${awayScore}, ${status}`
    : `${home} ${t("common.versus")} ${away}, ${kickoff}`;

  const meta =
    match.gameweek > 0 ? t("matches.cardMeta", { league: competition, gw: match.gameweek }) : competition;

  return (
    <li
      className="list-in"
      style={{
        "--stagger": `${Math.min(index, 8) * 40}ms`,
        // Skip the off-screen render work for long matchdays: the browser still
        // reserves the card's footprint (contain-intrinsic-size ≈ one card),
        // so scrollbars and scroll anchoring don't shift, but layout/paint of
        // cards below the fold is deferred until they approach the viewport.
        contentVisibility: "auto",
        containIntrinsicSize: "auto 96px",
      } as CSSProperties}
    >
      <Link
        to={`/match/${match.id}`}
        onPointerDown={() => prefetchMatch(match.id)}
        aria-label={label}
        // The 3-column grid flips with `dir`, so home sits on the right and away
        // on the left in Persian; explicit so the card reads correctly even if
        // the shell ever stops setting dir on the root.
        dir={lang === "fa" ? "rtl" : "ltr"}
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
            ) : isHalftime ? (
              // Neutral (muted), not the live red: a break is not a goal.
              <span className="text-xs font-bold text-ink-3">{minuteLabel}</span>
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
