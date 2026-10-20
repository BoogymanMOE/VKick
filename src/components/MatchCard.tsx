import { memo, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import type { Match } from "../types";
import { useI18n } from "../i18n/context";
import { usePrefetchMatch } from "../hooks/usePrefetch";
import { useCompetitionLabel } from "../hooks/useApi";
import { formatKickoff } from "../lib/format";
import { kickoffParts } from "../lib/format";
import { LiveDot, Num, TeamBadge } from "./ui";
import { recordFlipFirst } from "../lib/flip";

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

  // The adapter folds `halftime` into `live` for the feed's sections, so the
  // raw status can no longer tell a break from a running match — `isHalftime`
  // carries the real value through.
  const isHalftime = match.isHalftime === true;
  // Half-time is a neutral pause, not a running match: only `live` gets the red
  // dot and live tint.
  const isLive = match.status === "live";
  const isFinished = match.status === "finished";
  const hasScore = isLive || isHalftime || isFinished;
  const homeScore = match.homeScore ?? 0;
  const awayScore = match.awayScore ?? 0;
  const kickoff = formatKickoff(new Date(match.kickoffAt), locale);
  // The three parts that sit on the dead centre of the card: weekday above the
  // clock, clock in the middle, period below. Persian (fa-IR) has no dayPeriod,
  // so the period row is an empty 23px spacer that keeps the clock vertically
  // centred regardless of script.
  const parts = kickoffParts(new Date(match.kickoffAt), locale);
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
        containIntrinsicSize: "auto 108px",
      } as CSSProperties}
    >
      <Link
        to={`/match/${match.id}`}
        onPointerDown={() => {
          // Record the score block's position BEFORE the route change — this
          // is the FLIP's First frame (matches with no score yet have no key
          // here, and the detail hero simply renders without the transition).
          const scoreEl = document.querySelector(
            `[data-flip-key="match-${match.id}-score"]`,
          );
          if (scoreEl instanceof HTMLElement) {
            recordFlipFirst("match-score", scoreEl);
          }
          prefetchMatch(match.id);
        }}
        aria-label={label}
        // The 3-column grid flips with `dir`, so home sits on the right and away
        // on the left in Persian; explicit so the card reads correctly even if
        // the shell ever stops setting dir on the root.
        dir={lang === "fa" ? "rtl" : "ltr"}
        className="block rounded-card border bg-surface p-3 transition-[background-color] duration-[var(--t-fast)] hover:bg-elevated active:bg-elevated focus-visible:outline-2 focus-visible:outline-volt focus-visible:outline-offset-2"
        style={{
          // Red for a running match, amber for the break, neutral otherwise —
          // a feed of a dozen half-time cards must not read as a dozen alarms.
          borderColor: isLive
            ? "color-mix(in srgb, var(--live) 60%, transparent)"
            : isHalftime
              ? "color-mix(in srgb, var(--gold) 50%, transparent)"
              : "var(--line)",
          backgroundImage: isLive
            ? "linear-gradient(180deg, color-mix(in srgb, var(--live) 8%, transparent) 0%, transparent 50%)"
            : isHalftime
              ? "linear-gradient(180deg, color-mix(in srgb, var(--gold) 8%, transparent) 0%, transparent 50%)"
              : undefined,
        }}
      >
        <p className="mb-2 max-w-[calc(50%-56px)] truncate text-xs font-bold text-ink-3">{meta}</p>

        {/* Two-team grid: home on the start side, away on the end side. Logical
            classes throughout, so the layout flips correctly in Persian. */}
        <div className="grid grid-cols-2 gap-2 items-start">
          {/* Home team: crest above, name below — start side, top-aligned. */}
          <div className="flex min-w-0 max-w-[calc(100%-44px)] flex-col items-start gap-1.5">
            <TeamBadge team={match.home} />
            <span className="w-full truncate text-sm font-bold">{home}</span>
          </div>

          {/* Away team: crest above, name below — end side, top-aligned. */}
          <div className="flex min-w-0 max-w-[calc(100%-44px)] flex-col items-end justify-self-end gap-1.5">
            <TeamBadge team={match.away} />
            <span className="w-full truncate text-sm font-bold">{away}</span>
          </div>
        </div>

        {/* Dead-centre time / score block: absolute, out of flow, so it never
            takes part in layout and never pushes the team columns apart. Placed
            at left-1/2 top-1/2 and pulled back by half its own size, so the
            block's own centre sits on the card's centre. LTR isolation keeps the
            score and the AM/PM glyph from flipping in Persian. */}
        <div
          dir="ltr"
          aria-hidden="true"
          data-testid="match-mid"
          className="pointer-events-none absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center whitespace-nowrap"
        >
          {hasScore ? (
            <>
              {/* Vertical spacer equal to the status row below, so the score sits
                  centred between the two rows that will always be there for a
                  live/halftime/finished card. */}
              <span className="min-h-[23px]" />
              {/* The score carries a flip key: MatchDetail finds its First
                  rect under the SAME key to play the feed→hero handoff. A key
                  on every card is fine — only the tapped one is recorded. */}
              <span
                data-testid="match-center"
                data-flip-key={`match-${match.id}-score`}
                className="text-lg font-extrabold leading-7 text-ink"
              >
                {homeScore}–{awayScore}
              </span>
              <span className="flex min-h-[23px] items-center">
                {isLive ? (
                  // Running match: red dot + minute — the live tint on the border
                  // already says "in play", so the dot is the affordance.
                  <span className="flex items-center gap-1 text-xs font-bold text-live">
                    <LiveDot />
                    <Num>{minuteLabel}</Num>
                  </span>
                ) : isHalftime ? (
                  // Half-time is a neutral pause, not a live goal — amber, no dot.
                  <span className="text-xs font-bold text-gold">{minuteLabel}</span>
                ) : isFinished ? (
                  <span className="text-xs text-ink-3">{t("status.finished")}</span>
                ) : null}
              </span>
            </>
          ) : (
            <>
              {/* Weekday: 18px bold, 23px line height so the row is 23px tall even
                  when the period below is empty (Persian). */}
              <span className="min-h-[23px] text-md font-bold leading-[23px] text-ink-2">{parts.day}</span>
              {/* Clock: the exact centre row. 18px bold, 23px leading, LTR isolated. */}
              <span data-testid="match-center" className="text-md font-bold leading-[23px] text-ink-2">{parts.clock}</span>
              {/* Period: AM/PM for en-US, empty 23px spacer for fa-IR. Same fixed
                  height keeps the clock vertically centred in both scripts. */}
              <span className="min-h-[23px] text-md font-bold leading-[23px] text-ink-2">{parts.period}</span>
            </>
          )}
        </div>
      </Link>
    </li>
  );
});
