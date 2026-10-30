import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import {
  api,
  serverErrorKey,
  type ApiMatch,
  type ApiScorer,
  type ApiTeam,
  type ApiTeamAvailability,
  type ApiTeamSplits,
} from "../lib/api";
import type { PredictionWindow } from "../lib/predictionWindow";
import { TEAM_FALLBACK } from "../lib/colors";
import { buildLeagueTabs, type LeagueTab } from "../lib/pickerGroups";
import { teamFromApi } from "../lib/teams";
import {
  addFavoriteOptimistic,
  favoritesView,
  mergePrefsOptimistic,
  removeFavoriteOptimistic,
  type FavoritesPayload,
  type NotificationPrefsPayload,
} from "../lib/optimistic";
import { useToast } from "../components/toastContext";
import { useI18n } from "../i18n/context";
import type { StringKey } from "../i18n/strings";
import { haptic } from "../lib/telegram";
import type { LeagueId, Match, Team } from "../types";
import { LEAGUE_BY_SLUG, SLUG_BY_LEAGUE, slugForLeague, competitionName } from "../lib/leagues";

// Public surface preserved: these now live in pure modules so non-React code
// (and the node test runner) can use them without this file's imports.
export { LEAGUE_BY_SLUG, SLUG_BY_LEAGUE, slugForLeague };
export { teamFromApi };

export function leagueIdOf(slug: string): LeagueId | null {
  return LEAGUE_BY_SLUG[slug] ?? null;
}

/* ------------------------------------------------------------ adapters */

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
    league: m.league,
    status,
    // Preserve the real half-time flag: the status is folded into "live" below.
    isHalftime: m.status === "halftime",
    homeScore: m.home_score,
    awayScore: m.away_score,
    minute: m.minute_display,
    predictions: [],
    round: m.round ?? null,
    homePens: m.home_pens ?? null,
    awayPens: m.away_pens ?? null,
    decidedBy: m.decided_by ?? null,
    venue: m.venue ?? null,
    referee: m.referee ?? null,
    attendance: m.attendance ?? null,
  };
}

/* ------------------------------------------------------------ queries */

/**
 * The matchday feed. Called with no arguments it gets the server's relevance
 * window (live now, recent results, next fortnight) — which is what keeps the
 * screen showing THIS week's football rather than the oldest rows in the DB.
 * Pass `from`/`to` for an explicit fixture range.
 */
export function useMatches(
  query: { league?: string; date?: string; from?: string; to?: string; limit?: number } = {},
) {
  return useQuery({
    queryKey: ["matches", query],
    queryFn: () => api.getMatches(query),
    select: (data) => data.matches.map(matchFromApi),
    refetchInterval: (q) => {
      const live =
        q.state.data?.matches?.some((m) => m.status === "live" || m.status === "halftime") ?? false;
      return live ? 300_000 : false;
    },
    refetchOnWindowFocus: false,
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
  /** Cup group name (e.g. "Group A"); null for league tables. */
  groupName: string | null;
  /** Home and away records; null for a club with no finished match yet. */
  splits: ApiTeamSplits | null;
}

export interface StandingsPayload {
  season: string;
  rows: StandingRow[];
  /** Leading scorers, 0–5. Empty outside the competitions the stat sync covers. */
  scorers: ApiScorer[];
}

export function useStandings(league: string) {
  return useQuery({
    queryKey: ["standings", league],
    queryFn: () => api.getStandings(league),
    select: (data): StandingsPayload => ({
      season: data.season,
      scorers: data.scorers ?? [],
      rows: data.standings.map((row) => ({
        // A standings row is not an ApiTeam: it carries `team_id`, not `id`.
        // Building the team explicitly instead of casting the row is what keeps
        // `/team/:id` links, React keys, isFavorite() and the bundled-crest
        // lookup fed with a real id — teamFromApi reads t.id, so the old blind
        // cast handed it undefined for every row in the table (every link on the
        // Table screen pointed at /team/undefined).
        team: teamFromApi({
          id: row.team_id,
          name: row.name,
          short_name: row.short_name,
          abbreviation: row.abbreviation,
          color: row.color,
          logo_url: row.logo_url,
          league: row.league,
        }),
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
        groupName: row.group_name ?? null,
        splits: row.splits ?? null,
        })),
    }),
    enabled: Boolean(league),
    staleTime: 5 * 60_000,
  });
}

/** The leading-scorer card data for a league, from the standings payload. */
export function useStandingsScorers(league: string): ApiScorer[] {
  const { data } = useStandings(league);
  return data?.scorers ?? [];
}

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
    select: favoritesView,
  });

  // Memoized on the query data, not on the array it produces: `?? []` mints a
  // fresh array every render, which made `ids` (and everything keyed off it)
  // a new value on each pass — exactly what exhaustive-deps flagged.
  const teams = useMemo(() => favoritesQuery.data?.teams ?? [], [favoritesQuery.data]);
  const anchorId = favoritesQuery.data?.anchorId ?? null;

  const ids = useMemo(() => teams.map((t) => t.id), [teams]);
  const isFavorite = useCallback((teamId: string) => ids.includes(teamId), [ids]);

  const add = useMutation({
    mutationFn: (teamId: string) => api.addFavorite(teamId),
    onMutate: async (teamId) => {
      await qc.cancelQueries({ queryKey: ["favorites"] });
      // RAW payload, because that is what the cache holds. The optimistic
      // helpers live in lib/optimistic next to the projection they must match
      // — writing `{teams, anchorId}` here instead throws inside `select`.
      const prev = qc.getQueryData<FavoritesPayload>(["favorites"]);
      const next = addFavoriteOptimistic(prev, currentTeamFromCache(teamId));
      if (next) qc.setQueryData<FavoritesPayload>(["favorites"], next);
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
      const prev = qc.getQueryData<FavoritesPayload>(["favorites"]);
      const next = removeFavoriteOptimistic(prev, teamId);
      if (next) qc.setQueryData<FavoritesPayload>(["favorites"], next);
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
    // Never silent: the pre-fix anchor call had no error handler, so a failed
    // anchor vanished without a trace (the zero-anchor bug's cover). The
    // transient-failure retry lives in followThenAnchor, which owns the
    // follow→anchor ordering — a retry here would also re-run on terminal
    // 4xxs like NOT_FOLLOWING.
    onError: (err) => notifyError(err),
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

/**
 * The RAW ApiTeam row for a club, from the api teams cache. Returned unprojected
 * on purpose: the optimistic favorites write needs the same shape the cache
 * holds, not the Team model the UI reads.
 */
function currentTeamFromCache(teamId: string): ApiTeam | undefined {
  return api.teamsCache.get(teamId);
}

/* ------------------------------------------------------------ league tabs */

/**
 * Tabs for the league-scoped screens (Table, PlayerStats, Leaderboards):
 * the big five always, plus every FOLLOWED non-cup league beyond them. The
 * tab list grows with the follow list — following Eredivisie adds its table,
 * stat boards and leaderboard tab with no other change (server catalog
 * decides what's a table-league; see buildLeagueTabs in lib/pickerGroups).
 */
export function useLeagueTabs(): LeagueTab[] {
  const { t, localize } = useI18n();
  const followed = useFollowedLeagues();
  return useMemo(() => buildLeagueTabs(followed.leagues, t, localize), [followed.leagues, t, localize]);
}

/* ------------------------------------------------------------ referrals */

/**
 * The viewer's invite code + redemption stats, with the redeem mutation.
 * Success/failure toast here (once, centrally) so Profile only supplies the
 * form — a redeemed code clears the local draft via the shared invalidate.
 */
export function useReferral() {
  const qc = useQueryClient();
  const { t } = useI18n();
  const { push } = useToast();

  const query = useQuery({
    queryKey: ["referral"],
    queryFn: () => api.getReferral(),
    select: (data) => data.referral,
    staleTime: 60_000,
  });

  const redeem = useMutation({
    mutationFn: (code: string) => api.redeemReferral(code),
    onSuccess: (res) => {
      haptic("medium");
      qc.invalidateQueries({ queryKey: ["referral"] });
      push({
        text: t(res.rewarded ? "referral.redeemed" : "referral.redeemedNoPoints"),
        tone: "volt",
        icon: "✓",
      });
    },
    onError: (err) => {
      haptic("medium");
      push({ text: t(serverErrorKey(err) as StringKey), tone: "danger", icon: "✕" });
    },
  });

  return {
    referral: query.data,
    loading: query.isLoading,
    redeem,
    redeeming: redeem.isPending,
  };
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
      const prev = qc.getQueryData<NotificationPrefsPayload>(["notification-prefs"]);
      const next = mergePrefsOptimistic(prev, partial);
      if (next) qc.setQueryData<NotificationPrefsPayload>(["notification-prefs"], next);
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
    // Full payload, not just rows: `you` carries the viewer's own rank when it
    // sits below the board's page limit and no row is flagged is_you.
    select: (data) => data,
    staleTime: 60_000,
  });
}

/* ------------------------------------------------------------ competitions */

export function useCompetitions() {
  return useQuery({
    queryKey: ["competitions"],
    queryFn: () => api.getCompetitions(),
    staleTime: 24 * 60 * 60_000,
  });
}

/**
 * How fresh the SERVER's football data is (the sync sentinel's ledger):
 * polled every couple of minutes from the feed so the footer line shows the
 * truth — the fetch succeeded, but the data behind it may still be stale.
 * Cheap (one small SQL snapshot), unauthenticated, and deliberately NOT
 * refetched on focus (it would fight the feed's own refetches for no gain).
 */
export function useSyncHealth() {
  return useQuery({
    queryKey: ["sync-health"],
    queryFn: () => api.getSyncHealth(),
    staleTime: 2 * 60_000,
    refetchInterval: 2 * 60_000,
    refetchOnWindowFocus: false,
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
 * a humanized slug (never the raw code) while that loads. Without this, a cup
 * match page showed the raw "uefa.champions" / "fifa.world".
 */
export function useCompetitionLabel(slug: string): string {
  const { t, localize, lang } = useI18n();
  const query = useCompetitions();
  return useMemo(() => {
    const id = leagueIdOf(slug);
    if (id) return t(`league.${id}` as never);
    const comp = query.data?.competitions.find((c) => c.slug === slug);
    if (comp) return localize(comp.name);
    // Fall back to a localized humanized name, never the raw slug.
    return competitionName(slug, lang);
  }, [slug, query.data, t, localize, lang]);
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
  avatarUrl: string | null;
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
      data.players.map((p) => ({
        playerId: p.player_id,
        name: p.full_name,
        shortName: p.short_name,
        position: p.position ?? "MID",
        teamId: p.team_id,
        teamName: p.team_name,
        teamShort: p.team_short,
        teamColor: p.team_color,
        headshot: p.headshot_url,
        avatarUrl: p.avatar_url ?? null,
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
      data.teams.map((t) => ({
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
export function useRecentLineup(teamId: string) {
  return useQuery({
    queryKey: ["recent-lineup", teamId],
    queryFn: () => api.getRecentLineup(teamId),
    enabled: Boolean(teamId),
    staleTime: 5 * 60_000,
  });
}

export function useTeamAvailability(teamId: string) {
  return useQuery({
    queryKey: ["team-availability", teamId],
    queryFn: () => api.getTeamAvailability(teamId),
    enabled: Boolean(teamId),
    staleTime: 30 * 60_000,
    select: (data): Map<string, ApiTeamAvailability> =>
      new Map(data.players.map((player) => [player.player_id, player])),
  });
}

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

/**
 * Recent ESPN coverage for one club. Served from the league news feed and
 * narrowed by team id, because ESPN publishes no per-team soccer news. Five
 * minutes is plenty fresh for "what happened today" and keeps a tab switch
 * off the network.
 */
export function useLeagueNews(league: string, teamId: string) {
  const { lang } = useI18n();
  return useQuery({
    // The language is part of the key: switching to Persian must refetch, or the
    // cached English payload would keep serving an RTL page.
    queryKey: ["league-news", league, teamId, lang],
    queryFn: () => api.getLeagueNews(league, teamId, lang),
    enabled: Boolean(league && teamId),
    staleTime: 5 * 60_000,
  });
}

/* ------------------------------------------------- match detail extras */

/**
 * Head-to-head for a match: the two clubs' last five meetings. Barely moves
 * while a match is being played, so five minutes of cache is plenty.
 */
export function useMatchH2H(matchId: string) {
  return useQuery({
    queryKey: ["h2h", matchId],
    queryFn: () => api.getH2H(matchId),
    enabled: Boolean(matchId),
    staleTime: 5 * 60_000,
  });
}

/** Both clubs' last-five form; changes only when one of them plays. */
export function useMatchForm(matchId: string) {
  return useQuery({
    queryKey: ["form", matchId],
    queryFn: () => api.getForm(matchId),
    enabled: Boolean(matchId),
    staleTime: 60_000,
  });
}

/** Articles tagged to this match's clubs; news turns over a few times a day. */
export function useMatchNews(matchId: string) {
  const { lang } = useI18n();
  return useQuery({
    queryKey: ["match-news", matchId, lang],
    queryFn: () => api.getMatchNews(matchId, lang),
    enabled: Boolean(matchId),
    staleTime: 5 * 60_000,
  });
}

/* ------------------------------------------------------------------ squads */

export interface SquadRow {
  id: string;
  name: string;
  shortName: string | null;
  position: "GK" | "DEF" | "MID" | "FWD" | "OTHER";
  espnPosition: string | null;
  availability: ApiTeamAvailability | null;
  active: boolean;
  jersey: number | null;
  headshot: string | null;
  avatarUrl?: string | null;
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
        position: (p.position ?? "OTHER") as SquadRow["position"],
        espnPosition: p.espn_position,
        availability: p.availability ?? null,
        active: p.active !== 0,
        jersey: p.jersey_number,
        headshot: p.headshot_url,
        avatarUrl: p.avatar_url ?? null,
        appearances: p.appearances,
        goals: p.season_goals,
        assists: p.season_assists,
      })),
    }),
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
  /** The stored pick, so the card can name the players involved. */
  payload: string | null;
  /** ESPN id → full name, resolved server-side for this row's payload. */
  playerNames: Record<string, string>;
  lockedAt: string;
  resolvedAt: string | null;
  kickoffAt: string | null;
  homeShort: string;
  awayShort: string;
  homeScore: number | null;
  awayScore: number | null;
  /** Live match status, so the card can show whether the pick window is open. */
  matchStatus: string;
  /** Official-lineup signal for this row's match (formation or both XIs' starters). */
  lineupPublished: boolean;
  /** The mechanic's window, built by the server from the same rules the gate uses. */
  window: PredictionWindow | null;
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
          payload: (row.payload as string | null) ?? null,
          playerNames: (row.player_names as Record<string, string> | null) ?? {},
          lockedAt: p.locked_at,
          resolvedAt: p.resolved_at ?? null,
          kickoffAt: (row.kickoff_at as string | null) ?? null,
          homeShort: (row.home_short as string | null) ?? "—",
          awayShort: (row.away_short as string | null) ?? "—",
          homeScore: (row.home_score as number | null) ?? null,
          awayScore: (row.away_score as number | null) ?? null,
          matchStatus: (row.match_status as string | null) ?? "scheduled",
          lineupPublished: Boolean(row.lineup_published),
          window: (row.window as PredictionWindow | null) ?? null,
        };
      }),
  });
}
