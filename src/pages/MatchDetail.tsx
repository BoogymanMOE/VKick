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
import { TopBar } from "../components/TopBar";
import { CommentaryPanel } from "../components/panels/CommentaryPanel";
import { LineupsPanel } from "../components/panels/LineupsPanel";

import {
  Card,
  Chip,
  CountUp,
  EmptyState,
  ErrorState,
  LiveDot,
  Num,
  SectionHeading,
  Segmented,
  TeamBadge,
} from "../components/ui";
import { cx } from "../lib/cx";
import { api, type ApiTimelineEvent } from "../lib/api";
import { TEAM_FALLBACK } from "../lib/colors";
import { leagueIdOf, useCompetitionLabel } from "../hooks/useApi";
import { useI18n } from "../i18n/context";
import { RATINGS_ENABLED } from "../lib/features";
import { formatKickoff, formatKickoffDate } from "../lib/format";
import { useNow } from "../hooks/useNow";
import { useLiveUpdates } from "../hooks/useLiveUpdates";
import type { Team } from "../types";

type Tab = "timeline" | "stats" | "lineups";
const TABS: Tab[] = ["timeline", "stats", "lineups"];

export default function MatchDetail() {
  const { id = "" } = useParams();
  const { t, lang, localize } = useI18n();
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

  const countdownLabel = useMemo(() => {
    if (!match || match.status !== "scheduled") return null;
    const ms = new Date(match.kickoff_at).getTime() - now;
    if (ms <= 0) return null;
    const totalMinutes = Math.floor(ms / 60_000);
    if (totalMinutes < 1) return t("predict.startingSoon");
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours > 0) {
      return t("predict.startsIn", { time: `${hours}h ${minutes}m` });
    }
    return t("predict.startsIn", { time: `${minutes}m` });
  }, [match, now, t]);



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

      <TopBar title={`${localize(home.shortName)} ${t("common.versus")} ${localize(away.shortName)}`} back />

      {/* Score header */}
      <div
        className={cx(
          "score-hero relative mt-3 overflow-hidden rounded-card border p-4",
          flashScore ? "goal-flash border-volt/60 bg-elevated" : "border-line",
        )}
      >
        <p className="pb-2 text-center text-[11px] font-bold text-ink-2">
          {leagueLabel} · {formatKickoff(new Date(match.kickoff_at), locale)}
        </p>
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col items-center gap-2">
            <TeamBadge team={home} size="lg" />
            <span className="text-xs font-bold text-ink-2">{localize(home.shortName)}</span>
          </div>

          <div className="flex flex-col items-center gap-1.5">
            {/* The score rolls up to its new value when the feed moves, so a
                goal lands rather than snapping. A side that hasn't played keeps
                the honest dash (null is not zero). */}
            <span className="flex items-baseline gap-1">
              {match.home_score === null ? (
                <Num className="text-[40px] leading-none text-ink">–</Num>
              ) : (
                <CountUp value={match.home_score} className="text-[40px] leading-none text-ink" />
              )}
              <Num className="text-[40px] leading-none text-ink">:</Num>
              {match.away_score === null ? (
                <Num className="text-[40px] leading-none text-ink">–</Num>
              ) : (
                <CountUp value={match.away_score} className="text-[40px] leading-none text-ink" />
              )}
            </span>
            {live ? (
              <Chip tone="live">
                <LiveDot />
                {t("status.live")} <Num>{currentMinute}&#39;</Num>
              </Chip>
            ) : countdownLabel ? (
              <Chip tone="volt" className="animate-pulse">
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

          <div className="flex flex-col items-center gap-2">
            <TeamBadge team={away} size="lg" />
            <span className="text-xs font-bold text-ink-2">{localize(away.shortName)}</span>
          </div>
        </div>
      </div>

      <div className="mt-4">          <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: "timeline", label: t("match.tabTimeline") },
            { value: "stats", label: t("match.tabStats") },
            { value: "lineups", label: t("match.tabLineups") },
          ]}
        />
      </div>

      <section className="panel-in mt-4" key={tab}>
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
  /** Both sides, for the timeline markers' club tint. */
  teams: Array<{ id: string; color: string }>;
}) {
  const { t } = useI18n();
  const query = useQuery({
    queryKey: ["timeline", matchId],
    queryFn: () => api.getTimeline(matchId),
    refetchInterval: live ? 20_000 : false,
  });
  const events = query.data?.events ?? [];
  const adapted = events.map(adaptTimelineEvent);
  const teamColor = Object.fromEntries(teams.map((team) => [team.id, team.color]));

  if (query.isLoading) return <TimelineSkeleton rows={4} />;
  if (query.isError) {
    return <ErrorState title={t("error.title")} hint={t("error.hint")} onRetry={() => query.refetch()} />;
  }
  if (adapted.length === 0) {
    return <EmptyState title={t("timeline.empty")} hint={t("timeline.emptyHint")} />;
  }

  return (
    <>
      <TimelineList
        events={adapted}
        comments={[]}
        liveMinute={live ? minute : undefined}
        teamColor={teamColor}
        homeTeamId={teams[0]?.id}
        awayTeamId={teams[1]?.id}
      />

      <div className="mt-4">
        <SectionHeading title={t("commentary.title")} />
        <CommentaryPanel
          lines={adapted.map((e) => ({
            id: e.id,
            minuteDisplay: e.minuteDisplay,
            text: e.description,
            isKey: e.type === "goal" || e.type === "card" || e.type === "substitution",
          }))}
        />
      </div>
    </>
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
  const [team, setTeam] = useState<"home" | "away">("home");
  const query = useQuery({
    queryKey: ["matchPlayers", matchId],
    queryFn: () => api.getMatchPlayers(matchId),
  });
  const rows = (query.data?.players ?? []) as Array<Record<string, unknown>>;

  if (query.isLoading) return <StatsTableSkeleton />;
  if (query.isError) {
    return <ErrorState title={t("error.title")} hint={t("error.hint")} onRetry={() => query.refetch()} />;
  }
  if (rows.length === 0) {
    return <EmptyState title={t("stats.noneYet")} hint={t("stats.noneHint")} />;
  }

  const selected = team === "home" ? home : away;
  const teamRows = rows.filter((r) => r.team_id === selected.id);

  return (
    <div className="space-y-3">
      <Segmented
        value={team}
        onChange={(v) => setTeam(v as "home" | "away")}
        options={[
          { value: "home", label: localize(home.shortName) },
          { value: "away", label: localize(away.shortName) },
        ]}
      />

      <MatchPlayerTable title={selected.shortName} color={selected.color} rows={teamRows} />
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
        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
        <span className="text-sm font-bold text-ink">{title}</span>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="label text-ink-3">
            <th className="p-2 text-start font-bold">{t("table.team")}</th>
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
    return <EmptyState title={t("stats.noneYet")} hint={t("stats.noneHint")} />;
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
    type: (["goal", "card", "substitution", "var", "halftime", "fulltime"].includes(e.type)
      ? e.type
      : "var") as "goal" | "card" | "substitution" | "var" | "halftime" | "fulltime",
    teamId: e.team_id,
    description: e.description,
    participants: e.participants.map((p) => p.name),
    commentCount: e.comment_count,
  };
}
