import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { api, serverErrorKey, type ApiMatch, type ApiTeam } from "../lib/api";
import { TEAM_FALLBACK } from "../lib/colors";
import { useToast } from "../components/Toast";
import { useI18n } from "../i18n/I18nProvider";
import type { StringKey } from "../i18n/strings";
import { haptic } from "../lib/telegram";
import type { LeagueId, Match, Team } from "../types";
import { LEAGUE_BY_SLUG, SLUG_BY_LEAGUE } from "../lib/leagues";

// Public surface preserved: the maps now live in a pure module so non-React
// code (and the node test runner) can use them without this file's imports.
export { LEAGUE_BY_SLUG, SLUG_BY_LEAGUE };

/**
 * Single source for every screen that tabs over the synced domestic leagues
 * (Table, PlayerStats, Leaderboards league board). Grows with the catalog:
 * add the slug→LeagueId pair above and a `league.*` string, list it here once.
 */
export const LEAGUE_TABS: LeagueId[] = ["PL", "LL", "SA", "BL", "L1"];

/** Cup competitions synced and browsable (Mirrors server/espn/types.ts CUPS). */
export const CUP_SLUGS: string[] = [
  "uefa.champions",
  "uefa.europa",
  "uefa.europa.conf",
  "uefa.super_cup",
  "uefa.champions_qual",
  "eng.fa",
  "eng.league_cup",
  "esp.copa_del_rey",
  "ita.coppa_italia",
  "ger.dfb_pokal",
  "fra.coupe_de_france",
];

/** International tournaments (Mirrors server/espn/types.ts INTERNATIONALS). */
export const TOURNAMENT_SLUGS: string[] = [
  "fifa.world",
  "fifa.cwc",
  "uefa.euro",
  "uefa.euroq",
  "uefa.nations",
  "fifa.worldq.uefa",
  "fifa.worldq.conmebol",
  "conmebol.america",
  "caf.nations",
  "concacaf.gold",
];

/**
 * True for anything with no league table — cups AND international tournaments.
 * Mirrors the server's `isCup`, which is simply "not one of the big five".
 */
export function isCupSlug(slug: string): boolean {
  return CUP_SLUGS.includes(slug) || TOURNAMENT_SLUGS.includes(slug) || slug.startsWith("uefa.");
}

/** The five leagues shown in the picker/tables, as slugs. */
export const LEAGUE_SLUGS = Object.values(SLUG_BY_LEAGUE);

export function leagueIdOf(slug: string): LeagueId | null {
  return LEAGUE_BY_SLUG[slug] ?? null;
}

/* ------------------------------------------------------------ adapters */

export function teamFromApi(t: ApiTeam): Team {
  return {
    id: t.id,
    name: t.name,
    shortName: t.short_name ?? t.name,
    abbreviation: t.abbreviation ?? "—",
    color: t.color ?? TEAM_FALLBACK,
    // Cup-only teams have no LeagueId; park them in PL for colour/type purposes.
    league: LEAGUE_BY_SLUG[t.league] ?? "PL",
    // ...but the picker must not read them as Premier League clubs, so the tab
    // a side belongs under comes from the server's group_key. Team payloads
    // Picker tab key: the server's group_key is a competition slug ("eng.1")
    // or a catch-all ("other" / "international"). The big-five slugs map to
    // their picker aliases (PL…); every other value passes through so extra
    // leagues keep their own tab and the catch-alls keep matching.
    groupKey:
      (t.group_key ? (LEAGUE_BY_SLUG[t.group_key] ?? t.group_key) : null) ??
      LEAGUE_BY_SLUG[t.league] ??
      "other",
    logoUrl: t.logo_url ?? null,
  };
}

export function matchFromApi(m: ApiMatch): Match {
  // Halftime renders as the live moment everywhere (LiveDot sections,
  // club fixture cards); the Match detail page distinguishes it itself.
  const status: Match["status"] = m.status === "halftime" ? "live" : m.status;
  const home: Team = {
    id: m.home_team_id,
    name: m.home_name,
    shortName: m.home_short ?? m.home_name,
    abbreviation: m.home_abbr ?? "—",
    color: m.home_color ?? TEAM_FALLBACK,
    logoUrl: m.home_logo ?? null,
    // Cup matches keep their real competition slug; teamFromApi maps unknown
    // leagues to PL for colour/type purposes (favorites stay big-five only).
    league: LEAGUE_BY_SLUG[m.league] ?? (m.league as LeagueId),
  };
  const away: Team = {
    id: m.away_team_id,
    name: m.away_name,
    shortName: m.away_short ?? m.away_name,
    abbreviation: m.away_abbr ?? "—",
    color: m.away_color ?? TEAM_FALLBACK,
    logoUrl: m.away_logo ?? null,
    league: home.league,
  };
  return {
    id: m.id,
    gameweek: 0, // not per-match in the API yet; MatchCard renders GW only when > 0
    home,
    away,
    kickoffAt: m.kickoff_at,
    status,
    homeScore: m.home_score,
    awayScore: m.away_score,
    minute: m.minute_display,
    predictions: [],
    round: m.round ?? null,
  };
}

/* ------------------------------------------------------------ queries */

export function useMatches(query: { league?: string; date?: string } = {}) {
  return useQuery({
    queryKey: ["matches", query],
    queryFn: () => api.getMatches(query),
    select: (data) => data.matches.map(matchFromApi),
    // Live scores: poll gently; the server polls ESPN on its own schedule.
    refetchInterval: 60_000,
  });
}

export function useMatch(id: string) {
  return useQuery({
    queryKey: ["match", id],
    queryFn: () => api.getMatch(id),
    select: (data) => matchFromApi(data.match),
    enabled: Boolean(id),
  });
}

export function useTeams(league?: string) {
  return useQuery({
    queryKey: ["teams", league ?? "all"],
    queryFn: () => api.getTeams(league),
    select: (data) => data.teams.map(teamFromApi),
  });
}

export interface StandingRow {
  team: Team;
  rank: number | null;
  played: number | null;
  wins: number | null;
  draws: number | null;
  losses: number | null;
  points: number | null;
  goalsFor: number | null;
  goalsAgainst: number | null;
  /** Season expected points from Understat; null when the club isn't covered. */
  xpts: number | null;
  xg: number | null;
  xga: number | null;
  /** Last five results, oldest first ("WWDLW"); null before the first match. */
  form: string | null;
}

export function useStandings(league: string) {
  return useQuery({
    queryKey: ["standings", league],
    queryFn: () => api.getStandings(league),
    select: (data): StandingRow[] =>
      data.standings.map((row) => ({
        team: teamFromApi(row as unknown as ApiTeam & ApiStandingFields),
        rank: row.rank,
        played: row.played,
        wins: row.wins,
        draws: row.draws,
        losses: row.losses,
        points: row.points,
        goalsFor: row.goals_for,
        goalsAgainst: row.goals_against,
        xpts: row.xpts ?? null,
        xg: row.xg ?? null,
        xga: row.xga ?? null,
        form: row.form ?? null,
      })),
    enabled: Boolean(league),
    staleTime: 5 * 60_000,
  });
}

type ApiStandingFields = {
  rank: number | null;
  played: number | null;
  wins: number | null;
  draws: number | null;
  losses: number | null;
  points: number | null;
  goals_for: number | null;
  goals_against: number | null;
  xpts?: number | null;
  xg?: number | null;
  xga?: number | null;
  form?: string | null;
};

/* ------------------------------------------------------------ favorites */

/**
 * Favorites now live on the server (one source of truth across devices),
 * with optimistic local updates so taps feel instant. Server rule errors
 * (MAX_CLUBS / ALREADY_FOLLOWING / LEAGUE_NOT_COVERED) surface to the caller.
 * The anchor club (`is_favorite`) sorts first and is surfaced as `anchorId`.
 */
export function useFavorites() {
  const qc = useQueryClient();
  const { t } = useI18n();
  const { push } = useToast();

  // Server failures roll the optimistic row back AND tell the user — a silent
  // rollback leaves a stale success impression (the pre-polish bug).
  const notifyError = (err: unknown) => {
    haptic("medium");
    push({ text: t(serverErrorKey(err) as StringKey), tone: "danger", icon: "✕" });
  };

  const favoritesQuery = useQuery({
    queryKey: ["favorites"],
    queryFn: () => api.getFavorites(),
    select: (data) => ({
      teams: data.favorites.map(teamFromApi),
      anchorId: data.favorites.find((f) => f.is_favorite === 1)?.id ?? data.favorites[0]?.id ?? null,
    }),
  });

  const teams = favoritesQuery.data?.teams ?? [];
  const anchorId = favoritesQuery.data?.anchorId ?? null;

  const ids = teams.map((t) => t.id);
  const isFavorite = useCallback((teamId: string) => ids.includes(teamId), [ids]);

  const add = useMutation({
    mutationFn: (teamId: string) => api.addFavorite(teamId),
    onMutate: async (teamId) => {
      await qc.cancelQueries({ queryKey: ["favorites"] });
      const prev = qc.getQueryData(["favorites"]);
      const current = teams;
      if (current.length < 5 && !current.some((t) => t.id === teamId)) {
        const optimistic = current.concat(
          currentTeamFromCache(teamId) ?? {
            id: teamId,
            name: "…",
            shortName: "…",
            abbreviation: "—",
            color: TEAM_FALLBACK,
            league: "PL" as const,
          },
        );
        qc.setQueryData(["favorites"], { teams: optimistic, anchorId });
      }
      return { prev };
    },
    onError: (err, _teamId, ctx) => {
      if (ctx?.prev) qc.setQueryData(["favorites"], ctx.prev);
      notifyError(err);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["favorites"] }),
  });

  const remove = useMutation({
    mutationFn: (teamId: string) => api.removeFavorite(teamId),
    onMutate: async (teamId) => {
      await qc.cancelQueries({ queryKey: ["favorites"] });
      const prev = qc.getQueryData(["favorites"]);
      const current = teams;
      qc.setQueryData(["favorites"], {
        teams: current.filter((t) => t.id !== teamId),
        anchorId: anchorId === teamId ? null : anchorId,
      });
      return { prev };
    },
    onError: (err, _teamId, ctx) => {
      if (ctx?.prev) qc.setQueryData(["favorites"], ctx.prev);
      notifyError(err);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["favorites"] }),
  });

  const setAnchor = useMutation({
    mutationFn: (teamId: string) => api.setAnchor(teamId),
    onSettled: () => qc.invalidateQueries({ queryKey: ["favorites"] }),
  });

  return {
    teams,
    ids,
    anchorId,
    count: teams.length,
    isFavorite,
    add,
    remove,
    setAnchor,
    loading: favoritesQuery.isLoading,
  };
}

/* ------------------------------------------------------------ followed leagues */

/**
 * The league follow list (max 5, any ESPN-covered competition). Drives the
 * default matchday feed and the tables view. Same optimistic pattern.
 */
export function useFollowedLeagues() {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["followed-leagues"],
    queryFn: () => api.getFollowedLeagues(),
    select: (data) => data.leagues,
  });

  const leagues = query.data ?? [];
  const slugs = leagues.map((l) => l.league);

  const follow = useMutation({
    mutationFn: (league: string) => api.followLeague(league),
    onSettled: () => qc.invalidateQueries({ queryKey: ["followed-leagues"] }),
  });
  const unfollow = useMutation({
    mutationFn: (league: string) => api.unfollowLeague(league),
    onSettled: () => qc.invalidateQueries({ queryKey: ["followed-leagues"] }),
  });

  return {
    leagues,
    slugs,
    count: leagues.length,
    isFollowing: (slug: string) => slugs.includes(slug),
    follow,
    unfollow,
    loading: query.isLoading,
  };
}

/** Team detail from the api teams cache, for optimistic favorite badges. */
function currentTeamFromCache(teamId: string): Team | undefined {
  const t = api.teamsCache.get(teamId);
  return t ? teamFromApi(t) : undefined;
}

/* ------------------------------------------------------------ notification prefs */

export interface NotificationPrefs {
  goals: boolean;
  deadline: boolean;
  ratings: boolean;
}

/**
 * The server-side push preferences. Source of truth is the DB row (absent =
 * all on); the Profile sheet toggles write through here, so a switch flip
 * actually gates the bot's sends.
 */
export function useNotificationPrefs() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["notification-prefs"],
    queryFn: () => api.getNotificationPrefs(),
    select: (data) => data.prefs,
    staleTime: 60_000,
  });

  const set = useMutation({
    mutationFn: (prefs: Partial<NotificationPrefs>) => api.setNotificationPrefs(prefs),
    onMutate: async (partial) => {
      await qc.cancelQueries({ queryKey: ["notification-prefs"] });
      const prev = qc.getQueryData<NotificationPrefs>(["notification-prefs"]);
      if (prev) qc.setQueryData(["notification-prefs"], { ...prev, ...partial });
      return { prev };
    },
    onError: (_err, _partial, ctx) => {
      if (ctx?.prev) qc.setQueryData(["notification-prefs"], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["notification-prefs"] }),
  });

  return { prefs: query.data, set, loading: query.isLoading };
}

/* ------------------------------------------------------------ leaderboards */

export type LeaderboardScope = "global" | { league: string } | { club: string };

/**
 * Season prediction leaderboards: global / per-league / per-club. The server
 * resolves ties by first-to-reach and returns ranked rows directly.
 */
export function useLeaderboard(scope: LeaderboardScope) {
  const path =
    scope === "global"
      ? "global"
      : "league" in scope
        ? `league/${encodeURIComponent(scope.league)}`
        : `club/${encodeURIComponent(scope.club)}`;
  return useQuery({
    queryKey: ["leaderboard", path],
    queryFn: () => api.getLeaderboard(path as "global"),
    select: (data) => data.board,
    staleTime: 60_000,
  });
}

/* ------------------------------------------------------------ competitions */

export interface CompetitionRow {
  slug: string;
  name: string;
  kind: "league" | "cup";
  hasTable: boolean;
}

export function useCompetitions() {
  return useQuery({
    queryKey: ["competitions"],
    queryFn: () => api.getCompetitions(),
    staleTime: 24 * 60 * 60_000,
  });
}

/**
 * Knockout competitions for the Cups picker: the club cups AND the
 * international tournaments (both have no table). Selection is on the server's
 * `kind`, so promoting a competition into the catalog adds it here with no
 * client change.
 */
export function useKnockoutCompetitions() {
  const query = useCompetitions();
  return {
    ...query,
    data: query.data ? query.data.competitions.filter((c) => c.kind !== "league") : undefined,
  };
}

/**
 * Display name for any competition slug. Big-five slugs keep their short
 * localized alias; everything else (cups, international tournaments) reads the
 * catalog's own name through the cached competitions query, falling back to
 * the slug while that loads. Without this, a cup match page showed the raw
 * "uefa.champions" / "fifa.world".
 */
export function useCompetitionLabel(slug: string): string {
  const { t, localize } = useI18n();
  const query = useCompetitions();
  return useMemo(() => {
    const id = leagueIdOf(slug);
    if (id) return t(`league.${id}` as never);
    const comp = query.data?.competitions.find((c) => c.slug === slug);
    return comp ? localize(comp.name) : slug;
  }, [slug, query.data, t, localize]);
}

/* ------------------------------------------------------------ leaderboards */

export interface LeaderPlayerRow {
  playerId: string;
  name: string;
  shortName: string | null;
  position: string;
  teamId: string;
  teamName: string;
  teamShort: string | null;
  teamColor: string | null;
  headshot: string | null;
  jersey: number | null;
  appearances: number;
  goals: number;
  assists: number;
  minutes: number;
  shots: number;
  shotsOnTarget: number;
  yellowCards: number;
  redCards: number;
  saves: number;
  goalsConceded: number;
  ownGoals: number;
  statScoreTotal: number;
  statScoreAvg: number;
}

export type LeaderSort =
  | "goals"
  | "assists"
  | "appearances"
  | "minutes"
  | "shots"
  | "shots_on_target"
  | "yellow_cards"
  | "red_cards"
  | "saves"
  | "goals_conceded"
  | "fouls_committed"
  | "own_goals"
  | "stat_score_total"
  | "stat_score_avg";

export function useLeaguePlayers(league: string, sort: LeaderSort = "goals", limit = 50) {
  return useQuery({
    queryKey: ["leaguePlayers", league, sort, limit],
    queryFn: () => api.getLeaguePlayers(league, sort, limit),
    select: (data): LeaderPlayerRow[] =>
      data.players.map((p: any) => ({
        playerId: p.player_id,
        name: p.full_name,
        shortName: p.short_name,
        position: p.position ?? "MID",
        teamId: p.team_id,
        teamName: p.team_name,
        teamShort: p.team_short,
        teamColor: p.team_color,
        headshot: p.headshot_url,
        jersey: p.jersey_number,
        appearances: p.appearances ?? 0,
        goals: p.goals ?? 0,
        assists: p.assists ?? 0,
        minutes: p.minutes ?? 0,
        shots: p.shots ?? 0,
        shotsOnTarget: p.shots_on_target ?? 0,
        yellowCards: p.yellow_cards ?? 0,
        redCards: p.red_cards ?? 0,
        saves: p.saves ?? 0,
        goalsConceded: p.goals_conceded ?? 0,
        ownGoals: p.own_goals ?? 0,
        statScoreTotal: p.stat_score_total ?? 0,
        statScoreAvg: p.stat_score_avg ?? 0,
      })),
    enabled: Boolean(league),
    staleTime: 5 * 60_000,
  });
}

export interface LeagueTeamRow {
  teamId: string;
  name: string;
  shortName: string | null;
  color: string | null;
  logo: string | null;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  cleanSheets: number;
  avgPossession: number;
  avgPassAccuracy: number;
  totalShots: number;
  totalShotsOnTarget: number;
  totalCorners: number;
  totalFouls: number;
}

export function useLeagueTeamStats(league: string) {
  return useQuery({
    queryKey: ["leagueTeamStats", league],
    queryFn: () => api.getLeagueTeamStats(league),
    select: (data): LeagueTeamRow[] =>
      data.teams.map((t: any) => ({
        teamId: t.team_id,
        name: t.name,
        shortName: t.short_name,
        color: t.color,
        logo: t.logo_url,
        played: t.played ?? 0,
        wins: t.wins ?? 0,
        draws: t.draws ?? 0,
        losses: t.losses ?? 0,
        goalsFor: t.goals_for ?? 0,
        goalsAgainst: t.goals_against ?? 0,
        cleanSheets: t.clean_sheets ?? 0,
        avgPossession: t.avg_possession ?? 0,
        avgPassAccuracy: t.avg_pass_accuracy ?? 0,
        totalShots: t.total_shots ?? 0,
        totalShotsOnTarget: t.total_shots_on_target ?? 0,
        totalCorners: t.total_corners ?? 0,
        totalFouls: t.total_fouls ?? 0,
      })),
    enabled: Boolean(league),
    staleTime: 5 * 60_000,
  });
}

/** Per-team season stat line + recent fixtures. */
export function useTeamDetail(teamId: string) {
  return useQuery({
    queryKey: ["team", teamId],
    queryFn: () => api.getTeam(teamId),
    enabled: Boolean(teamId),
  });
}

/**
 * Understat season xG for one club. Empty (not an error) for clubs the scraper
 * doesn't cover — it runs for followed big-five sides only, so most cups and
 * every competition outside the big five legitimately have nothing to show.
 */
export function useTeamUnderstat(teamId: string) {
  return useQuery({
    queryKey: ["team-understat", teamId],
    queryFn: () => api.getTeamUnderstat(teamId),
    enabled: Boolean(teamId),
    staleTime: 30 * 60_000,
  });
}

/* ------------------------------------------------------------ replay & squads */

export function useReplay(
  matchId: string,
  /** Live matches pass { refetchInterval: 30_000, staleTime: 0 } to keep the
   *  pitch current; the default caches hard for finished replays. */
  options?: { refetchInterval: number; staleTime: number },
) {
  return useQuery({
    queryKey: ["replay", matchId],
    queryFn: () => api.getReplay(matchId),
    enabled: Boolean(matchId),
    staleTime: 10 * 60_000,
    ...options,
  });
}

export function useCommentary(matchId: string) {
  return useQuery({
    queryKey: ["commentary", matchId],
    queryFn: () => api.getCommentary(matchId),
    enabled: Boolean(matchId),
    staleTime: 10 * 60_000,
  });
}

export interface SquadRow {
  id: string;
  name: string;
  shortName: string | null;
  position: "GK" | "DEF" | "MID" | "FWD";
  espnPosition: string | null;
  jersey: number | null;
  headshot: string | null;
  appearances: number | null;
  goals: number | null;
  assists: number | null;
}

export function useSquad(teamId: string) {
  return useQuery({
    queryKey: ["squad", teamId],
    queryFn: () => api.getSquad(teamId),
    enabled: Boolean(teamId),
    staleTime: 30 * 60_000,
    select: (data) => ({
      season: data.season,
      coach: data.coach,
      players: data.players.map((p): SquadRow => ({
        id: p.id,
        name: p.full_name,
        shortName: p.short_name,
        position: (p.position ?? "MID") as SquadRow["position"],
        espnPosition: p.espn_position,
        jersey: p.jersey_number,
        headshot: p.headshot_url,
        appearances: p.appearances,
        goals: p.season_goals,
        assists: p.season_assists,
      })),
    }),
  });
}

/** Timeline events with shot coordinates, for pitch visualizations. */
export function useReplayEvents(matchId: string) {
  return useQuery({
    queryKey: ["replay", matchId],
    queryFn: () => api.getReplay(matchId),
    enabled: Boolean(matchId),
    staleTime: 10 * 60_000,
    select: (data) => data.events,
  });
}

/* ------------------------------------------------------------ my predictions */

/**
 * One settled-or-pending pick, with the match it belongs to and the resolver's
 * stored breakdown — the raw material for the "why did I get X" panel.
 */
export interface PredictionHistoryRow {
  id: number;
  matchId: string;
  mechanic: string;
  status: string;
  points: number;
  breakdown: string | null;
  lockedAt: string;
  resolvedAt: string | null;
  kickoffAt: string | null;
  homeShort: string;
  awayShort: string;
  homeScore: number | null;
  awayScore: number | null;
}

/**
 * The caller's prediction history (newest first, capped at 100 server-side).
 * The endpoint returns the raw row joined to its match, so the mapping lives
 * here rather than in a server-side shape.
 */
export function useMyPredictionHistory() {
  return useQuery({
    queryKey: ["myPredictions"],
    queryFn: () => api.getMyPredictionsAll(),
    select: (data): PredictionHistoryRow[] =>
      data.predictions.map((p) => {
        const row = p as unknown as Record<string, unknown>;
        return {
          id: p.id,
          matchId: p.match_id,
          mechanic: p.mechanic,
          status: p.status,
          points: p.points_awarded ?? 0,
          breakdown: p.breakdown ?? null,
          lockedAt: p.locked_at,
          resolvedAt: p.resolved_at ?? null,
          kickoffAt: (row.kickoff_at as string | null) ?? null,
          homeShort: (row.home_short as string | null) ?? "—",
          awayShort: (row.away_short as string | null) ?? "—",
          homeScore: (row.home_score as number | null) ?? null,
          awayScore: (row.away_score as number | null) ?? null,
        };
      }),
  });
}
