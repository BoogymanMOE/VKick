import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ConfettiBurst } from "../components/Confetti";
import { LineupsSkeleton,
  ScoreHeroSkeleton,
  StatsTableSkeleton,
  TimelineSkeleton,
} from "../components/Skeletons";
import { TimelineList } from "../components/TimelineList";
import { adaptComments } from "../lib/adaptComments";
import { buildPlayerEvents } from "../lib/lineupEvents";
import { TopBar } from "../components/TopBar";
import { LineupsPanel } from "../components/panels/LineupsPanel";
import { NewsCard } from "../components/panels/NewsCard";

import {
  Card,
  Chip,
  CountUp,
  EmptyState,
  ErrorState,
  LiveDot,
  Num,
  TeamBadge,
} from "../components/ui";
import { cx } from "../lib/cx";
import { api, type ApiTimelineEvent } from "../lib/api";
import { TEAM_FALLBACK } from "../lib/colors";
import {
  leagueIdOf,
  useCompetitionLabel,
  useMatchH2H,
  useMatchForm,
  useMatchNews,
} from "../hooks/useApi";
import { useI18n } from "../i18n/context";
import { RATINGS_ENABLED } from "../lib/features";
import { flipIntoPlace, getFlipFirst } from "../lib/flip";
import { formatClock, formatKickoffDate, kickoffParts, toFaDigits } from "../lib/format";
import { useNow } from "../hooks/useNow";
import { useLiveUpdates } from "../hooks/useLiveUpdates";
import type { FormGame, Team, TimelineEventType } from "../types";
import { FormStrip } from "./Table";

type Tab = "timeline" | "stats" | "lineups" | "h2h" | "form" | "news";
const TABS: Tab[] = ["timeline", "stats", "lineups", "h2h", "form", "news"];

export default function MatchDetail() {
  const { id = "" } = useParams();
  const { t, lang, localize } = useI18n();
  const locale = lang === "fa" ? "fa-IR" : undefined;
  const fa = lang === "fa";
  useLiveUpdates();

  const matchQuery = useQuery({
    queryKey: ["match", id],
    queryFn: () => api.getMatch(id),
    enabled: Boolean(id),
    // 20s while the match is in play: the server's live pulse rewrites the
    // minute and score straight from ESPN every 15s, so anything slower left
    // the header showing a clock minutes behind the game (the "not synced with
    // time" report). Paused when the tab is in the background — a hidden tab
    // holds the last good payload instead of spending the battery.
    refetchInterval: (query) =>
      (query.state.data?.match.status === "live" || query.state.data?.match.status === "halftime") &&
      !document.hidden
        ? 20_000
        : false,
    refetchIntervalInBackground: false,
  });
  const match = matchQuery.data?.match;
  const live = match?.status === "live";
  /**
   * Live OR the half-time break. The clock keeps moving INTO the break and the
   * second half starts from it, so every refresh decision polls on this —
   * polling on `live` alone left a match frozen on "HT" until the user
   * touched the screen again.
   */
  const inPlay = live || match?.status === "halftime";
  // Competition name for the header: big-five alias, else the catalog name
  // (cups/tournaments), so a cup match never shows a raw "uefa.champions".
  const leagueLabel = useCompetitionLabel(match?.league ?? "");

  // Tabs live in the router's search params so a panel is shareable and
  // deep-linkable. `useSearchParams` (not window.history.replaceState) is what
  // makes the tab actually re-render: replaceState fired without touching React
  // state, so the panel only changed once something else re-rendered — and on
  // a HashRouter the hand-built `pathname?tab=…` URL dropped the `#/match/…`
  // part, so a reload landed on the home route. `replace` keeps tab switches
  // out of browser history.
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get("tab") as Tab | null;
  const tab: Tab = requested && TABS.includes(requested) ? requested : "timeline";
  const setTab = (next: Tab) =>
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        params.set("tab", next);
        return params;
      },
      { replace: true },
    );

  // Goal flash when polling reveals a new score.
  const [burst, setBurst] = useState(0);
  const [flashScore, setFlashScore] = useState(false);
  const scoreRef = useRef<string | null>(null);
  useEffect(() => {
    if (!match) return;
    const score = `${match.home_score}-${match.away_score}`;
    if (scoreRef.current && scoreRef.current !== score && match.home_score !== null) {
      setBurst((v) => v + 1);
      setFlashScore(true);            window.setTimeout(() => setFlashScore(false), 1400);
    }
    scoreRef.current = score;
  }, [match?.home_score, match?.away_score, match]);

  // FLIP: the tapped feed card recorded its score block's First rect; the
  // hero's score plays the inversion once it exists. Ran off a ref + the
  // hero's presence (the hero mounts after the match query resolves, so the
  // plain mount effect would fire before it), and each rect is consumed on
  // read — one tap, one play, never on re-renders or background refetches.
  // Reduced-motion users get the hero immediately, no transition.
  const flipPlayed = useRef(false);
  useEffect(() => {
    if (!match || flipPlayed.current) return;
    const heroScore = document.querySelector('[data-flip-key="match-score"]');
    if (!(heroScore instanceof HTMLElement)) return;
    const first = getFlipFirst("match-score");
    if (!first) return;
    flipPlayed.current = true;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // Two frames: the page-in wrapper is still settling its transform on
    // frame one, so the Last rect is measured after layout has committed.
    //
    // The frames are deliberately NOT cancelled on cleanup. `prefetchMatch`
    // warms the query cache, so the hero usually exists on the FIRST render
    // — and React StrictMode's dev double-invoke then runs this effect twice,
    // with the cleanup firing in between. Cancelling there killed the
    // transition before it could play. One play per navigation is guaranteed
    // by the store instead: the First rect is consumed on read, so the second
    // pass finds nothing to play.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (heroScore.isConnected) flipIntoPlace(heroScore, first);
      });
    });
  }, [match]);

  const currentMinute = useMemo(() => {
    const m = /\d+/.exec(match?.minute_display ?? "");
    return m ? Number(m[0]) : 0;
  }, [match?.minute_display]);

  const now = useNow(30_000);

  // Days, then hours+minutes in words — never a bare "335h 45m", whose Latin
  // h/m scramble the bidi run of a Persian sentence.
  // Stable per locale: a fresh Intl.NumberFormat each render made the memo
  // below recompute every time (the missing-dependency warning).
  const nf = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const countdownLabel = useMemo(() => {
    if (!match || match.status !== "scheduled") return null;
    const ms = new Date(match.kickoff_at).getTime() - now;
    if (ms <= 0) return t("match.awaiting");
    const totalMinutes = Math.floor(ms / 60_000);
    if (totalMinutes < 1) return t("predict.startingSoon");
    const days = Math.floor(totalMinutes / 1440);
    if (days >= 1) return t("match.startsInDays", { count: nf.format(days) });
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return t("predict.startsIn", {
      time:
        hours > 0
          ? t("match.hoursMinutes", { h: nf.format(hours), m: nf.format(minutes) })
          : t("match.minutes", { m: nf.format(minutes) }),
    });
  }, [match, now, t, nf]);



  if (matchQuery.isLoading) {
    return (
      <>
        <TopBar title={leagueLabel || t("match.summary")} />
        <div className="mt-md">
          <ScoreHeroSkeleton />
        </div>
      </>
    );
  }

  if (matchQuery.isError) {
    return (
      <>
        <TopBar title={leagueLabel || t("match.summary")} />
        <div className="mt-md">
          <ErrorState title={t("error.title")} hint={t("error.hint")} onRetry={() => matchQuery.refetch()} />
        </div>
      </>
    );
  }

  if (!match) {
    return (
      <>
        <TopBar title={leagueLabel || t("match.summary")} />
        <div className="mt-md">
          <EmptyState title={t("matches.empty")} hint={t("matches.emptyHint")} />
        </div>
      </>
    );
  }

  const home = {
    id: match.home_team_id,
    name: match.home_name,
    shortName: match.home_short ?? match.home_name,
    abbreviation: match.home_abbr ?? "—",
    color: match.home_color ?? TEAM_FALLBACK,
    league: leagueIdOf(match.league) ?? "PL",
  };
  const away = {
    ...home,
    id: match.away_team_id,
    name: match.away_name,
    shortName: match.away_short ?? match.away_name,
    abbreviation: match.away_abbr ?? "—",
    color: match.away_color ?? TEAM_FALLBACK,
  };



  // Cup matches carry ESPN's round ("Quarter-final"); league matches have no
  // round in the payload and no gameweek either — the API sends neither — so
  // the subtitle renders only when a round exists (never a bare placeholder).
  const roundLabel = match.round ? localize(match.round) : null;

  return (
    <>
      <ConfettiBurst trigger={burst} />

      {/* Title = the competition, subtitle = the round (cups). No round back
          chevron next to the title — the scoreboard owns the screen and
          navigation lives in the mini app chrome. */}
      <TopBar title={leagueLabel} subtitle={roundLabel ?? undefined} />

      {/* Scoreboard: crest with the team NAME under it, big score centered,
          live pill with the minute. Home first — the first flex child, which
          sits on the START edge (right in Persian, left in English) — the same
          home-first order the Matches feed shows, with each crest's number
          being that side's goals. */}
      <div
        className={cx(
          "score-hero relative mt-md overflow-hidden rounded-card border p-3",
          flashScore ? "goal-flash border-volt/60 bg-elevated" : "border-line",
        )}
      >
        <div className="flex items-center justify-between gap-2">
          {/* HOME — the side the first score digit belongs to. */}
          <div className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
            <TeamBadge team={home} size="md" />
            <span className="max-w-full truncate text-center text-sm font-bold text-ink">
              {localize(home.shortName)}
            </span>
          </div>

          <div className="flex flex-none flex-col items-center justify-center gap-1.5 self-stretch py-1">
            {/* Before kickoff there is no score — the kickoff clock is the
                honest read, isolated LTR so the colon and digits never flip.
                Once a side has a number the score rolls up as it moves. */}
            {match.home_score === null && match.away_score === null ? (
              <Num className="text-lg leading-none text-ink-2">
                <span dir="ltr">{formatClock(new Date(match.kickoff_at), locale)}</span>
              </Num>
            ) : (
              /* This row is the FLIP's Last frame: same key the tapped card
                 recorded its First rect under (see MatchCard onPointerDown).
                 NOT dir-ltr: in Persian the home number has to sit beside the
                 home crest (start edge, right). */
              <span data-flip-key="match-score" className="flex items-baseline justify-center gap-1">
                <ScoreDigit value={match.home_score} fa={fa} />
                <Num className="text-display leading-none text-ink">:</Num>
                <ScoreDigit value={match.away_score} fa={fa} />
              </span>
            )}
            {inPlay ? (
              <Chip tone="live">
                <LiveDot />
                {match.status === "halftime" ? (
                  t("timeline.halftime")
                ) : (
                  <span>
                    {t("status.live")} {"\u200F"}
                    <Num>
                      <span dir="ltr">{nf.format(currentMinute)}′</span>
                    </Num>
                  </span>
                )}
              </Chip>
            ) : countdownLabel ? (
              <Chip tone="volt" className="motion-safe:animate-pulse">
                {countdownLabel}
              </Chip>
            ) : (
              <Chip tone={match.status === "finished" ? "muted" : "volt"}>
                {match.status === "finished" ? (
                  t("status.finished")
                ) : (
                  <Num>{formatKickoffDate(new Date(match.kickoff_at), locale)}</Num>
                )}
              </Chip>
            )}
          </div>

          {/* AWAY — the side the second score digit belongs to. */}
          <div className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
            <TeamBadge team={away} size="md" />
            <span className="max-w-full truncate text-center text-sm font-bold text-ink">
              {localize(away.shortName)}
            </span>
          </div>
        </div>

        {/* Date/time (and venue when the payload ever carries one — today
            there is no venue field at all) as simple lines below the pill.
            The clock is its own dir=ltr run so the bidi order never scrambles. */}
        <div className="mt-2 text-center text-xs text-ink-2">
          <p>
            {kickoffParts(new Date(match.kickoff_at), locale).day}{" "}
            <span dir="ltr">{kickoffParts(new Date(match.kickoff_at), locale).clock}</span>
          </p>
        </div>
      </div>

      <UnderlineTabs
        id="match-tabs"
        value={tab}
        onChange={setTab}
        options={[
          { value: "timeline", label: t("match.tabTimeline") },
          { value: "stats", label: t("match.tabStats") },
          { value: "lineups", label: t("match.tabLineups") },
          { value: "h2h", label: t("match.tabH2H") },
          { value: "form", label: t("match.tabForm") },
          { value: "news", label: t("match.tabNews") },
        ]}
      />

      {/* The panel that the tabs above (role=tab/aria-controls) point at: the
          labelled-by ties tab → panel so screen readers announce the owning
          tab, and arrow keys on the tablist land here. */}
      <section
        id="match-tabs-panel"
        role="tabpanel"
        aria-labelledby={`match-tabs-${tab}`}
        className="panel-in mt-md"
        key={tab}
      >
        {tab === "timeline" ? (
          <TimelineTab
            matchId={id}
            live={inPlay}
            minute={currentMinute}
            teams={[home, away]}
          />
        ) : null}
        {tab === "stats" ? <StatsTab matchId={id} home={home} away={away} /> : null}
        {tab === "lineups" ? <LineupsTab matchId={id} home={home} away={away} /> : null}
        {tab === "h2h" ? <H2HTab matchId={id} home={home} away={away} /> : null}
        {tab === "form" ? <FormTab matchId={id} home={home} away={away} /> : null}
        {tab === "news" ? <MatchNewsTab matchId={id} /> : null}
      </section>


      {/* The A-ADS unit used to be the page's last element here. It is now a
          static iframe in index.html so the no-JS A-ADS verifier can see it. */}
    </>
  );
}

/* ------------------------------------------------------------ tabs */

/**
 * One score digit: a goal rolls up in EN, but Persian renders statically —
 * CountUp prints Latin digits, and an animated Persian-digit roll isn't worth
 * its own clock component here.
 */
function ScoreDigit({ value, fa }: { value: number | null; fa: boolean }) {
  if (value === null) return <Num className="text-display leading-none text-ink">–</Num>;
  return fa ? (
    <Num className="text-display leading-none text-ink">{toFaDigits(value)}</Num>
  ) : (
    <CountUp value={value} className="text-display leading-none text-ink" />
  );
}

/**
 * Underline-style tabs for the match page: a volt underline marks the active
 * tab instead of the shared sliding pill, per the redesign. Same tab wiring
 * as Segmented: tab id `${id}-${value}`, panel `${id}-panel`, tabs carry
 * role="tab" + aria-selected + aria-controls (the panel below depends on it).
 */
function UnderlineTabs<T extends string>({
  id,
  value,
  options,
  onChange,
}: {
  id: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div role="tablist" className="mt-md flex overflow-x-auto border-b border-line">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            id={`${id}-${option.value}`}
            aria-selected={active}
            aria-controls={`${id}-panel`}
            onClick={() => onChange(option.value)}
            className={cx(
              "relative min-h-11 flex-1 whitespace-nowrap px-2 text-sm font-bold transition-colors duration-[var(--t-fast)]",
              active ? "text-ink" : "text-ink-3 hover:text-ink-2",
            )}
          >
            {option.label}
            <span
              aria-hidden="true"
              className={cx(
                "absolute inset-x-3 bottom-0 h-0.5 rounded-full",
                active ? "bg-volt" : "bg-transparent",
              )}
            />
          </button>
        );
      })}
    </div>
  );
}

function TimelineTab({
  matchId,
  live,
  minute,
  teams,
}: {
  matchId: string;
  live: boolean;
  minute: number;
  /** Both sides, for the timeline markers' club tint and the team label. */
  teams: Array<{ id: string; shortName: string; color: string }>;
}) {
  const { t } = useI18n();
  const query = useQuery({
    queryKey: ["timeline", matchId],
    queryFn: () => api.getTimeline(matchId),
    refetchInterval: live ? 20_000 : false,
  });
  // Pinned minute-comments, for the rows' comment count trigger. Read-only: the
  // composer was deliberately unmounted by the "core five" trim (8d73687) —
  // this restores the reading side, not the writing side.
  const commentsQuery = useQuery({
    queryKey: ["comments", matchId],
    queryFn: () => api.getComments(matchId),
  });
  const events = query.data?.events ?? [];
  const pinned = adaptComments(commentsQuery.data?.comments ?? [], undefined);
  const adapted = events
    .map(adaptTimelineEvent)
    .filter((e) => e.type !== "other"); // drop commentary noise; keep kickoff + structured events

  if (query.isLoading) return <TimelineSkeleton rows={4} />;
  if (query.isError) {
    return <ErrorState title={t("error.title")} hint={t("error.hint")} onRetry={() => query.refetch()} />;
  }
  if (adapted.length === 0) {
    return <EmptyState icon="⏱" title={t("timeline.empty")} hint={t("timeline.emptyHint")} />;
  }

  return (
    <TimelineList
      events={adapted}
      comments={pinned}
      liveMinute={live ? minute : undefined}
      homeTeamId={teams[0]?.id}
      awayTeamId={teams[1]?.id}
    />
  );
}

function StatsTab({
  matchId,
  home,
  away,
}: {
  matchId: string;
  home: {
    id: string;
    name: string;
    shortName: string;
    abbreviation: string;
    color: string;
    league: "PL" | "LL" | "SA" | "BL" | "L1";
  };
  away: typeof home;
}) {
  const { t, localize } = useI18n();
  const query = useQuery({
    queryKey: ["matchPlayers", matchId],
    queryFn: () => api.getMatchPlayers(matchId),
  });
  const rows = (query.data?.players ?? []) as Array<Record<string, unknown>>;
  // The synced box score (possession/corners/pass accuracy only exist here).
  // A failure or a missing pair falls back to the player aggregates below —
  // the tab never blanks because one feed went quiet.
  const teamStatsQuery = useQuery({
    queryKey: ["matchTeamStats", matchId],
    queryFn: () => api.getMatchTeamStats(matchId),
    staleTime: 60_000,
  });
  const served =
    teamStatsQuery.data?.home && teamStatsQuery.data?.away
      ? { home: teamStatsQuery.data.home, away: teamStatsQuery.data.away }
      : null;

  if (query.isLoading || teamStatsQuery.isLoading) return <StatsTableSkeleton />;
  if (query.isError) {
    return <ErrorState title={t("error.title")} hint={t("error.hint")} onRetry={() => query.refetch()} />;
  }
  if (rows.length === 0 && !served) {
    return <EmptyState icon="📊" title={t("stats.noneYet")} hint={t("stats.noneHint")} />;
  }

  const asNum = (v: unknown): number => (typeof v === "number" ? v : 0);
  // A substitute who never came on is a row of zeros, not a player — hide them.
  const teamRows = (teamId: string) =>
    rows.filter((r) => r.team_id === teamId && (r.started || asNum(r.minutes_played) > 0));

  // Fallback totals aggregated from the per-player stat rows, used only when
  // the synced box score has no row for this match — never alongside it.
  const totalsFor = (teamId: string) => {
    const rowsOf = rows.filter((r) => r.team_id === teamId);
    const sum = (key: string) => rowsOf.reduce((acc, r) => acc + asNum(r[key]), 0);
    return {
      goals: sum("goals"),
      shots: sum("shots"),
      onTarget: sum("shots_on_target"),
      fouls: sum("fouls_committed"),
      offsides: sum("offsides"),
      saves: sum("saves"),
    };
  };

  const homeTotals = totalsFor(home.id);
  const awayTotals = totalsFor(away.id);
  // Synced box score first: all eight stats in display order. Possession and
  // pass accuracy are shares of 100 shown as "63%", with the bar split by the
  // raw percentage instead of a ratio.
  const statRows: Array<{ label: string; homeValue: number | null; awayValue: number | null; pct?: boolean }> =
    served
      ? [
          { label: t("stats.possession"), homeValue: served.home.possession_pct, awayValue: served.away.possession_pct, pct: true },
          { label: t("stats.shots"), homeValue: served.home.shots, awayValue: served.away.shots },
          { label: t("stats.onTarget"), homeValue: served.home.shots_on_target, awayValue: served.away.shots_on_target },
          { label: t("stats.corners"), homeValue: served.home.corners, awayValue: served.away.corners },
          { label: t("stats.fouls"), homeValue: served.home.fouls, awayValue: served.away.fouls },
          { label: t("stats.offsides"), homeValue: served.home.offsides, awayValue: served.away.offsides },
          { label: t("stats.passAccuracy"), homeValue: served.home.pass_accuracy_pct, awayValue: served.away.pass_accuracy_pct, pct: true },
          { label: t("stats.saves"), homeValue: served.home.saves, awayValue: served.away.saves },
        ]
      : [
          { label: t("stats.goals"), homeValue: homeTotals.goals, awayValue: awayTotals.goals },
          { label: t("stats.shots"), homeValue: homeTotals.shots, awayValue: awayTotals.shots },
          { label: t("stats.onTarget"), homeValue: homeTotals.onTarget, awayValue: awayTotals.onTarget },
          { label: t("stats.fouls"), homeValue: homeTotals.fouls, awayValue: awayTotals.fouls },
          { label: t("stats.offsides"), homeValue: homeTotals.offsides, awayValue: awayTotals.offsides },
          { label: t("stats.saves"), homeValue: homeTotals.saves, awayValue: awayTotals.saves },
        ];

  const homeRows = teamRows(home.id);
  const awayRows = teamRows(away.id);

  return (
    <div className="space-y-3">
      {/* Comparison card: both sides' totals on the same row with a proportion
          bar. Forced LTR so the home half is always the left one, whichever
          direction the page runs. */}
      <Card className="p-3">
        <div dir="ltr">
          <div className="mb-3 flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5 text-xs font-bold text-ink">
              <span
                className="h-2.5 w-2.5 flex-none rounded-full ring-1 ring-ink-3"
                style={{ backgroundColor: home.color }}
                aria-hidden="true"
              />
              <span className="truncate">{localize(home.shortName)}</span>
            </span>
            <span className="flex min-w-0 items-center gap-1.5 text-xs font-bold text-ink">
              <span className="truncate">{localize(away.shortName)}</span>
              <span
                className="h-2.5 w-2.5 flex-none rounded-full ring-1 ring-ink-3"
                style={{ backgroundColor: away.color }}
                aria-hidden="true"
              />
            </span>
          </div>
          <div className="space-y-3">
            {statRows.map((row) => (
              <StatCompareRow key={row.label} {...row} />
            ))}
          </div>
        </div>
      </Card>

      {/* Every player who appeared, both sides in one pass — no Home/Away
          toggle to remember to tap. */}
      {homeRows.length > 0 ? (
        <MatchPlayerTable title={localize(home.shortName)} color={home.color} rows={homeRows} />
      ) : null}
      {awayRows.length > 0 ? (
        <MatchPlayerTable title={localize(away.shortName)} color={away.color} rows={awayRows} />
      ) : null}
    </div>
  );
}

/** One team-stat row: home value, label, away value, and the proportion bar
    underneath — volt half for home (left), live-coral half for away. A synced
    percentage row (`pct`) prints "63%" and splits the bar by the raw
    percentage itself; a count splits by ratio. A null rides as "–" and counts
    as zero; zeros on both sides settle into an even, muted 50/50. */
function StatCompareRow({
  label,
  homeValue,
  awayValue,
  pct = false,
}: {
  label: string;
  homeValue: number | null;
  awayValue: number | null;
  pct?: boolean;
}) {
  const { lang } = useI18n();
  const fa = lang === "fa";
  const show = (v: number | null) =>
    v === null
      ? "–"
      : fa
        ? toFaDigits(pct ? `${v}%` : String(v))
        : pct
          ? `${v}%`
          : String(v);
  const hv = homeValue ?? 0;
  const av = awayValue ?? 0;
  const total = hv + av;
  // With nothing on either side the track is an even 50/50 in a muted grey —
  // an equal-looking bar that never reads as "someone is winning something".
  // A percentage splits by its own raw value: 63% possession means a 63/37 bar.
  const homePct = total > 0 ? (pct ? hv : Math.round((hv / total) * 100)) : 50;
  const fill = total > 0;
  return (
    <div dir="ltr">
      <div className="flex items-center gap-2 text-xs">
        <Num className="w-8 text-end font-black text-ink">{show(homeValue)}</Num>
        <span className="flex-1 truncate text-center text-xs font-bold text-ink-2">{label}</span>
        <Num className="w-8 font-black text-ink">{show(awayValue)}</Num>
      </div>
      <div className="mt-1 flex h-1.5 gap-0.5 overflow-hidden">
        <span
          className={`rounded-full ${fill ? "bg-volt" : "bg-ink-3/40"}`}
          style={{ width: `${homePct}%` }}
        />
        <span
          className={`rounded-full ${fill ? "bg-live" : "bg-ink-3/40"}`}
          style={{ width: `${100 - homePct}%` }}
        />
      </div>
    </div>
  );
}

function MatchPlayerTable({
  title,
  color,
  rows,
}: {
  title: string;
  color: string;
  rows: Array<Record<string, unknown>>;
}) {
  const { t, localize, lang } = useI18n();
  const fa = lang === "fa";
  const num = (v: unknown): number => (typeof v === "number" ? v : 0);
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  return (
    <Card className="overflow-hidden p-0">
      <div className="flex items-center gap-2 border-b border-line p-3">
        {/* The ring keeps a black (or near-black) club colour visible on the dark
            background — a bare dot in the club's own colour can vanish. */}
        <span
          className="h-2.5 w-2.5 rounded-full ring-1 ring-ink-3"
          style={{ backgroundColor: color }}
          aria-hidden="true"
        />
        <span className="text-sm font-bold text-ink">{title}</span>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="label text-ink-3">
            <th className="p-2 text-start font-bold">{t("stats.player")}</th>
            <th className="p-2 text-end font-bold">{t("stats.goals")}</th>
            <th className="p-2 text-end font-bold">{t("stats.assists")}</th>
            <th className="p-2 text-end font-bold">{t("stats.shots")}</th>
            {/* The points-style stat score is the ratings feature's number;
                with the flag off the column is gone and the remaining four
                share its width (the table is already w-full). */}
            {RATINGS_ENABLED ? (
              <th className="p-2 text-end font-bold">{t("ratings.points")}</th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={str(r.player_id)} className="border-t border-line">
              <td className="p-2">
                <span className="block truncate font-bold text-ink">{localize(str(r.full_name))}</span>
                <span className="text-xs text-ink-3">
                  {fa ? toFaDigits(num(r.minutes_played)) : num(r.minutes_played)}′{" "}
                  {r.started ? `· ${t("match.xi")}` : ""}
                </span>
              </td>
              <td className="p-2 text-end">
                <Num className={num(r.goals) > 0 ? "font-bold text-volt" : "text-ink-2"}>
                  {fa ? toFaDigits(num(r.goals)) : num(r.goals)}
                </Num>
              </td>
              <td className="p-2 text-end">
                <Num className={num(r.assists) > 0 ? "font-bold text-gold" : "text-ink-2"}>
                  {fa ? toFaDigits(num(r.assists)) : num(r.assists)}
                </Num>
              </td>
              <td className="p-2 text-end text-ink-2">
                {fa ? toFaDigits(num(r.shots)) : num(r.shots)}
              </td>
              {RATINGS_ENABLED ? (
                <td className="p-2 text-end">
                  <Num className="font-bold text-ink">
                    {fa ? toFaDigits(num(r.stat_score)) : num(r.stat_score)}
                  </Num>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function LineupsTab({
  matchId,
  home,
  away,
}: {
  matchId: string;
  home: { id: string; shortName: string; color: string };
  away: { id: string; shortName: string; color: string };
}) {
  const { t } = useI18n();
  const query = useQuery({
    queryKey: ["lineups", matchId],
    queryFn: () => api.getLineups(matchId),
  });
  // The pitch shows what each player did, which lives on the timeline, not in
  // the lineups payload. Shared query key with the Timeline tab, so whichever
  // tab opens second reads the cache instead of refetching the same events.
  const eventsQuery = useQuery({
    queryKey: ["timeline", matchId],
    queryFn: () => api.getTimeline(matchId),
  });
  const playerEvents = useMemo(
    () => buildPlayerEvents(eventsQuery.data?.events ?? []),
    [eventsQuery.data],
  );
  const data = query.data;
  if (query.isLoading) return <LineupsSkeleton />;
  if (query.isError) {
    return <ErrorState title={t("error.title")} hint={t("error.hint")} onRetry={() => query.refetch()} />;
  }
  if (!data || data.players.length === 0) {
    // The Lineups tab is about the XI, not the stat sheet — an upcoming match
    // must not say "stats land here after the first whistle".
    return <EmptyState icon="📋" title={t("lineups.noneYet")} hint={t("lineups.noneHint")} />;
  }

  const toPlayer = (r: Record<string, unknown>) => ({
    id: String(r.player_id),
    name: String(r.full_name),
    position: String(r.position ?? "MID") as "GK" | "DEF" | "MID" | "FWD",
    number: typeof r.jersey_number === "number" ? r.jersey_number : 0,
    // The pitch is only as good as these three: the face, the granular role
    // that decides which side of a line a player stands on, and ESPN's slot for
    // the leaked XIs that carry no role.
    headshot: typeof r.headshot_url === "string" ? r.headshot_url : null,
    espnPosition: typeof r.espn_position === "string" ? r.espn_position : null,
    formationPlace: typeof r.formation_place === "string" ? r.formation_place : null,
  });
  const homeTeam: Team = {
    id: home.id,
    name: home.shortName,
    shortName: home.shortName,
    abbreviation: home.shortName.slice(0, 3),
    color: home.color,
    league: "PL",
  };
  const awayTeam: Team = {
    id: away.id,
    name: away.shortName,
    shortName: away.shortName,
    abbreviation: away.shortName.slice(0, 3),
    color: away.color,
    league: "PL",
  };
  const sidePlayers = (teamId: string) =>
    data.players
      .filter((p) => p.team_id === teamId)
      .map((p) => ({
        ...toPlayer(p as unknown as Record<string, unknown>),
        starter: p.started === 1,
        minutes: p.minutes_played ?? 0,
      }));

  const homeAll = sidePlayers(home.id);
  const awayAll = sidePlayers(away.id);
  const homeLineup = {
    formation: data.home.formation ?? "—",
    coach: "",
    starters: homeAll.filter((p) => p.starter),
    subs: homeAll.filter((p) => !p.starter && p.minutes > 0),
  };
  const awayLineup = {
    formation: data.away.formation ?? "—",
    coach: "",
    starters: awayAll.filter((p) => p.starter),
    subs: awayAll.filter((p) => !p.starter && p.minutes > 0),
  };

  return (
    <LineupsPanel
      home={homeTeam}
      away={awayTeam}
      lineups={{ home: homeLineup, away: awayLineup }}
      playerEvents={playerEvents}
    />
  );
}/* ------------------------------------------------------------ adapters */

function adaptTimelineEvent(e: ApiTimelineEvent) {
  return {
    id: String(e.id),
    minuteDisplay: e.minute_display,
    minuteSeconds: e.minute_seconds,
    // Trust the server's normalization — it already maps ESPN's many type
    // strings to the 8-value union. The previous fallback to "var" mis-tagged
    // kickoff and other events as VAR reviews.
    type: e.type as TimelineEventType,
    teamId: e.team_id,
    description: e.description,
    participants: e.participants.map((p) => p.name),
    commentCount: e.comment_count,
  };
}

/* ------------------------------------------------------------ head-to-head */

/**
 * The two clubs' last five meetings. ESPN's `seasonseries[0]` ships its own
 * headline line ("LIV leads series 3-2"); when the payload omits it, the line
 * is folded from the meetings themselves and localized, which is also what
 * keeps this tab readable in Persian.
 */
function H2HTab({
  matchId,
  home,
  away,
}: {
  matchId: string;
  home: { id: string; shortName: string; color: string };
  away: { id: string; shortName: string; color: string };
}) {
  const { t, lang, localize } = useI18n();
  const fa = lang === "fa";
  const query = useMatchH2H(matchId);
  if (query.isLoading) return <LineupsSkeleton />;
  if (query.isError) {
    return (
      <ErrorState title={t("error.title")} hint={t("error.hint")} onRetry={() => query.refetch()} />
    );
  }
  const data = query.data;
  const events = data?.events ?? [];
  if (events.length === 0) {
    return <EmptyState title={t("match.h2h.empty")} />;
  }
  const nameOf = (teamId: string) => {
    if (teamId === home.id) return localize(home.shortName);
    if (teamId === away.id) return localize(away.shortName);
    return teamId;
  };
  const fmtScore = (v: number | null) => (v === null ? "–" : fa ? toFaDigits(v) : String(v));
  const seriesLine =
    data?.summary ??
    (() => {
      const homeWins = events.filter((e) => e.winnerTeamId === home.id).length;
      const awayWins = events.filter((e) => e.winnerTeamId === away.id).length;
      const score = `${fmtScore(homeWins)}-${fmtScore(awayWins)}`;
      return homeWins === awayWins
        ? t("match.h2h.even", { score })
        : t("match.h2h.seriesLeads", {
            name: nameOf(homeWins > awayWins ? home.id : away.id),
            score,
          });
    })();
  const dayFmt = new Intl.DateTimeFormat(fa ? "fa-IR" : undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  return (
    <Card className="overflow-hidden p-0">
      {seriesLine ? (
        <p className="border-b border-line px-3 py-2 text-sm font-bold text-ink">{seriesLine}</p>
      ) : null}
      <ul className="divide-y divide-line">
        {events.map((e) => {
          const hasScore = e.homeScore !== null || e.awayScore !== null;
          return (
            <li
              key={e.id}
              className="flex items-center justify-between gap-2 px-3 py-2 text-xs"
            >
              <span className="flex-none text-ink-3">
                {e.date ? dayFmt.format(new Date(e.date)) : ""}
              </span>
              <span className="flex min-w-0 flex-1 items-center justify-end gap-1.5">
                <span
                  className={cx(
                    "truncate",
                    e.winnerTeamId === e.homeTeamId ? "font-bold text-ink" : "text-ink-2",
                  )}
                >
                  {nameOf(e.homeTeamId)}
                </span>
                {hasScore ? (
                  <span dir="ltr" className="flex-none font-bold text-ink">
                    {fmtScore(e.homeScore)}–{fmtScore(e.awayScore)}
                  </span>
                ) : (
                  <span className="flex-none text-ink-3">{t("match.form.vs")}</span>
                )}
                <span
                  className={cx(
                    "truncate",
                    e.winnerTeamId === e.awayTeamId ? "font-bold text-ink" : "text-ink-2",
                  )}
                >
                  {nameOf(e.awayTeamId)}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/* -------------------------------------------------------------- form tab */

/** Both clubs' last-five results, one card per side. */
function FormTab({
  matchId,
  home,
  away,
}: {
  matchId: string;
  home: { id: string; shortName: string; color: string };
  away: { id: string; shortName: string; color: string };
}) {
  const { t, localize } = useI18n();
  const query = useMatchForm(matchId);
  if (query.isLoading) return <LineupsSkeleton />;
  if (query.isError) {
    return (
      <ErrorState title={t("error.title")} hint={t("error.hint")} onRetry={() => query.refetch()} />
    );
  }
  const data = query.data;
  if (!data || (!data.home && !data.away)) {
    return <EmptyState title={t("match.form.empty")} />;
  }
  return (
    <div className="space-y-3">
      <p className="label label-lg text-ink-2">{t("match.form.lastFive")}</p>
      {data.home ? (
        <FormSide
          label={localize(home.shortName)}
          color={home.color}
          form={data.home.form}
          games={data.home.games}
        />
      ) : null}
      {data.away ? (
        <FormSide
          label={localize(away.shortName)}
          color={away.color}
          form={data.away.form}
          games={data.away.games}
        />
      ) : null}
    </div>
  );
}

/**
 * One club's last-5: the shared FormStrip (dots) over the compact list of
 * recent results. `result` is already from this club's perspective and the
 * score is oriented to it too, so a row reads "W 2–1" whichever end of the
 * fixture the club played.
 */
function FormSide({
  label,
  color,
  form,
  games,
}: {
  label: string;
  color: string;
  form: string;
  games: FormGame[];
}) {
  const { t, lang } = useI18n();
  const fa = lang === "fa";
  return (
    <Card className="p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="h-2 w-2 flex-none rounded-full"
            style={{ backgroundColor: color }}
            aria-hidden="true"
          />
          <span className="truncate text-sm font-bold text-ink">{label}</span>
        </div>
        <FormStrip form={form} />
      </div>
      <ul className="divide-y divide-line">
        {games.map((g) => {
          const score = `${g.teamScore ?? "–"}–${g.opponentScore ?? "–"}`;
          return (
            <li key={g.id} className="flex items-center justify-between py-1.5 text-xs">
              <span className="text-ink-2">
                {g.result === "W"
                  ? t("table.formW")
                  : g.result === "L"
                    ? t("table.formL")
                    : t("table.formD")}
              </span>
              <span dir="ltr" className="font-bold text-ink">
                {fa ? toFaDigits(score) : score}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/* ------------------------------------------------------------ match news */

/**
 * Articles from this match's summary news block, on the shared NewsCard the
 * club page's News tab uses — same NewsArticle shape, same open-link path.
 */
function MatchNewsTab({ matchId }: { matchId: string }) {
  const { t, lang } = useI18n();
  const query = useMatchNews(matchId);
  if (query.isLoading) return <LineupsSkeleton />;
  if (query.isError) {
    return (
      <ErrorState title={t("error.title")} hint={t("error.hint")} onRetry={() => query.refetch()} />
    );
  }
  const articles = query.data?.articles ?? [];
  if (articles.length === 0) {
    return <EmptyState title={t("match.news.empty")} />;
  }
  const locale = lang === "fa" ? "fa-IR" : undefined;
  return (
    <ul className="space-y-2">
      {articles.map((article) => (
        <li key={article.id}>
          <NewsCard article={article} locale={locale} />
        </li>
      ))}
    </ul>
  );
}
