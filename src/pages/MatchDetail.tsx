import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ConfettiBurst } from "../components/Confetti";
import {
  LineupsSkeleton,
  RatingsSkeleton,
  ScoreHeroSkeleton,
  StatsTableSkeleton,
  TimelineSkeleton,
} from "../components/Skeletons";
import { RatingRow } from "../components/RatingRow";
import { RateSheet } from "../components/panels/RateSheet";
import type { PlayerRating } from "../types";
import { TimelineList } from "../components/TimelineList";
import { TopBar } from "../components/TopBar";
import { useToast } from "../components/toastContext";
import { CommentaryPanel } from "../components/panels/CommentaryPanel";
import { CommentsSection } from "../components/panels/CommentsPanel";
import { adaptComments } from "../lib/adaptComments";
import { LineupsPanel } from "../components/panels/LineupsPanel";
import { PitchView } from "../components/panels/PitchView";
import { PredictionsHub } from "../components/panels/PredictionsHub";
import { ChartIcon, ChevronRightIcon, StarIcon } from "../components/icons";
import {
  Button,
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
import { api, serverErrorKey, type ApiPlayerRating, type ApiTimelineEvent } from "../lib/api";
import { TEAM_FALLBACK } from "../lib/colors";
import { leagueIdOf, useCompetitionLabel } from "../hooks/useApi";
import { useAuth } from "../hooks/authContext";
import { useI18n } from "../i18n/context";
import { formatKickoff, formatKickoffDate } from "../lib/format";
import { useNow } from "../hooks/useNow";
import { isOpen, type MatchStatus, type Mechanic } from "../lib/predictionWindow";
import { justPaidOut } from "../lib/predictionWin";
import { haptic, notifyHaptic } from "../lib/telegram";
import { useLiveUpdates } from "../hooks/useLiveUpdates";
import type { Team } from "../types";
import type { StringKey } from "../i18n/strings";

type Tab = "timeline" | "predict" | "stats" | "lineups" | "ratings";
const TABS: Tab[] = ["timeline", "predict", "stats", "lineups", "ratings"];

export default function MatchDetail() {
  const { id = "" } = useParams();
  const { t, lang, localize } = useI18n();
  const { user } = useAuth();
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

  // Tabs live in the URL so a panel is shareable and deep-linkable.
  const [params, setParams] = useSearchParams();
  const requested = params.get("tab") as Tab | null;
  const tab: Tab = requested && TABS.includes(requested) ? requested : "timeline";
  const setTab = (next: Tab) => setParams({ tab: next }, { replace: true });

  // Goal flash when polling reveals a new score.
  const [burst, setBurst] = useState(0);
  const [flashScore, setFlashScore] = useState(false);
  const scoreRef = useRef<string | null>(null);
  useEffect(() => {
    if (!match) return;
    const score = `${match.home_score}-${match.away_score}`;
    if (scoreRef.current && scoreRef.current !== score && match.home_score !== null) {
      setBurst((v) => v + 1);
      setFlashScore(true);
      notifyHaptic("success");
      window.setTimeout(() => setFlashScore(false), 1400);
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

  // The deadline bar needs the pick count. Same query key as the Predict tab,
  // so this shares its cache instead of costing a second round trip, and it
  // warms the tab before the user opens it.
  const predictionsQuery = useQuery({
    queryKey: ["predictions", id],
    queryFn: () => api.getMyPredictions(id),
    enabled: Boolean(id) && match?.status !== "finished",
    staleTime: 0,
  });

  // A pick that just paid off is the one moment this app can celebrate, and the
  // user is already looking at the match when it resolves. The status map is
  // what keeps it to a single burst (src/lib/predictionWin.ts): the first
  // payload of the session only seeds it, so opening an already-resolved match
  // celebrates nothing, and a row sitting at "correct" never re-fires.
  const statusRef = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    const rows = predictionsQuery.data?.predictions;
    if (!rows) return;
    const previous = statusRef.current;
    statusRef.current = new Map(rows.map((row) => [row.mechanic, row.status]));
    if (!justPaidOut(previous, rows)) return;
    setBurst((value) => value + 1);
    notifyHaptic("success");
  }, [predictionsQuery.data]);

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

  // The deadline bar below: shown only while a pick can still be made. An
  // unpicked mechanic whose lock has already passed is a dead end rather than
  // an invitation, so the bar reads the same windows the Predict tab renders.
  const picked = new Set<string>((predictionsQuery.data?.predictions ?? []).map((row) => row.mechanic));
  const lineupsPublished = predictionsQuery.data?.lineupPublished ?? false;
  const predictionStatus = (predictionsQuery.data?.matchStatus ?? match.status ?? "scheduled") as MatchStatus;
  // The Predict tab's own state machine (src/lib/predictionWindow.ts), so the
  // sticky CTA and the cards can never disagree — it honours the lineup gate
  // and closes non-Sub mechanics the moment kickoff passes.
  const pickStillOpen = Object.entries(predictionsQuery.data?.windows ?? {}).some(
    ([mechanic, w]) =>
      !picked.has(mechanic) &&
      isOpen(mechanic as Mechanic, w, { matchStatus: predictionStatus, lineupsPublished }),
  );
  const picksMade = predictionsQuery.data?.predictions.length ?? 0;
  const showPickCta = match.status !== "finished" && tab !== "predict" && pickStillOpen;

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

      <div className="mt-4">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: "timeline", label: t("match.tabTimeline") },
            // Second, not fourth: predicting is the reason this app exists and
            // the only one of the five with a deadline.
            { value: "predict", label: t("predict.hub") },
            { value: "stats", label: t("match.tabStats") },
            { value: "lineups", label: t("match.tabLineups") },
            { value: "ratings", label: t("match.tabRatings") },
          ]}
        />
      </div>

      <section className="panel-in mt-4" key={tab}>
        {tab === "timeline" ? (
          <TimelineTab
            matchId={id}
            live={inPlay}
            minute={currentMinute}
            myUserId={user?.id}
            teams={[home, away]}
          />
        ) : null}
        {tab === "stats" ? <StatsTab matchId={id} live={inPlay} home={home} away={away} /> : null}
        {tab === "lineups" ? <LineupsTab matchId={id} home={home} away={away} /> : null}
        {tab === "predict" ? <PredictionsHub matchId={id} /> : null}
        {tab === "ratings" ? <RatingsTab matchId={id} live={live} league={match.league} /> : null}
      </section>

      {/* The full eye-test view (crowd vs stat, divergence sort) for finished games. */}
      {match.status === "finished" ? (
        <div className="mt-4">
          <Link
            to={`/ratings?match=${match.id}`}
            className="flex items-center gap-2 rounded-card border border-gold/50 bg-surface p-3 transition-colors duration-[var(--t-fast)] hover:bg-elevated"
          >
            <span
              className="grid h-8 w-8 flex-none place-items-center rounded-full border border-gold text-gold"
              style={{ backgroundColor: "color-mix(in srgb, var(--gold) 12%, transparent)" }}
              aria-hidden="true"
            >
              <StarIcon className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-bold text-ink">{t("ratings.title")}</span>
              <span className="block text-[11px] text-ink-3">{t("ratings.subtitle")}</span>
            </span>
            <ChevronRightIcon className="flex-none text-ink-3" />
          </Link>
        </div>
      ) : null}

      {/* Thumb-zone action for the only thing on this page with a deadline.
          It floats above the tab bar instead of living at the end of a long
          scroll, and it disappears the moment the Predict tab is open. The
          spacer keeps the last row from hiding underneath it. */}
      {showPickCta ? (
        <>
          <div className="h-[180px]" aria-hidden="true" />
          {/* The CTA sits on top of the tab bar which itself sits on top of the ad slot,
              so `bottom` is the sum of the TabBar's offset and its own height. */}
          <div className="fixed inset-x-0 bottom-[calc(56px+var(--ad-slot-h,100px)+max(env(safe-area-inset-bottom),8px))] z-20 border-t border-line bg-base/95">
            <div className="mx-auto flex w-full max-w-[560px] items-center justify-between gap-3 px-[var(--space-page-x,16px)] py-3">
              <p className="min-w-0 truncate text-[11px] text-ink-3">
                {t("predict.picksMade", { count: picksMade, total: 5 })}
              </p>
              <Button
                className="flex-none"
                onClick={() => {
                  haptic("light");
                  setTab("predict");
                }}
              >
                {t("predict.makePicks")}
              </Button>
            </div>
          </div>
        </>
      ) : null}

      {/* The Shot Predictor lives in the Predict tab now (concept v2). */}

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
  myUserId,
  teams,
}: {
  matchId: string;
  live: boolean;
  minute: number;
  myUserId?: number;
  /** Both sides, for the timeline markers' club tint. */
  teams: Array<{ id: string; color: string }>;
}) {
  const { t } = useI18n();
  const query = useQuery({
    queryKey: ["timeline", matchId],
    queryFn: () => api.getTimeline(matchId),
    // 20s in play, and the SSE goal event invalidates this key outright, so a
    // goal lands within a second of the server seeing it. The poll is the
    // backstop for everything ESPN doesn't shout about (a corrected minute, a
    // sub, a card).
    refetchInterval: live ? 20_000 : false,
  });
  const events = query.data?.events ?? [];
  const adapted = events.map(adaptTimelineEvent);
  const teamColor = Object.fromEntries(teams.map((team) => [team.id, team.color]));

  // The pinned crowd thread. Loaded alongside the timeline; total count is
  // surfaced in the section header, individual pins render under their event.
  const commentsQuery = useQuery({
    queryKey: ["comments", matchId],
    queryFn: () => api.getComments(matchId),
  });
  const comments = adaptComments(commentsQuery.data?.comments ?? [], myUserId);
  const totalComments = comments.length;

  if (query.isLoading) return <TimelineSkeleton rows={4} />;
  if (query.isError) {
    return <ErrorState title={t("error.title")} hint={t("error.hint")} onRetry={() => query.refetch()} />;
  }
  if (adapted.length === 0) {
    return <EmptyState title={t("timeline.empty")} hint={t("timeline.emptyHint")} />;
  }

  return (
    <>
      <SectionHeading
        title={t("comments.liveThread")}
        action={
          totalComments > 0 ? (
            <span className="text-[11px] font-bold text-gold">
              {t("timeline.comments", { count: totalComments })}
            </span>
          ) : null
        }
      />
      <TimelineList
        events={adapted}
        comments={comments}
        liveMinute={live ? minute : undefined}
        teamColor={teamColor}
        homeTeamId={teams[0]?.id}
        awayTeamId={teams[1]?.id}
      />

      <div className="mt-4">
        <SectionHeading title={t("comments.add")} />
        <CommentsSection
          matchId={matchId}
          events={adapted.map((e) => ({
            id: e.id,
            minuteDisplay: e.minuteDisplay,
            label: `${e.type === "goal" ? "⚽ " : ""}${e.description}`.slice(0, 60),
          }))}
          myUserId={myUserId}
        />
      </div>

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
  live,
  home,
  away,
}: {
  matchId: string;
  /** Refresh the shot plot while the match is in play. */
  live: boolean;
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

  if (query.isLoading) return <StatsTableSkeleton />;
  if (query.isError) {
    return <ErrorState title={t("error.title")} hint={t("error.hint")} onRetry={() => query.refetch()} />;
  }
  if (rows.length === 0) {
    return <EmptyState title={t("ratings.noneYet")} hint={t("stats.noneHint")} />;
  }

  const homeRows = rows.filter((r) => r.team_id === home.id);
  const awayRows = rows.filter((r) => r.team_id === away.id);

  return (
    <div className="space-y-3">
      <PitchView matchId={matchId} live={live} home={home} away={away} />

      <MatchPlayerTable title={home.shortName} color={home.color} rows={homeRows} />
      <MatchPlayerTable title={away.shortName} color={away.color} rows={awayRows} />
      {/* Match stats → season stats: the same cross-link pattern as the
          crowd-rating card below the tabs, so a stat-curious reader has
          somewhere to go instead of a table that just ends. */}
      <Link
        to="/stats"
        className="mt-4 flex items-center gap-2 rounded-card border border-line bg-surface p-3 transition-colors duration-[var(--t-fast)] hover:bg-elevated"
      >
        <span
          className="grid h-8 w-8 flex-none place-items-center rounded-full bg-volt text-black"
          aria-hidden="true"
        >
          <ChartIcon className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-bold text-ink">{t("statsPage.title")}</span>
          <span className="block text-[11px] text-ink-3">{t("statsPage.subtitle")}</span>
        </span>
        <ChevronRightIcon className="flex-none text-ink-3" />
      </Link>
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
            <th className="p-2 text-end font-bold">{t("ratings.points")}</th>
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
              <td className="p-2 text-end">
                <Num className="font-bold text-ink">{num(r.stat_score)}</Num>
              </td>
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
    return <EmptyState title={t("ratings.noneYet")} hint={t("stats.noneHint")} />;
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
}

function RatingsTab({ matchId, live, league }: { matchId: string; live: boolean; league: string }) {
  const { t } = useI18n();
  const query = useQuery({
    queryKey: ["ratings", matchId],
    queryFn: () => api.getRatings(matchId),
    refetchInterval: live ? 30_000 : false,
  });
  const players = query.data?.players ?? [];
  const adapted = players.map((p) => adaptPlayerRating(p, league));
  if (query.isLoading) return <RatingsSkeleton rows={6} />;
  if (query.isError) {
    return <ErrorState title={t("error.title")} hint={t("error.hint")} onRetry={() => query.refetch()} />;
  }
  if (adapted.length === 0) return <EmptyState title={t("ratings.noneYet")} hint={t("ratings.noneHint")} />;

  return (
    <>
      <p className="mb-2 text-xs text-ink-3">
        {live
          ? t("ratings.locked")
          : t("ratings.pickThree") +
            ` · ${t("ratings.cards", { used: query.data?.cardsUsed ?? 0, max: query.data?.cardsMax ?? 3 })}`}
      </p>
      <RatingsList
        matchId={matchId}
        players={adapted}
        distributions={query.data?.distributions ?? null}
        cardsUsed={query.data?.cardsUsed ?? 0}
        cardsMax={query.data?.cardsMax ?? 3}
      />
    </>
  );
}

function RatingsList({
  matchId,
  players,
  distributions,
  cardsUsed,
  cardsMax,
}: {
  matchId: string;
  players: PlayerRating[];
  /** Server-built per-player histograms; null = response predates the field. */
  distributions: Record<string, number[]> | null;
  cardsUsed: number;
  cardsMax: number;
}) {
  const { t, localize } = useI18n();
  const { push } = useToast();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const sheetFor = players.find((row) => row.playerId === params.get("rate")) ?? null;
  const setSheetFor = (player: PlayerRating | null) =>
    setParams(
      (prev) => {
        if (player) prev.set("rate", player.playerId);
        else prev.delete("rate");
        return prev;
      },
      { replace: true },
    );

  const rate = useMutation({
    mutationFn: (input: { playerId: string; value: number; comment?: string }) =>
      api.ratePlayer(matchId, input.playerId, input.value, input.comment),
    onSuccess: (_data, input) => {
      notifyHaptic("success");
      push({
        text: t("toast.ratingSaved", {
          player: localize(players.find((p) => p.playerId === input.playerId)?.name ?? ""),
        }),
        tone: "gold",
        icon: "★",
      });
      void queryClient.invalidateQueries({ queryKey: ["ratings", matchId] });
    },
    onError: (err) => {
      // e.g. "player did not feature" — localized instead of a raw code.
      notifyHaptic("error");
      push({ text: t(serverErrorKey(err) as StringKey), tone: "danger", icon: "✕" });
    },
  });

  return (
    <>
      <ul className="space-y-2">
        {players.map((rating, index) => (
          <RatingRow
            key={rating.playerId}
            index={index}
            rating={rating}
            team={(rating as PlayerRating & { _team: Team })._team}
            onTap={(player) => {
              // The 3-card cap: block a brand-new card when full, edits stay open.
              if (cardsUsed >= cardsMax && player.myRating === null) return;
              setSheetFor(player);
            }}
          />
        ))}
      </ul>
      {sheetFor ? (
        <RateSheet
          rating={sheetFor}
          open
          onClose={() => setSheetFor(null)}
          distribution={distributionFor(sheetFor, distributions)}
          cardsUsed={cardsUsed ?? undefined}
          cardsMax={cardsMax ?? undefined}
          onSave={(playerId, value, comment) => {
            haptic("medium");
            rate.mutate({ playerId, value, comment });
          }}
        />
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------ adapters */

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

function adaptPlayerRating(p: ApiPlayerRating, league: string): PlayerRating {
  return {
    playerId: p.player_id,
    name: p.name,
    teamId: p.team_id,
    position: (p.position ?? "MID") as PlayerRating["position"],
    fantasyPoints: p.stat_score ?? 0,
    crowdRating: p.crowd_rating,
    votes: p.votes ?? 0,
    myRating: p.my_rating ?? null,
    myComment: p.my_comment ?? null,
    latestComment: p.latest_comment ?? null,
    _team: {
      id: p.team_id,
      name: p.team_name ?? "",
      shortName: p.team_short ?? p.team_name ?? "",
      abbreviation: (p.team_short ?? "").slice(0, 3) || "—",
      color: p.team_color ?? TEAM_FALLBACK,
      // The match's real competition; cup matches no longer read as PL sides.
      league: league as import("../types").LeagueId,
    },
  } as PlayerRating & { _team: import("../types").Team };
}

/**
 * Build the RateSheet histogram from the server's real per-rating GROUP BY.
 * Pre-distribution responses (or a player with zero votes) get the flat empty
 * array — an honest "no votes yet", never a synthesized bar.
 */
function distributionFor(rating: PlayerRating, distributions: Record<string, number[]> | null): number[] {
  return distributions?.[rating.playerId] ?? Array.from({ length: 10 }, () => 0);
}
