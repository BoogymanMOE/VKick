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
import { useToast } from "../components/Toast";
import { CommentaryPanel } from "../components/panels/CommentaryPanel";
import { CommentsSection, adaptComments } from "../components/panels/CommentsPanel";
import { LineupsPanel } from "../components/panels/LineupsPanel";
import { PredictionsHub } from "../components/panels/PredictionsHub";
import { LivePitch } from "../components/LivePitch";
import { ChevronLeftIcon, PlayIcon, StarIcon } from "../components/icons";
import {
  Card,
  Chip,
  EmptyState,
  ErrorState,
  LiveDot,
  Num,
  SectionHeading,
  Segmented,
  TeamBadge,
  cx,
} from "../components/ui";
import { api, serverErrorKey, type ApiPlayerRating, type ApiTimelineEvent } from "../lib/api";
import { TEAM_FALLBACK } from "../lib/colors";
import { leagueIdOf, useCompetitionLabel, useReplay } from "../hooks/useApi";
import { useAuth } from "../hooks/useAuth";
import { useI18n } from "../i18n/I18nProvider";
import { formatKickoff, formatKickoffDate } from "../lib/format";
import { haptic, notifyHaptic } from "../lib/telegram";
import type { Team } from "../types";
import type { StringKey } from "../i18n/strings";

type Tab = "timeline" | "stats" | "lineups" | "predict" | "ratings";
const TABS: Tab[] = ["timeline", "stats", "lineups", "predict", "ratings"];

export default function MatchDetail() {
  const { id = "" } = useParams();
  const { t, lang, localize } = useI18n();
  const { user } = useAuth();
  const locale = lang === "fa" ? "fa-IR" : undefined;

  const matchQuery = useQuery({
    queryKey: ["match", id],
    queryFn: () => api.getMatch(id),
    enabled: Boolean(id),
    // 15s for live scores; 60s otherwise. Halting when the tab is hidden (the
    // refetchInterval function form) keeps a backgrounded webview from
    // polling forever — reopening the tab refetches immediately.
    refetchInterval: (query) =>
      query.state.data?.match.status === "live" && !document.hidden ? 15_000 : false,
    refetchIntervalInBackground: false,
  });
  const match = matchQuery.data?.match;
  const live = match?.status === "live";
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

  // Live pitch (PRODUCT.md rule 1): ball-only live view driven by the replay
  // payload — timeline events (goals with real coordinates), the full
  // commentary track, and the live boxscore are one response, so the page
  // polls it while the match is in play and the classifier in lib/livePitch.ts
  // turns the stream into ball spot + action annotations. 5s while live = the
  // pitch feels like a live feed; these are cheap SQLite reads on the server
  // (the ESPN-side sync cadence is separate — see server/sync/service.ts).
  // Halts when the tab is hidden so a backgrounded webview doesn't poll.
  const replayQuery = useReplay(id, live ? { refetchInterval: 5_000, staleTime: 0 } : undefined);
  const replayData = replayQuery.data;
  const liveCommentary = useMemo(() => replayData?.commentary ?? [], [replayData]);
  const liveEvents = useMemo(() => replayData?.events ?? [], [replayData]);

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
            <Num className="text-[40px] leading-none text-ink">
              {match.home_score ?? "–"} : {match.away_score ?? "–"}
            </Num>
            {live ? (
              <Chip tone="live">
                <LiveDot />
                {t("status.live")} <Num>{currentMinute}&#39;</Num>
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

      {/* Live pitch action: the 2D floodlit view while the match is in play.
          Renders as soon as the timeline exists; the score hero above and the
          tabs below stay untouched. */}
      {live ? (
        <div className="mt-4">
          <LivePitch
            home={{ id: home.id, name: home.name, shortName: home.shortName, color: home.color }}
            away={{ id: away.id, name: away.name, shortName: away.shortName, color: away.color }}
            currentMinute={currentMinute}
            homeScore={match.home_score ?? 0}
            awayScore={match.away_score ?? 0}
            events={liveEvents}
            commentary={liveCommentary}
            teamStats={replayData?.teamStats ?? []}
          />
        </div>
      ) : null}

      <div className="mt-4">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: "timeline", label: t("match.tabTimeline") },
            { value: "stats", label: t("match.tabStats") },
            { value: "lineups", label: t("match.tabLineups") },
            { value: "predict", label: t("predict.hub") },
            { value: "ratings", label: t("match.tabRatings") },
          ]}
        />
      </div>

      <section className="panel-in mt-4" key={tab}>
        {tab === "timeline" ? (
          <TimelineTab matchId={id} live={live} minute={currentMinute} myUserId={user?.id} />
        ) : null}
        {tab === "stats" ? <StatsTab matchId={id} home={home} away={away} /> : null}
        {tab === "lineups" ? <LineupsTab matchId={id} home={home} away={away} /> : null}
        {tab === "predict" ? <PredictionsHub matchId={id} /> : null}
        {tab === "ratings" ? <RatingsTab matchId={id} live={live} /> : null}
      </section>

      {/* Replay entry — the whole match on a 2D pitch, once it's finished. */}
      {match.status === "finished" ? (
        <>
          <div className="mt-6">
            <Link
              to={`/match/${match.id}/replay`}
              className="flex items-center gap-2 rounded-card border border-volt/50 bg-surface p-3 transition-colors duration-[var(--t-fast)] hover:bg-elevated"
            >
              <span
                className="grid h-8 w-8 flex-none place-items-center rounded-full bg-volt text-black"
                aria-hidden="true"
              >
                <PlayIcon className="h-3.5 w-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-bold text-ink">{t("replay.title")}</span>
                <span className="block text-[11px] text-ink-3">{t("replay.openHint")}</span>
              </span>
              <span className="flex-none text-ink-3 rtl:rotate-180">
                <ChevronLeftIcon />
              </span>
            </Link>
          </div>
          {/* The full eye-test view (crowd vs stat, divergence sort) for finished games. */}
          <div className="mt-3">
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
              <span className="flex-none text-ink-3 rtl:rotate-180">
                <ChevronLeftIcon />
              </span>
            </Link>
          </div>
        </>
      ) : null}

      {/* The Shot Predictor lives in the Predict tab now (concept v2). */}
    </>
  );
}

/* ------------------------------------------------------------ tabs */

function TimelineTab({
  matchId,
  live,
  minute,
  myUserId,
}: {
  matchId: string;
  live: boolean;
  minute: number;
  myUserId?: number;
}) {
  const { t } = useI18n();
  const query = useQuery({
    queryKey: ["timeline", matchId],
    queryFn: () => api.getTimeline(matchId),
    refetchInterval: live ? 30_000 : false,
  });
  const events = query.data?.events ?? [];
  const adapted = events.map(adaptTimelineEvent);

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
      <TimelineList events={adapted} comments={comments} liveMinute={live ? minute : undefined} />

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
      <MatchPlayerTable title={home.shortName} color={home.color} rows={homeRows} />
      <MatchPlayerTable title={away.shortName} color={away.color} rows={awayRows} />
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

function RatingsTab({ matchId, live }: { matchId: string; live: boolean }) {
  const { t } = useI18n();
  const query = useQuery({
    queryKey: ["ratings", matchId],
    queryFn: () => api.getRatings(matchId),
    refetchInterval: live ? 30_000 : false,
  });
  const players = query.data?.players ?? [];
  const adapted = players.map(adaptPlayerRating);
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
        cardsUsed={query.data?.cardsUsed ?? 0}
        cardsMax={query.data?.cardsMax ?? 3}
      />
    </>
  );
}

function RatingsList({
  matchId,
  players,
  cardsUsed,
  cardsMax,
}: {
  matchId: string;
  players: PlayerRating[];
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
        {players.map((rating) => (
          <RatingRow
            key={rating.playerId}
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
          distribution={distributionFromVotes(sheetFor)}
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

function adaptPlayerRating(p: ApiPlayerRating): PlayerRating {
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
      league: "PL",
    },
  } as PlayerRating & { _team: import("../types").Team };
}

/** Real histogram when votes exist; flat placeholder when a rating is new. */
function distributionFromVotes(rating: PlayerRating): number[] {
  // The API returns the aggregate; until a histogram endpoint exists, derive a
  // single-bucket truth: all votes at the rounded average. Honest, not fake.
  const counts = Array.from({ length: 10 }, () => 0);
  if (rating.crowdRating !== null && rating.votes > 0) {
    counts[Math.min(9, Math.max(0, Math.round(rating.crowdRating) - 1))] = rating.votes;
  }
  return counts;
}
