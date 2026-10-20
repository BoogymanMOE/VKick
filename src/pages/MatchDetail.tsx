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
import { TopBar } from "../components/TopBar";
import { LineupsPanel } from "../components/panels/LineupsPanel";

import {
  Card,
  Chip,
  CountUp,
  EmptyState,
  ErrorState,
  LiveDot,
  Num,
  Segmented,
  TeamBadge,
} from "../components/ui";
import { cx } from "../lib/cx";
import { api, type ApiTimelineEvent } from "../lib/api";
import { TEAM_FALLBACK } from "../lib/colors";
import { leagueIdOf, useCompetitionLabel } from "../hooks/useApi";
import { useI18n } from "../i18n/context";
import { RATINGS_ENABLED } from "../lib/features";
import { formatClock, formatKickoff, formatKickoffDate } from "../lib/format";
import { useNow } from "../hooks/useNow";
import { useLiveUpdates } from "../hooks/useLiveUpdates";
import type { Team, TimelineEventType } from "../types";

type Tab = "timeline" | "stats" | "lineups";
const TABS: Tab[] = ["timeline", "stats", "lineups"];

export default function MatchDetail() {
  const { id = "" } = useParams();
  const { t, lang } = useI18n();
  const locale = lang === "fa" ? "fa-IR" : undefined;
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

  const currentMinute = useMemo(() => {
    const m = /\d+/.exec(match?.minute_display ?? "");
    return m ? Number(m[0]) : 0;
  }, [match?.minute_display]);

  const now = useNow(30_000);

  // Days, then hours+minutes in words — never a bare "335h 45m", whose Latin
  // h/m scramble the bidi run of a Persian sentence.
  const nf = new Intl.NumberFormat(locale);
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
  }, [match, now, t, locale]);



  if (matchQuery.isLoading) {
    return (
      <>
        <TopBar title={t("match.summary")} back />
        <div className="mt-3">
          <ScoreHeroSkeleton />
        </div>
      </>
    );
  }

  if (matchQuery.isError) {
    return (
      <>
        <TopBar title={t("match.summary")} back />
        <div className="mt-4">
          <ErrorState title={t("error.title")} hint={t("error.hint")} onRetry={() => matchQuery.refetch()} />
        </div>
      </>
    );
  }

  if (!match) {
    return (
      <>
        <TopBar title={t("match.summary")} back />
        <div className="mt-4">
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



  return (
    <>
      <ConfettiBurst trigger={burst} />

      {/* The scoreboard below already names both sides; a "Home vs Away" title
          from two long names scrambles the bidi run and truncates in Persian. */}
      <TopBar title={t("match.summary")} subtitle={leagueLabel} back />

      {/* Score header */}
      <div
        className={cx(
          "score-hero relative mt-3 overflow-hidden rounded-card border p-3",
          flashScore ? "goal-flash border-volt/60 bg-elevated" : "border-line",
        )}
      >
        <p className="pb-2 text-center text-[11px] font-bold text-ink-2">
          {leagueLabel} · {formatKickoff(new Date(match.kickoff_at), locale)}
        </p>
        <div className="flex items-center justify-between gap-3">
          {/* Badge only: the user tapped this match's card, so the crest is
              all the teams need — the scoreboard below already says who plays.
              The md badge keeps the crest as supporting context so the score
              itself is the hero. */}
          <div className="flex flex-col items-center">
            <TeamBadge team={home} size="md" />
          </div>

          <div className="flex flex-col items-center gap-1.5">
            {/* Before kickoff there is no score to show — the kickoff clock is
                the honest read, and dashes ("– : –") read as a broken scoreboard.
                Once a side has a number the score rolls up as it moves. */}
            {match.home_score === null && match.away_score === null ? (
              <Num className="text-[28px] leading-none text-ink-2">
                {formatClock(new Date(match.kickoff_at), locale)}
              </Num>
            ) : (
              <span className="flex items-baseline gap-1">
                {match.home_score === null ? (
                  <Num className="text-[48px] leading-none text-ink">–</Num>
                ) : (
                  <CountUp value={match.home_score} className="text-[48px] leading-none text-ink" />
                )}
                <Num className="text-[48px] leading-none text-ink">:</Num>
                {match.away_score === null ? (
                  <Num className="text-[48px] leading-none text-ink">–</Num>
                ) : (
                  <CountUp value={match.away_score} className="text-[48px] leading-none text-ink" />
                )}
              </span>
            )}
            {inPlay ? (
              <Chip tone="live">
                <LiveDot />
                {match.status === "halftime" ? (
                  t("timeline.halftime")
                ) : (
                  <>
                    {t("status.live")} <Num>{currentMinute}&#39;</Num>
                  </>
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

          <div className="flex flex-col items-center">
            <TeamBadge team={away} size="md" />
          </div>
        </div>
      </div>

      <div className="mt-4">          <Segmented
          id="match-tabs"
          value={tab}
          onChange={setTab}
          options={[
            { value: "timeline", label: t("match.tabTimeline") },
            { value: "stats", label: t("match.tabStats") },
            { value: "lineups", label: t("match.tabLineups") },
          ]}
        />
      </div>

      {/* The panel that the tabs above (role=tab/aria-controls) point at: the
          labelled-by ties tab → panel so screen readers announce the owning
          tab, and arrow keys on the tablist land here. */}
      <section
        id="match-tabs-panel"
        role="tabpanel"
        aria-labelledby={`match-tabs-${tab}`}
        className="panel-in mt-4"
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
      </section>


      {/* The A-ADS unit used to be the page's last element here. It is now a
          static iframe in index.html so the no-JS A-ADS verifier can see it. */}
    </>
  );
}

/* ------------------------------------------------------------ tabs */

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
  const { t, localize } = useI18n();
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
  const teamColor = Object.fromEntries(teams.map((team) => [team.id, team.color]));
  // teamId → localized club name, so a card names the side without printing the
  // English event sentence the feed carries.
  const teamNames = Object.fromEntries(teams.map((team) => [team.id, localize(team.shortName)]));

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
      teamColor={teamColor}
      teamNames={teamNames}
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
  const { t } = useI18n();
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
              <span className="truncate">{home.shortName}</span>
            </span>
            <span className="flex min-w-0 items-center gap-1.5 text-xs font-bold text-ink">
              <span className="truncate">{away.shortName}</span>
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
        <MatchPlayerTable title={home.shortName} color={home.color} rows={homeRows} />
      ) : null}
      {awayRows.length > 0 ? (
        <MatchPlayerTable title={away.shortName} color={away.color} rows={awayRows} />
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
  const show = (v: number | null) => (v === null ? "–" : pct ? `${v}%` : String(v));
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
        <span className="flex-1 truncate text-center text-[11px] font-bold text-ink-2">{label}</span>
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
  const { t, localize } = useI18n();
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
                <span className="text-[10px] text-ink-3">
                  {num(r.minutes_played)}&#39; {r.started ? "· XI" : ""}
                </span>
              </td>
              <td className="p-2 text-end">
                <Num className={num(r.goals) > 0 ? "font-bold text-volt" : "text-ink-2"}>{num(r.goals)}</Num>
              </td>
              <td className="p-2 text-end">
                <Num className={num(r.assists) > 0 ? "font-bold text-gold" : "text-ink-2"}>
                  {num(r.assists)}
                </Num>
              </td>
              <td className="p-2 text-end text-ink-2">{num(r.shots)}</td>
              {RATINGS_ENABLED ? (
                <td className="p-2 text-end">
                  <Num className="font-bold text-ink">{num(r.stat_score)}</Num>
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

  return <LineupsPanel home={homeTeam} away={awayTeam} lineups={{ home: homeLineup, away: awayLineup }} />;
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
