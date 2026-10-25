import { memo, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import type { Match, Team } from "../types";
import { useI18n } from "../i18n/context";
import { usePrefetchMatch } from "../hooks/usePrefetch";
import { useCompetitionLabel } from "../hooks/useApi";
import { LiveDot, Num, TeamBadge } from "./ui";
import { ChevronRightIcon, StarFilledIcon } from "./icons";
import { cx } from "../lib/cx";

/**
 * The Matchday feed, per the shell redesign: the day's matches stop repeating
 * the league name on every card and group into ONE rounded container per
 * competition — a header row (teal square dot, league name, count on the far
 * end) above match rows separated by hairline dividers. Accent stays reserved
 * for followed clubs, live matches and the selected day; the rows themselves
 * carry no per-match border, shadow or edge accent.
 */

/** "۲۲" under fa-IR, "22" under en — every count here is localized digits. */
const digitFormatter = (locale: string | undefined) =>
  new Intl.NumberFormat(locale ?? "en", { useGrouping: false });

/**
 * Kickoff clock only — the weekday deliberately left the cards. `hour12:false`
 * keeps the 24h clock in English instead of "03:00 PM", which blew the 44px
 * time column; the string renders LTR-isolated inside the RTL row.
 */
const clockFormatter = (locale: string | undefined) =>
  new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hour12: false });

function LeagueHeader({ label, count }: { label: string; count: number }) {
  const { t, lang } = useI18n();
  return (
    // 30px header band: teal square dot, league name, count at the far end.
    <div className="flex items-center gap-2 px-3.5 py-[7px]">
      <span aria-hidden="true" className="h-2 w-2 flex-none rounded-sm bg-volt" />
      <span className="min-w-0 flex-1 truncate text-[12px] font-bold text-ink-2">{label}</span>
      <span className="flex-none whitespace-nowrap text-[11px] leading-4 text-ink-3">
        <Num>{t(count === 1 ? "matches.matchCountOne" : "matches.matchCount", { count: digitFormatter(lang === "fa" ? "fa-IR" : "en").format(count) })}</Num>
      </span>
    </div>
  );
}

/** One team line of a match row: 22px crest + localized short name (+ star). */
function TeamLine({
  team,
  followed,
}: {
  team: Team;
  followed: boolean;
}) {
  const { localize } = useI18n();
  return (
    // The middle column is the scan path, so flex-none only the crest and
    // star; the name truncates before anything else yields width.
    <div className="flex min-w-0 items-center gap-[9px]">
      <span className="flex-none">
        <        TeamBadge team={team} size="xs" />
      </span>
      <span className="min-w-0 truncate text-sm font-medium">{localize(team.shortName)}</span>
      <StarFilledIcon
        className={cx("h-3 w-3 flex-none text-volt", !followed && "hidden")}
        aria-hidden="true"
      />
    </div>
  );
}

type MatchRowProps = {
  match: Match;
  /** `isFavorite` from the page's favorites hook — the rows never open their
   *  own favorites query (one SELECT per row would n-query the endpoint). */
  isFavoriteTeam: (teamId: string) => boolean;
  /** Position within the WHOLE day's render, for the entrance stagger. */
  index: number;
};

/** Memoized: the live feed re-renders its page every tick; rows never change. */
export const MatchRow = memo(function MatchRow({
  match,
  isFavoriteTeam,
  index = 0,
}: MatchRowProps) {
  const { t, lang, localize } = useI18n();
  const prefetchMatch = usePrefetchMatch();
  const isHalftime = match.isHalftime === true;
  const isLive = match.status === "live";
  const isFinished = match.status === "finished";
  const hasScore = isLive || isHalftime || isFinished;
  const home = localize(match.home.shortName);
  const away = localize(match.away.shortName);
  const clock = clockFormatter(lang === "fa" ? "fa-IR" : "en").format(new Date(match.kickoffAt));

  // The accessible name carries the state: score + minute when in play, final
  // score when finished, kickoff time when upcoming.
  const status = isLive
    ? `${t("status.live")} ${match.minute ?? ""}`.trim()
    : isHalftime
      ? t("timeline.halftime")
      : isFinished
        ? t("status.finished")
        : clock;
  const label = hasScore
    ? `${home} ${match.homeScore ?? 0}-${match.awayScore ?? 0}, ${away} ${match.awayScore ?? 0}, ${status}`
    : `${home} ${t("common.versus")} ${away}, ${clock}`;

  const homeFollowed = isFavoriteTeam(match.home.id);
  const awayFollowed = isFavoriteTeam(match.away.id);

  return (
    <li
      className="list-in"
      style={{
        "--stagger": `${Math.min(index, 8) * 30}ms`,
        contentVisibility: "auto",
        containIntrinsicSize: "auto 72px",
      } as CSSProperties}
    >
      <Link
        to={`/match/${match.id}`}
        onPointerDown={() => prefetchMatch(match.id)}
        aria-label={label}
        dir={lang === "fa" ? "rtl" : "ltr"}
        className="flex min-w-0 items-center gap-3 px-3.5 py-[9px] transition-[background-color] duration-[var(--t-fast)] hover:bg-elevated active:bg-elevated focus-visible:outline-2 focus-visible:outline-volt focus-visible:-outline-offset-2"
      >
        {/* Time column: 44px floor, centred. Normally the 24h clock fills the
            floor exactly; if user text scaling pushes the clock or its caption
            wider, the column grows instead of clipping or overlapping the team
            column — height-always, never sideways. */}
        <div dir="ltr" className="flex min-w-11 flex-none flex-col items-center gap-0.5 text-center">
          <span className="whitespace-nowrap text-[15px] font-bold leading-4 text-ink">
            <Num>{clock}</Num>
          </span>
          {isLive ? (
            <span className="flex items-center gap-1 text-[9px] font-bold leading-3 text-live">
              <LiveDot />
              <Num>{match.homeScore ?? 0}–{match.awayScore ?? 0}</Num>
            </span>
          ) : isHalftime ? (
            <span className="text-[9px] font-bold leading-3 text-gold">{t("timeline.halftime")}</span>
          ) : isFinished ? (
            <span dir="ltr" className="text-[9px] leading-3 text-ink-3">
              <Num>{match.homeScore ?? 0}–{match.awayScore ?? 0}</Num>
            </span>
          ) : (
            <span className="text-[9px] leading-3 text-ink-3">{t("matches.tehranTime")}</span>
          )}
        </div>

        {/* Middle column: home above, away below — the stacked-pairs layout.
            Persian names always win; English only where no name exists (the
            localize pass-through already guarantees that). */}
        <div className="flex min-w-0 flex-1 flex-col gap-[7px]">
          <TeamLine team={match.home} followed={homeFollowed} />
          <TeamLine team={match.away} followed={awayFollowed} />
        </div>

        {/* Far end: small muted chevron, pointing at the edge it opens from. */}
        <span className={cx("flex-none text-ink-3", lang === "fa" ? "rotate-180" : "")} aria-hidden="true">
          <ChevronRightIcon className="h-3.5 w-3.5" />
        </span>
      </Link>
    </li>
  );
});

type LeagueGroupProps = {
  /** Real competition slug of every match in `matches`. */
  league: string;
  /** The league's matches for the selected day, kickoff-sorted by the page. */
  matches: Match[];
  isFavoriteTeam: (teamId: string) => boolean;
  index: number;
};

export function LeagueGroup({ league, matches, isFavoriteTeam, index }: LeagueGroupProps) {
  // Competition from the MATCH, not the team (`home.league` is a big-five
  // alias that mislabels cups); the label hook dedupes its competition list
  // query across groups, so one row per league costs no extra request.
  const label = useCompetitionLabel(league);
  const first = matches[0];
  if (!first) return null;

  return (
    <section
      aria-label={label}
      className="list-in rounded-2xl overflow-hidden bg-surface border border-line"
      style={{ "--stagger": `${Math.min(index, 8) * 30}ms` } as CSSProperties}
    >
      <LeagueHeader label={label} count={matches.length} />
      {/* Rows under the header: 1px hairline dividers, no per-match borders. */}
      <ul className="divide-y divide-[#1d2b26]">
        {matches.map((match, rowIndex) => (
          <MatchRow key={match.id} match={match} isFavoriteTeam={isFavoriteTeam} index={index + rowIndex} />
        ))}
      </ul>
    </section>
  );
}
