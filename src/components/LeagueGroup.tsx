import { memo, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import type { Match, Team } from "../types";
import { useI18n } from "../i18n/context";
import { usePrefetchMatch } from "../hooks/usePrefetch";
import { useCompetitionLabel } from "../hooks/useApi";
import { Num, TeamBadge } from "./ui";
import { StarFilledIcon } from "./icons";
import { cx } from "../lib/cx";
import { parseMinute } from "../lib/format";

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

/** One team line of a match row: localized short name (+ star). The crest
 *  lives in its own grid cell so it can be its own link to the team page. */
function NameLine({
  team,
  followed,
  className,
}: {
  team: Team;
  followed: boolean;
  className?: string;
}) {
  const { localize } = useI18n();
  return (
    // The name truncates before anything else yields width; the followed star
    // stays pinned at the end.
    <div className={cx("flex min-w-0 items-center gap-[9px]", className)}>
      <span className="min-w-0 truncate text-sm font-medium">{localize(team.shortName)}</span>
      <StarFilledIcon
        className={cx("h-3 w-3 flex-none text-volt", !followed && "hidden")}
        aria-hidden="true"
      />
    </div>
  );
}

/** Crest → club page. Its own real link layered OVER the row's stretched
 *  match link (nested <a> is invalid HTML, so the two are grid siblings — the
 *  match link's ::after claims every tap the crests don't). The invisible
 *  ::after pads the 22px badge out to a comfortable tap target. */
function CrestLink({ team, className }: { team: Team; className?: string }) {
  const { t, localize } = useI18n();
  return (
    <Link
      to={`/team/${team.id}`}
      aria-label={t("common.openTeam", { team: localize(team.name) })}
      className={cx(
        "relative flex h-[22px] w-[22px] items-center justify-center rounded-full"
        + " transition-opacity duration-[var(--t-fast)] hover:opacity-80"
        + " after:absolute after:-inset-x-2 after:-inset-y-1"
        + " focus-visible:outline-2 focus-visible:outline-volt focus-visible:-outline-offset-2",
        className,
      )}
    >
      <TeamBadge team={team} size="xs" />
    </Link>
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
  // Halftime reaches here as status "live" + isHalftime (matchFromApi folds
  // it), so "live" alone claims a break is running: isLive owns both the coral
  // minute/dot and the status label, and must lose to the break.
  const isLive = match.status === "live" && !isHalftime;
  const isFinished = match.status === "finished";
  // Not played: ESPN reports these under state "post" too, so they used to
  // render as finished 0-0 results. They carry no score and no countdown.
  const notPlayedLabel =
    match.status === "postponed"
      ? t("status.postponed")
      : match.status === "cancelled"
        ? t("status.cancelled")
        : match.status === "abandoned"
          ? t("status.abandoned")
          : null;
  const hasScore = isLive || isHalftime || isFinished;
  const pens =
    match.homePens != null && match.awayPens != null
      ? { home: match.homePens, away: match.awayPens }
      : null;
  const home = localize(match.home.shortName);
  const away = localize(match.away.shortName);
  const clock = clockFormatter(lang === "fa" ? "fa-IR" : "en").format(new Date(match.kickoffAt));
  // Live minute, Persian digits under fa: "۴۴′". The feed's `minute` is the
  // server's normalised clock ("44'"); only the numeric part is localized.
  // Added time is part of the clock: "90'+3'" is 90+3, not 90.
  const minute = parseMinute(match.minute);
  const digits = digitFormatter(lang === "fa" ? "fa-IR" : "en");
  const minuteLabel = minute
    ? `${digits.format(minute.base)}${minute.added ? `+${digits.format(minute.added)}` : ""}`
    : null;

  // The accessible name carries the state: score + minute when in play, final
  // score when finished, kickoff time when upcoming.
  const status = isLive
    ? `${t("status.live")} ${minuteLabel ?? ""}`.trim()
    : isHalftime
      ? t("matches.groupHalftime")
      : isFinished
        ? pens
          ? `${t("status.finished")}, ${pens.home}-${pens.away} ${t("match.pensShort")}`
          : match.decidedBy === "extra-time"
            ? t("match.aet")
            : t("status.finished")
        : (notPlayedLabel ?? clock);
  const label = hasScore
    ? `${home} ${match.homeScore ?? 0}-${match.awayScore ?? 0}, ${away} ${match.awayScore ?? 0}, ${status}`
    : `${home} ${t("common.versus")} ${away}, ${status}`;

  const homeFollowed = isFavoriteTeam(match.home.id);
  const awayFollowed = isFavoriteTeam(match.away.id);

  return (
    /* One grid, one row: time | crests | names | score. The match link sits
       in the TIME cell and its ::after stretches across the whole li, so the
       full row still opens the match — while the crest cells above it (later
       siblings, position:relative) win their own taps and go to the teams. */
    <li
      className="list-in relative grid grid-cols-[minmax(2.75rem,auto)_1.375rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-[7px] px-3.5 py-[9px] transition-[background-color] duration-[var(--t-fast)] hover:bg-elevated active:bg-elevated"
      dir={lang === "fa" ? "rtl" : "ltr"}
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
        dir="ltr"
        className="col-start-1 row-start-1 row-span-2 flex min-w-0 flex-col items-center justify-center gap-0.5 text-center after:absolute after:inset-0 focus-visible:after:outline-2 focus-visible:after:outline-volt focus-visible:after:-outline-offset-2"
      >
        {/* TIME + STATUS column. Upcoming: kickoff clock. Live: the minute in
            the live coral, in place of the kickoff time. Halftime: the break
            label. Finished: "پایان" in muted ink. 44px floor, centred. */}
        <div className="flex flex-col items-center justify-center gap-0.5 text-center">
          {isLive ? (
            minuteLabel ? (
              <span className="whitespace-nowrap text-[15px] font-bold leading-5 text-live">
                <Num>{minuteLabel}′</Num>
              </span>
            ) : (
              <span className="flex items-center gap-1 text-[15px] font-bold leading-5 text-live">
                <span className="live-dot" aria-hidden="true" />
              </span>
            )
          ) : isHalftime ? (
            <span className="flex-nowrap text-[10px] font-bold leading-4 text-gold">
              {t("matches.groupHalftime")}
            </span>
          ) : isFinished ? (
            // A cup tie that needed 120 minutes or spot kicks says so where the
            // clock would be; a plain 90-minute result stays "FT".
            <span className="text-[10px] font-bold leading-4 text-ink-3">
              {pens
                ? t("match.pensShort")
                : match.decidedBy === "extra-time"
                  ? t("match.aet")
                  : t("status.finished")}
            </span>
          ) : notPlayedLabel ? (
            <span className="text-[10px] font-bold leading-4 text-ink-3">{notPlayedLabel}</span>
          ) : (
            <span className="whitespace-nowrap text-[15px] font-bold leading-5 text-ink">
              <Num>{clock}</Num>
            </span>
          )}
        </div>

      </Link>

        {/* Crests + names: home above, away below — the stacked-pairs layout.
            Persian names always win; English only where no name exists (the
            localize pass-through already guarantees that). */}
        <CrestLink team={match.home} className="col-start-2 row-start-1" />
        <CrestLink team={match.away} className="col-start-2 row-start-2" />
        <NameLine team={match.home} followed={homeFollowed} className="col-start-3 row-start-1 min-w-0" />
        <NameLine team={match.away} followed={awayFollowed} className="col-start-3 row-start-2 min-w-0" />

        {/* SCORE column: bold, one number per team line, aligned with that
            team (the cells share the team line's 22px height and the same
            7px row gap). Blank for upcoming matches — an upcoming row only
            carries the kickoff clock. */}
        {hasScore ? (
          <div className="col-start-4 row-span-2 flex flex-none flex-col justify-center gap-[7px]">
            <span className="flex h-[22px] items-center">
              <Num className="text-[15px] font-extrabold text-ink">
                {match.homeScore ?? 0}
              </Num>
            </span>
            <span className="flex h-[22px] items-center gap-1">
              <Num className="text-[15px] font-extrabold text-ink">
                {match.awayScore ?? 0}
              </Num>
              {/* A shootout score sits beside the 120-minute score, so a tie
                  decided on spot kicks never reads as a draw. */}
              {pens ? (
                <span className="text-[10px] font-bold text-ink-3">
                  <Num dir="ltr">
                    ({digits.format(pens.home)}–{digits.format(pens.away)})
                  </Num>
                </span>
              ) : null}
            </span>
          </div>
        ) : null}
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
