/**
 * Thin API client for the Vkick backend (server/, port 8787 via the vite
 * dev proxy). Auth = a `mg_…` session token from the Login screen, or the
 * Telegram initData string as a Bearer token inside the webview.
 *
 * In Telegram: `window.Telegram.WebApp.initData` (validated server-side via
 * HMAC). On the web: username + password (scrypt-hashed server-side, see
 * server/auth/password.ts), or a `dev:<telegramId>` token when DEV_AUTH_SECRET
 * is set on the server. Never enable that in production.
 */

import { currentAuthToken, getDeviceId } from "./auth";
import type { LineupPlayer, MatchForm, MatchH2H, NewsArticle } from "../types";

const BASE = "/api";
/** A stalled API request must not leave a screen loading indefinitely. */
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Every non-2xx response is thrown as one of these, so callers can branch on
 * `status` (401 = the stored session is dead) instead of re-deriving it from a
 * message string or casting through `any`.
 */
export interface ApiRequestError extends Error {
  code?: string;
  status?: number;
}

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${currentAuthToken()}`,
      ...(opts.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    const err = new Error(body.error ?? `HTTP ${res.status}`) as ApiRequestError;
    err.code = body.error;
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as T;
}

/**
 * Translate a machine-readable server error code into a user-facing i18n key.
 * The server's codes (MAX_CLUBS, LOCKED_DEADLINE_PASSED, SUB_CAP_REACHED…)
 * are designed for exactly this — see the API surface table in README.md.
 * Unknown codes fall back to `common.error`.
 */
export function serverErrorKey(err: unknown): string {
  const code = (err as Error & { code?: string })?.code;
  const MAP: Record<string, string> = {
    // my teams & leagues
    MAX_CLUBS: "myTeams.errCap",
    // the international favorites shelf (up to five national teams on top of
    // the five clubs) has its own cap and its own message
    MAX_INTERNATIONALS: "myTeams.errIntlCap",
    MAX_LEAGUES: "leagues.errCap",
    ALREADY_FOLLOWING: "myTeams.alreadyFollowing",
    LEAGUE_NOT_COVERED: "leagues.errLeague",
    NOT_FOLLOWING: "myTeams.alreadyFollowing",
    // predictions
    LOCKED_MATCH_STARTED: "predict.lockedMatchStarted",
    LOCKED_DEADLINE_PASSED: "predict.locked",
    SUB_ONLY_DURING_LIVE: "sub.windowLive",
    SUB_NOT_OPEN: "sub.windowLive",
    SUB_LOCKED_HALFTIME: "sub.lockedHalftime",
    SUB_CAP_REACHED: "sub.capReached",
    LINEUP_NOT_PUBLISHED: "predict.waitLineup",
    INVALID_PAYLOAD: "common.error",
    // ratings (3-card rule)
    RATING_CAP_REACHED: "ratings.capReached",
    // referrals
    INVALID_CODE: "referral.errInvalid",
    SELF_REFERRAL: "referral.errSelf",
    ALREADY_REDEEMED: "referral.errAlready",
    // auth
    NO_ACCOUNT: "auth.errNoAccount",
    // Wrong password and unknown username share one response (the server
    // returns INVALID_CREDENTIALS for both) so login never reveals existence.
    INVALID_CREDENTIALS: "auth.errInvalidCredentials",
    BAD_PASSWORD: "auth.errPassword",
    USERNAME_TAKEN: "auth.errTaken",
    BAD_USERNAME: "auth.errUsername",
    BAD_DEVICE_ID: "common.error",
    // profile
    EMPTY_NAME: "profile.nameEmpty",
    // admin/notify path (409): recipient disabled goal-alert bot DMs
    RECIPIENT_OPTED_OUT: "profile.recipientOptedOut",
    // rate limiter (429): too many sign-in attempts
    TOO_MANY_REQUESTS: "auth.errRateLimited",
    // cup standings endpoint (404): knockout competitions have no table
    NO_TABLE_FOR_CUP: "cups.noTable",
    // team/match/standings read (404): the competition is outside the
    // five-league catalog, so it has no page in this app
    LEAGUE_NOT_SUPPORTED: "team.leagueUnsupported",
    // Telegram/initData verification failures on the login route (the Login
    // screen's Telegram path): malformed or stale initData, or the server has
    // no bot token configured. Never the generic fallback — the client cannot
    // fix these, but "Telegram sign-in failed" points at the right retry.
    "missing hash": "auth.errTelegram",
    "hash mismatch": "auth.errTelegram",
    "initData expired": "auth.errTelegram",
    "missing user": "auth.errTelegram",
    "missing user.id": "auth.errTelegram",
    "user JSON invalid": "auth.errTelegram",
    "no bot token": "auth.errTelegram",
    "no bot token configured": "auth.errTelegram",
  };
  return (code && MAP[code]) || "common.error";
}

/* ------------------------------------------------------------ types */

/** Response shape of the sign-in / register / Telegram endpoints. */
export interface AuthSuccess {
  ok: boolean;
  mode: "session" | "telegram" | "dev";
  token: string;
  user: { id: number; display_name: string };
}

export interface ApiTeam {
  id: string;
  name: string;
  short_name: string | null;
  abbreviation: string | null;
  color: string | null;
  logo_url: string | null;
  league: string;
  /**
   * Picker tab for this side (see GET /api/teams). Only the /api/teams
   * endpoint computes it; other team payloads leave it undefined and the
   * client falls back to the league mapping.
   */
  group_key?: string;
}

export interface ApiMatch {
  id: string;
  league: string;
  home_team_id: string;
  away_team_id: string;
  kickoff_at: string;
  status: "scheduled" | "live" | "halftime" | "finished";
  home_score: number | null;
  away_score: number | null;
  minute_display: string | null;
  home_formation: string | null;
  away_formation: string | null;
  last_synced_at: string | null;
  /** Cup round label from ESPN (e.g. "Quarter-final"); null for leagues. */
  round?: string | null;
  home_name: string;
  home_short: string | null;
  home_abbr: string | null;
  home_color: string | null;
  home_logo: string | null;
  away_name: string;
  away_short: string | null;
  away_abbr: string | null;
  away_color: string | null;
  away_logo: string | null;
}

export interface ApiFavorite extends ApiTeam {
  is_favorite: number;
  created_at: string;
}

export interface ApiFollowedLeague {
  league: string;
  name: string | null;
  kind: "league" | "cup" | "tournament" | null;
  created_at: string;
}

/** Referral program state for the viewer (Profile → Invite friends). */
export interface ApiReferral {
  code: string;
  invited: number;
  rewarded: number;
  maxPaidInvites: number;
  perInvite: number;
  youRedeemed: boolean;
}

export interface ApiPredictionWindow {
  opensAt: string | null;
  lockAt: string;
  /**
   * What this window waits on before it can open. `"lineup"` = the official XI
   * must be published first; `null` = clock-only. Self-describing so the UI
   * doesn't carry its own copy of the gated set.
   */
  requires?: "lineup" | null;
}

export interface ApiLeaderRow {
  rank: number;
  /** The unique @username when set; a plain display name otherwise. */
  display_name: string;
  username: string | null;
  is_you: boolean;
  total: number;
  last_award: string | null;
}

/** The viewer's own rank when it sits below the board's page limit. */
export interface ApiViewerRank {
  rank: number;
  total: number;
}

export interface ApiCompetition {
  slug: string;
  name: string;
  kind: "league" | "cup" | "tournament";
  hasTable: boolean;
  /** True for extra ESPN competitions the sync doesn't cover yet. */
  comingSoon?: boolean;
}

/**
 * Row behind GET /api/leagues/:league/players. Fields the client maps through
 * a `??` default are optional — the server only sends a stat the competition
 * actually tracks — while the identity columns the mapper reads directly are
 * required, so a payload drift becomes a compile error here rather than a
 * `undefined` rendered in a leaderboard.
 */
export interface LeaguePlayerStatRow {
  player_id: string;
  full_name: string;
  short_name: string | null;
  position?: string | null;
  team_id: string;
  team_name: string;
  team_short: string | null;
  team_color: string | null;
  headshot_url: string | null;
  /** Local-first face URL: /headshots/<id>.webp when the file exists, else the
      remote headshot_url, else null (avatar falls back to initials). */
  avatar_url: string | null;
  jersey_number: number | null;
  appearances?: number | null;
  goals?: number | null;
  assists?: number | null;
  minutes?: number | null;
  shots?: number | null;
  shots_on_target?: number | null;
  yellow_cards?: number | null;
  red_cards?: number | null;
  saves?: number | null;
  goals_conceded?: number | null;
  own_goals?: number | null;
  stat_score_total?: number | null;
  stat_score_avg?: number | null;
}

/** Row behind GET /api/leagues/:league/teams — same optional-stat convention. */
export interface LeagueTeamStatRow {
  team_id: string;
  name: string;
  short_name: string | null;
  color: string | null;
  logo_url: string | null;
  played?: number | null;
  wins?: number | null;
  draws?: number | null;
  losses?: number | null;
  goals_for?: number | null;
  goals_against?: number | null;
  clean_sheets?: number | null;
  avg_possession?: number | null;
  avg_pass_accuracy?: number | null;
  total_shots?: number | null;
  total_shots_on_target?: number | null;
  total_corners?: number | null;
  total_fouls?: number | null;
}

/**
 * One side of GET /api/matches/:id/team-stats — the per-match box score from
 * match_team_stats. Goals come off the matches row (the boxscore table carries
 * none). A null field means the stat did not sync for this match; the whole
 * side is null when no row exists yet (stats not synced, match still upcoming).
 */
export interface TeamStats {
  possession_pct: number | null;
  corners: number | null;
  pass_accuracy_pct: number | null;
  shots: number | null;
  shots_on_target: number | null;
  fouls: number | null;
  offsides: number | null;
  saves: number | null;
  goals: number | null;
}

export interface ApiStanding {
  team_id: string;
  /** The competition this table belongs to — also feeds teamFromApi's league mapping. */
  league: string;
  rank: number | null;
  played: number | null;
  wins: number | null;
  draws: number | null;
  losses: number | null;
  goals_for: number | null;
  goals_against: number | null;
  points: number | null;
  name: string;
  short_name: string | null;
  abbreviation: string | null;
  color: string | null;
  logo_url: string | null;
  /** Understat season expected points; null for clubs the scraper misses. */
  xpts?: number | null;
  xg?: number | null;
  group_name?: string | null;
  xga?: number | null;
  /** Last five results, oldest first, e.g. "WWDLW"; null before a club's first match. */
  form?: string | null;
}

export interface ApiTimelineEvent {
  id: number;
  match_id: string;
  minute_display: string;
  minute_seconds: number;
  type: string;
  team_id: string | null;
  description: string;
  participants: { id: string; name: string }[];
  comment_count: number;
  /** Shot origin 0..100 (length/width) and goal-line position — goals only. */
  field_x: number | null;
  field_y: number | null;
  goal_y: number | null;
}

export interface ApiTeamAvailability {
  player_id: string;
  player_name: string;
  status: "injured" | "suspended" | "doubtful";
  reason: string | null;
  expected_return: string | null;
}

export interface ApiSquadPlayer {
  id: string;
  full_name: string;
  short_name: string | null;
  position: string;
  availability?: ApiTeamAvailability | null;
  espn_position: string | null;
  jersey_number: number | null;
  headshot_url: string | null;
  avatar_url: string | null;
  appearances: number | null;
  season_goals: number | null;
  season_assists: number | null;
}

/**
 * Understat season data for one club (server: `GET /teams/:id/understat`).
 * Coverage is the big five only — the scraper runs for followed clubs — so a
 * club outside it legitimately returns empty arrays and a null team line.
 */
export interface ApiUnderstatPlayer {
  id: string;
  name: string;
  position: string;
  jersey: number | null;
  headshot: string | null;
  avatarUrl: string | null;
  xg: number | null;
  xa: number | null;
  xg90: number | null;
  xa90: number | null;
  sh90: number | null;
  kp90: number | null;
  apps: number | null;
  minutes: number | null;
  goals: number | null;
  assists: number | null;
}

/** One shot type's season split — open play, corner, set piece, free kick, pen. */
export interface ApiUnderstatSituation {
  situation: string;
  shots: number | null;
  goals: number | null;
  shots_against: number | null;
  goals_against: number | null;
  xg: number | null;
  xga: number | null;
}

export interface ApiTeamUnderstat {
  players: ApiUnderstatPlayer[];
  /** Season totals, summed across the club's played matches. */
  teamStats: {
    xg: number | null;
    xga: number | null;
    /** Season expected points — what the table "should" read. */
    xpts: number | null;
    /** Mean passes allowed per defensive action; lower means more pressing. */
    ppda: number | null;
    /** Completed passes into the final 20m, summed. */
    deep: number | null;
  } | null;
  situations: ApiUnderstatSituation[];
}

export interface ApiPlayerRating {
  player_id: string;
  name: string;
  short_name: string | null;
  team_id: string;
  position: string;
  stat_score: number | null;
  stat_breakdown: string | null;
  started: number;
  minutes_played: number | null;
  avg_rating: number | null;
  votes: number;
  my_rating: number | null;
  my_comment: string | null;
  latest_comment: string | null;
  /** crowd_ratings.id of latest_comment, for reporting it. */
  latest_comment_id: number | null;
  crowd_rating: number | null;
  team_name?: string | null;
  team_short?: string | null;
  team_color?: string | null;
}

export interface ApiComment {
  id: number;
  event_id: number | null;
  match_id: string;
  minute_display: string | null;
  minute_seconds: number | null;
  user_id: number;
  text: string;
  media_link: string | null;
  created_at: string;
  author: string;
}

export interface ApiStreak {
  current: number;
  active: boolean;
  seasonHits: number;
  thresholdsPaid: number[];
  /** Next unclaimed threshold (3/5/10), or null when all are paid. */
  nextThreshold: number | null;
  nextThresholdGap: number | null;
  nextBonus: number | null;
}

export interface ApiPrediction {
  id: number;
  match_id: string;
  mechanic: "lineup" | "shot_predict" | "sub" | "player_watch" | "versus";
  payload: string;
  locked_at: string;
  status: "pending" | "correct" | "wrong" | "void" | "partial";
  points_awarded: number;
  breakdown: string | null;
  resolved_at: string | null;
}

/* ------------------------------------------------------------ endpoints */

export interface ApiTeamSeasonStats {
  league: string;
  season: string;
  team_id: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goals_for: number;
  goals_against: number;
  clean_sheets: number;
  avg_possession: number;
  avg_pass_accuracy: number;
  total_shots: number;
  total_shots_on_target: number;
  total_corners: number;
  total_fouls: number;
}

export const api = {
  /** Team rows seen this session, for optimistic favorite badges. */
  teamsCache: new Map<string, ApiTeam>(),

  login: () =>
    request<AuthSuccess>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ initData: currentAuthToken(), deviceId: getDeviceId() }),
    }),

  /** Sign in with username + password (one shared failure either way). */
  loginWithUsername: (username: string, password: string) =>
    request<AuthSuccess>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password, deviceId: getDeviceId() }),
    }),

  /**
   * Register a username account (explicit "Create account" form — never
   * auto-created on a typo'd sign-in). deviceId rides along so a web guest's
   * existing picks merge into the new account server-side.
   */
  register: (username: string, password: string, displayName?: string) =>
    request<AuthSuccess>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, password, displayName, deviceId: getDeviceId() }),
    }),

  /**
   * Silent entry: exchange the device id (and Telegram initData when present)
   * for a session. Creates the account on first run — no sign-up screen.
   */
  guest: (deviceId: string, initData: string | null) =>
    request<AuthSuccess>("/auth/guest", {
      method: "POST",
      body: JSON.stringify({ deviceId, initData }),
    }),

  logout: () => request<{ ok: boolean }>("/auth/logout", { method: "POST" }),

  /** Irreversibly delete the signed-in account and all of its data. */
  deleteAccount: () => request<{ ok: boolean }>("/me", { method: "DELETE" }),

  getMe: () =>
    request<{
      user: {
        id: number;
        telegram_id: string;
        display_name: string;
        username?: string | null;
        /** The language last reported by a device (drives bot push copy). */
        language?: "en" | "fa";
        isAdmin?: boolean;
      };
      favorites: number;
      leagues?: number;
      authMode?: "session" | "telegram" | "dev";
    }>("/me"),

  getAdminStats: () =>
    request<{
      stats: { totalUsers: number; totalMatches: number; totalPredictions: number; totalFavorites: number };
    }>("/admin/stats"),

  adminSync: () => request<{ ok: boolean }>("/admin/sync", { method: "POST" }),

  adminBroadcast: (message: string) =>
    request<{ ok: boolean; sent: number }>("/admin/broadcast", {
      method: "POST",
      body: JSON.stringify({ message }),
    }),

  /** Rename the signed-in user's display name (Profile tab). */
  updateDisplayName: (displayName: string) =>
    request<{ ok: boolean; displayName: string }>("/me/display-name", {
      method: "POST",
      body: JSON.stringify({ displayName }),
    }),

  /**
   * Report the language this device is showing, so the bot's pushes can be
   * written in it (`server/messages.ts`). Fire-and-forget: a failed sync is
   * retried on the next app open, never surfaced to the user.
   */
  setLanguage: (language: "en" | "fa") =>
    request<{ ok: boolean; language: string }>("/me/language", {
      method: "POST",
      body: JSON.stringify({ language }),
    }),

  getTeams: (league?: string) => {
    const qs = league ? `?league=${encodeURIComponent(league)}` : "";
    return request<{ teams: ApiTeam[] }>(`/teams${qs}`).then((data) => {
      for (const t of data.teams) api.teamsCache.set(t.id, t);
      return data;
    });
  },

  getTeam: (id: string) =>
    request<{
      team: ApiTeam;
      seasonStats: ApiTeamSeasonStats | null;
      standing: { rank: number | null; played: number | null; points: number | null } | null;
      fixtures: ApiMatch[];
    }>(`/teams/${encodeURIComponent(id)}`),

  getRecentLineup: (teamId: string) =>
    request<{
      match: { id: string; kickoffAt: string; formation: string | null } | null;
      starters: LineupPlayer[];
      subs: LineupPlayer[];
      bench: LineupPlayer[];
    }>(`/teams/${encodeURIComponent(teamId)}/recent-lineup`),

  getTeamAvailability: (teamId: string) =>
    request<{ players: ApiTeamAvailability[]; stale?: boolean }>(
      `/teams/${encodeURIComponent(teamId)}/availability`,
    ),

  getLeaguePlayers: (league: string, sort: string, limit = 50) =>
    request<{
      season: string;
      sort: string;
      players: LeaguePlayerStatRow[];
    }>(`/leagues/${encodeURIComponent(league)}/players?sort=${encodeURIComponent(sort)}&limit=${limit}`),

  getLeagueTeamStats: (league: string) =>
    request<{ season: string; teams: LeagueTeamStatRow[] }>(`/leagues/${encodeURIComponent(league)}/teams`),

  /** League news feed, narrowed to one club when `teamId` is given. */
  getLeagueNews: (league: string, teamId?: string) => {
    const qs = teamId ? `?team=${encodeURIComponent(teamId)}` : "";
    return request<{ articles: NewsArticle[] }>(
      `/leagues/${encodeURIComponent(league)}/news${qs}`,
    );
  },

  getMatchPlayers: (matchId: string) =>
    request<{ players: Record<string, unknown>[] }>(`/matches/${matchId}/players`),

  getMatchTeamStats: (matchId: string) =>
    request<{ home: TeamStats | null; away: TeamStats | null }>(`/matches/${matchId}/team-stats`),

  getFavorites: () => request<{ favorites: ApiFavorite[] }>("/me/favorites"),

  addFavorite: (teamId: string) =>
    request<{ ok: boolean }>("/me/favorites", {
      method: "POST",
      body: JSON.stringify({ teamId }),
    }),

  removeFavorite: (teamId: string) =>
    request<{ ok: boolean }>(`/me/favorites/${encodeURIComponent(teamId)}`, {
      method: "DELETE",
    }),

  /** Set the anchor club (shown first everywhere). Must already be followed. */
  setAnchor: (teamId: string) =>
    request<{ ok: boolean }>(`/me/favorites/${encodeURIComponent(teamId)}/anchor`, {
      method: "PUT",
    }),

  getFollowedLeagues: () => request<{ leagues: ApiFollowedLeague[] }>("/me/leagues"),

  getReferral: () => request<{ referral: ApiReferral }>("/me/referral"),

  redeemReferral: (code: string) =>
    request<{ ok: boolean; rewarded: boolean; points: number }>("/me/referral/redeem", {
      method: "POST",
      body: JSON.stringify({ code }),
    }),

  followLeague: (league: string) =>
    request<{ ok: boolean }>("/me/leagues", {
      method: "POST",
      body: JSON.stringify({ league }),
    }),

  unfollowLeague: (league: string) =>
    request<{ ok: boolean }>(`/me/leagues/${encodeURIComponent(league)}`, {
      method: "DELETE",
    }),

  getLeaderboard: (board: "global" | `league/${string}` | `club/${string}`) =>
    request<{ board: ApiLeaderRow[]; you: ApiViewerRank | null }>(`/leaderboards/${board}`),

  /**
   * The matchday feed. With no args the server returns a relevance window
   * (live now + recent results + the next fortnight); pass `from`/`to`
   * (YYYY-MM-DD) for an explicit fixture range instead.
   */
  getMatches: (
    query: { league?: string; date?: string; from?: string; to?: string; limit?: number } = {},
  ) => {
    const qs = new URLSearchParams();
    if (query.league) qs.set("league", query.league);
    if (query.date) qs.set("date", query.date);
    if (query.from) qs.set("from", query.from);
    if (query.to) qs.set("to", query.to);
    if (query.limit) qs.set("limit", String(query.limit));
    const suffix = qs.toString() ? `?${qs}` : "";
    return request<{ matches: ApiMatch[] }>(`/matches${suffix}`);
  },

  getMatch: (id: string) => request<{ match: ApiMatch }>(`/matches/${id}`),

  getLineups: (id: string) =>
    request<{
      home: { formation: string | null };
      away: { formation: string | null };
      players: {
        player_id: string;
        team_id: string;
        full_name: string;
        short_name: string | null;
        position: string;
        jersey_number: number | null;
        /** ESPN headshot URL for the pitch/bench avatars; null for the players
         *  the feed carries no artwork for (the UI shows initials). */
        headshot_url: string | null;
        /** ESPN's granular role ("CD-L", "AM-R") — places a player on a side
         *  of their line. Null for feeds that don't publish one. */
        espn_position: string | null;
        /** ESPN's slot in the formation (1..11). */
        formation_place: string | null;
        started: number;
        subbed_in: number;
        subbed_out: number;
        minutes_played: number | null;
      }[];
    }>(`/matches/${id}/lineups`),

  getTimeline: (id: string) => request<{ events: ApiTimelineEvent[] }>(`/matches/${id}/timeline`),

  /** Last 5 meetings between this match's two clubs (ESPN seasonseries). */
  getH2H: (id: string) => request<MatchH2H>(`/matches/${id}/h2h`),

  /** Both clubs' last-5 results, oldest→newest. */
  getForm: (id: string) => request<MatchForm>(`/matches/${id}/form`),

  /** Articles from this match's ESPN summary news block. */
  getMatchNews: (id: string) => request<{ articles: NewsArticle[] }>(`/matches/${id}/news`),

  getSquad: (teamId: string) =>
    request<{
      season: string;
      players: ApiSquadPlayer[];
      coach: string | null;
    }>(`/teams/${encodeURIComponent(teamId)}/players`),

  /** Understat season xG/xA for one club — empty outside the big five. */
  getTeamUnderstat: (teamId: string, season?: number) =>
    request<ApiTeamUnderstat>(
      `/teams/${encodeURIComponent(teamId)}/understat${season ? `?season=${season}` : ""}`,
    ),

  getCompetitions: () => request<{ competitions: ApiCompetition[] }>("/competitions"),

  /**
   * Sync freshness from the server's sentinel (/api/health/sync): the feed's
   * "data as of" line is the SERVER's sync ledger, not the browser's fetch
   * time — the two disagree the moment the sync loop lags behind the UI.
   */
  getSyncHealth: () =>
    request<{
      latestLastSyncedAt: string | null;
      staleLive: number;
      liveCount: number;
      scheduledCount: number;
      finishedCount: number;
      perLeague: { league: string; lastSyncedAt: string | null }[];
      quietFollowedLeagues: string[];
      lastOkSyncAt: string | null;
      consecutiveFailures: number;
    }>("/health/sync"),

  getStandings: (league: string) =>
    request<{ season: string; standings: ApiStanding[] }>(`/standings/${encodeURIComponent(league)}`),

  getRatings: (matchId: string) =>
    request<{
      players: ApiPlayerRating[];
      minVotes: number;
      cardsUsed: number;
      cardsMax: number;
      /** Per-player histogram over crowd_ratings: 10 buckets, index 0 = rating 1.
       *  Absent key = that player has no votes yet. */
      distributions: Record<string, number[]>;
    }>(`/matches/${matchId}/ratings`),

  ratePlayer: (matchId: string, playerId: string, rating: number, comment?: string) =>
    request<{ ok: boolean; cardsUsed: number }>(`/matches/${matchId}/ratings`, {
      method: "POST",
      body: JSON.stringify({ playerId, rating, comment }),
    }),

  getComments: (matchId: string) => request<{ comments: ApiComment[] }>(`/matches/${matchId}/comments`),

  /** File a moderation report against a timeline or rating comment. */
  reportComment: (commentType: "timeline" | "rating", commentId: number, reason?: string) =>
    request<{ ok: boolean; duplicate?: boolean }>("/reports", {
      method: "POST",
      body: JSON.stringify({ commentType, commentId, reason }),
    }),

  /** Best-effort client error report (see lib/errorReporting.ts). */
  reportClientError: (payload: { message: string; stack?: string; url?: string; source?: string }) =>
    request<{ ok: boolean }>("/client-errors", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  addComment: (
    matchId: string,
    input: { text: string; eventId?: number; minuteDisplay?: string; mediaLink?: string },
  ) =>
    request<{ ok: boolean; id: number }>(`/matches/${matchId}/comments`, {
      method: "POST",
      body: JSON.stringify(input),
    }),

  getMyPredictions: (matchId: string) =>
    request<{
      predictions: ApiPrediction[];
      windows: Record<string, ApiPredictionWindow>;
      matchStatus: string | null;
      /** True once ESPN's official lineup is out — shot/watch/versus/sub wait on it. */
      lineupPublished: boolean;
    }>(`/matches/${matchId}/predictions`),

  submitPrediction: (matchId: string, mechanic: ApiPrediction["mechanic"], payload: unknown) =>
    request<{ ok: boolean; lockAt: string; opensAt: string | null }>(`/matches/${matchId}/predictions`, {
      method: "POST",
      body: JSON.stringify({ mechanic, payload }),
    }),

  getMyPredictionsAll: () => request<{ predictions: ApiPrediction[] }>("/me/predictions"),

  /** Favorite-club streak (scoring-rules.md §6): current run + next threshold. */
  getMyStreak: () => request<{ streak: ApiStreak }>("/me/streak"),

  /** Server-enforced push preferences (goal alerts etc.). Absent = all on. */
  getNotificationPrefs: () =>
    request<{ prefs: { goals: boolean; deadline: boolean; ratings: boolean } }>("/me/notification-prefs"),

  setNotificationPrefs: (prefs: { goals?: boolean; deadline?: boolean; ratings?: boolean }) =>
    request<{ ok: boolean; prefs: { goals: boolean; deadline: boolean; ratings: boolean } }>(
      "/me/notification-prefs",
      { method: "PUT", body: JSON.stringify(prefs) },
    ),
};
