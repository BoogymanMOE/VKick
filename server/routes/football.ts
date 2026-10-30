/**
 * Football-data reads: competitions, matches, match detail, commentary,
 * teams (+season line), squads, Understat, season stat
 * leaderboards, standings. Public routes stay public (web preview); the
 * Understat read keeps its requireUser gate. Behavior unchanged.
 */
import express, { type Response } from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { getDb, all, get } from "../db/index.js";
import { PROJECT_ROOT } from "../env.js";
import { filterOutBlockedTeams, isBlockedTeamId } from "../db/blockedTeams.js";

import { isAllowedLeague } from "../espn/catalog.js";
import { fetchLeagueNews } from "../espn/client.js";
import { competitionCatalogWithMatches } from "../espn/competitions.js";
import { TEAM_GROUP_SQL, TEAM_GROUP_PARAMS } from "../db/teamGroups.js";
import { foldForm, type FormMatchRow } from "../standings/form.js";
import { foldSplits } from "../standings/splits.js";
import { fillTranslations, withTranslation } from "../news/translate.js";
import { buildFeedQuery } from "../matches/feed.js";
import { settleStaleLive, settleStaleLiveAll, type LiveMatchRow } from "../matches/reconcile.js";
import { currentSeasonLabel } from "../scoring/ledger.js";
import { bad, requireUser } from "./shared.js";
// Sync freshness for the ops surface: the client shows "data as of <time>"
// rather than silently serving yesterday's football.
import { syncHealthSnapshot } from "../sync/sentinel.js";
import { syncMatchSummary } from "../sync/service.js";
import type { LeagueSlug } from "../espn/types.js";

const db = getDb();

/** Resolve a face URL for a player.
 * Priority: 1) bundled webp under public/headshots/<id>.webp
 * 2) the remote ESPN headshot_url the sync stored
 * 3) null so the UI falls back to initials.
 */
export function localHeadshotUrl(headshotUrl: string | null, playerId: string | number): string | null {
  const id = String(playerId);
  try {
    const headshotPath = path.join(PROJECT_ROOT, "public", "headshots", `${id}.webp`);
    if (existsSync(headshotPath)) {
      return `/headshots/${id}.webp`;
    }
  } catch {
    // access denied or not found
  }
  if (headshotUrl) return headshotUrl;
  return null;
}

export const matchesRouter = express.Router();

function safeArr(s: unknown): unknown[] {
  if (typeof s !== "string") return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function matchWithTeams(id: string): (LiveMatchRow & Record<string, unknown>) | undefined {
  return get<LiveMatchRow & Record<string, unknown>>(
    db,
    `SELECT m.*, 
       th.name AS home_name, th.short_name AS home_short, th.abbreviation AS home_abbr, th.color AS home_color, th.logo_url AS home_logo,
       ta.name AS away_name, ta.short_name AS away_short, ta.abbreviation AS away_abbr, ta.color AS away_color, ta.logo_url AS away_logo
     FROM matches m
     JOIN teams th ON th.id = m.home_team_id
     JOIN teams ta ON ta.id = m.away_team_id
     WHERE m.id = ?`,
    [id],
  );
}

/**
 * Shared guard for match-scoped reads (detail, commentary, lineups, timeline):
 * an unknown id 404s "not found"; a match from a league outside the five-league
 * catalog 404s "LEAGUE_NOT_SUPPORTED" so the client shows its "league no longer
 * supported" empty state instead of a page it is not supposed to see.
 */
function assertMatchAllowed(res: Response, matchId: string): boolean {
  const row = get<{ league: string }>(db, "SELECT league FROM matches WHERE id = ?", [matchId]);
  if (!row) {
    bad(res, "not found", 404);
    return false;
  }
  if (!isAllowedLeague(row.league)) {
    bad(res, "LEAGUE_NOT_SUPPORTED", 404);
    return false;
  }
  return true;
}

/* ------------------------------------------------------------ catalog */

/**
 * All competitions: the synced big five plus any cup/tournament the database
 * actually has a fixture for (Cups/Browse otherwise list nothing, and a match
 * could never say which competition it belonged to).
 */
matchesRouter.get("/api/competitions", (_req, res) => {
  res.json({ competitions: competitionCatalogWithMatches(db) });
});

/**
 * Sync freshness for the feed's "data as of" line (and any ops dashboard).
 * Public like the feed routes: it carries only ledger dates and league slugs.
 * The staleness judgement (is this old enough to surface?) belongs to the
 * client, which knows its own render context.
 */
matchesRouter.get("/api/health/sync", (_req, res) => {
  res.json(syncHealthSnapshot(db));
});

/* ------------------------------------------------------------ matches */

matchesRouter.get("/api/matches", (req, res) => {
  // Window semantics live in server/matches/feed.ts (tested against real SQL).
  const feed = buildFeedQuery({
    league: req.query.league ? String(req.query.league) : null,
    date: req.query.date ? String(req.query.date) : null,
    from: req.query.from ? String(req.query.from) : null,
    to: req.query.to ? String(req.query.to) : null,
    limit: req.query.limit ? String(req.query.limit) : null,
  });
  const rows = all<{ league: string; id: string; status: string; kickoff_at: string }>(
    db,
    `SELECT m.*,
       th.name AS home_name, th.short_name AS home_short, th.abbreviation AS home_abbr, th.color AS home_color, th.logo_url AS home_logo,
       ta.name AS away_name, ta.short_name AS away_short, ta.abbreviation AS away_abbr, ta.color AS away_color, ta.logo_url AS away_logo
      FROM matches m
      JOIN teams th ON th.id = m.home_team_id
      JOIN teams ta ON ta.id = m.away_team_id
      WHERE ${feed.where}
      ORDER BY ${feed.orderBy}
      LIMIT ?`,
    [...feed.params, feed.limit],
  );
  // The allow-list is enforced HERE, not only in SQL: the catalog is trimmed to
  // the five big leagues, and stale rows from older, wider syncs must never
  // reach the feed even if a filter regresses.
  //
  // settleStaleLiveAll is the read-time net for a row stuck live/halftime long
  // past kickoff (the sync loop repairs the row itself; this keeps the feed
  // honest even when it can't).
  res.json({ matches: settleStaleLiveAll(rows.filter((m) => isAllowedLeague(m.league))) });
});

matchesRouter.get("/api/matches/:id", (req, res) => {
  const matchId = String(req.params.id);
  if (!assertMatchAllowed(res, matchId)) return;
  const match = matchWithTeams(matchId);
  if (!match) return; // unreachable: assertMatchAllowed already 404'd
  res.json({ match: settleStaleLive(match) });
});

/** Full minute-by-minute commentary for one match (blow-by-blow tab). */
matchesRouter.get("/api/matches/:id/commentary", (req, res) => {
  const matchId = String(req.params.id);
  if (!assertMatchAllowed(res, matchId)) return;
  const lines = all(
    db,
    "SELECT sequence, minute_display, minute_seconds, text FROM match_commentary WHERE match_id = ? ORDER BY sequence ASC",
    [matchId],
  );
  res.json({ commentary: lines });
});

// All players who appeared in a given match (the match stats table).
matchesRouter.get("/api/matches/:id/players", (req, res) => {
  const matchId = String(req.params.id);
  if (!assertMatchAllowed(res, matchId)) return;
  const rows = all(
    db,
    `SELECT s.*, p.full_name, p.short_name, p.position, p.jersey_number, p.headshot_url,
            t.name AS team_name, t.short_name AS team_short
     FROM match_player_stats s
     JOIN players p ON p.id = s.player_id
     JOIN teams t ON t.id = s.team_id
     WHERE s.match_id = ?
     ORDER BY s.team_id, s.started DESC, s.minutes_played DESC`,
    [matchId],
  );
  res.json({ players: rows });
});

/**
 * Team-vs-team box score for the match detail comparison view, straight from
 * the per-match team stats synced off ESPN's summary boxscore
 * (match_team_stats). Goals ride on the matches row itself — the boxscore
 * table carries no goals column. A match whose stats have not synced yet
 * answers nulls, never 404: the match exists, the numbers just are not in.
 */
matchesRouter.get("/api/matches/:id/team-stats", (req, res) => {
  const matchId = String(req.params.id);
  if (!assertMatchAllowed(res, matchId)) return;
  const match = get<{
    home_team_id: string;
    away_team_id: string;
    home_score: number | null;
    away_score: number | null;
  }>(
    db,
    "SELECT home_team_id, away_team_id, home_score, away_score FROM matches WHERE id = ?",
    [matchId],
  );
  if (!match) return bad(res, "not found", 404);
  const rows = all<{ [key: string]: unknown }>(
    db,
    `SELECT team_id, possession_pct, shots, shots_on_target, corners,
            fouls, offsides, saves, pass_accuracy_pct
     FROM match_team_stats
     WHERE match_id = ?`,
    [matchId],
  );
  // Expected goals are Understat's, so they exist for the big five only. A null
  // xg is the honest answer for the other competitions, and the client explains
  // the gap instead of drawing an empty bar.
  const xgRows = all<{ team_id: string; xg: number | null }>(
    db,
    "SELECT team_id, xg FROM match_understat_stats WHERE match_id = ?",
    [matchId],
  );
  // The synced percentages arrive as REALs (86.4); the display contract is a
  // whole number. Counts stay as-is; anything missing rides out as 0.
  const pct = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null;
  const count = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const side = (teamId: string, goals: number | null) => {
    const row = rows.find((r) => r.team_id === teamId);
    if (!row) return null;
    const xgRow = xgRows.find((r) => r.team_id === teamId);
    return {
      possession_pct: pct(row.possession_pct),
      corners: count(row.corners),
      pass_accuracy_pct: pct(row.pass_accuracy_pct),
      shots: count(row.shots),
      shots_on_target: count(row.shots_on_target),
      fouls: count(row.fouls),
      offsides: count(row.offsides),
      saves: count(row.saves),
      goals,
      xg: typeof xgRow?.xg === "number" ? xgRow.xg : null,
    };
  };
  res.json({
    home: side(match.home_team_id, match.home_score),
    away: side(match.away_team_id, match.away_score),
  });
});

/* ------------------------------------------------------------ lineups */

interface MatchReadState {
  home_team_id: string;
  away_team_id: string;
  home_formation: string | null;
  away_formation: string | null;
  status: string;
  league: string;
}

function matchReadState(matchId: string): MatchReadState | undefined {
  return get<MatchReadState>(
    db,
    `SELECT home_team_id, away_team_id, home_formation, away_formation, status, league
     FROM matches WHERE id = ?`,
    [matchId],
  );
}

interface MatchPlayerRow extends Record<string, unknown> {
  player_id: string;
  team_id: string;
  headshot_url: string | null;
  availability_status: string | null;
  availability_reason: string | null;
  availability_expected_return: string | null;
}

function lineupRows(matchId: string): MatchPlayerRow[] {
  return all<MatchPlayerRow>(
    db,
    `SELECT s.*, p.full_name, p.short_name, p.position, p.jersey_number, p.headshot_url,
            p.espn_position, a.status AS availability_status, a.reason AS availability_reason,
            a.expected_return AS availability_expected_return
     FROM match_player_stats s JOIN players p ON p.id = s.player_id
     LEFT JOIN team_availability a ON a.team_id = s.team_id AND a.player_id = s.player_id
     WHERE s.match_id = ?
     ORDER BY s.started DESC, s.minutes_played DESC, p.jersey_number ASC`,
    [matchId],
  );
}

function timelineRows(matchId: string): Record<string, unknown>[] {
  return all(
    db,
    `SELECT e.*,
       (SELECT COUNT(*) FROM timeline_comments c WHERE c.event_id = e.id) AS comment_count
     FROM timeline_events e WHERE e.match_id = ?
     ORDER BY e.minute_seconds ASC`,
    [matchId],
  );
}

/**
 * A finished match can sit in the database with no player stats at all: the
 * sync's "recent finishers" rule only re-summarizes while 1h < hoursSinceSync
 * < 26h, so a match that ended while the box was down — or more than 26h ago —
 * never gets its summary applied, and the lineups/timeline tabs read "not out
 * yet" for football that has already been played.
 *
 * Both reads below repair that on demand: zero rows for a finished match buys
 * one summary fetch, and because the summary writes match_player_stats and
 * timeline_events itself, the next reader of that match gets the cached result.
 *
 * The cooldown keeps a public route from becoming a fetch amplifier: a fixture
 * ESPN has no summary for keeps coming back empty, and without it every single
 * request for that match would hit ESPN again. One attempt per match per 10
 * minutes, in-memory on purpose — this server is one process, the same rule the
 * sync's own reconcile backoff follows.
 */
const BACKFILL_RETRY_MS = 10 * 60_000;
const backfillAttempts = new Map<string, number>();

async function backfillSummary(league: string, matchId: string): Promise<void> {
  const retriedAt = backfillAttempts.get(matchId) ?? 0;
  if (retriedAt > Date.now()) return;
  backfillAttempts.set(matchId, Date.now() + BACKFILL_RETRY_MS);
  try {
    await syncMatchSummary(league as LeagueSlug, matchId);
  } catch (err) {
    // A dead ESPN fetch must never 500 a read: the caller falls through to the
    // empty state it would have shown before, exactly as if we had not tried.
    console.error(`[lineups] backfill ${matchId} FAILED:`, String(err));
  }
}

matchesRouter.get("/api/matches/:id/lineups", async (req, res) => {
  const matchId = String(req.params.id);
  if (!assertMatchAllowed(res, matchId)) return;
  let match = matchReadState(matchId);
  if (!match) return bad(res, "not found", 404);
  let rows = lineupRows(matchId);

  // Backfill: a finished match with no player stats means we missed the
  // post-final sync. Fetch the summary now, then re-read (the status may have
  // moved, and the summary is what writes the rows).
  if (rows.length === 0 && match.status === "finished") {
    await backfillSummary(match.league, matchId);
    match = matchReadState(matchId) ?? match;
    rows = lineupRows(matchId);
  }

  const players = rows.map((r) => ({
    ...r,
    avatarUrl: localHeadshotUrl(r.headshot_url, r.player_id),
  }));

  res.json({
    home: { formation: match.home_formation },
    away: { formation: match.away_formation },
    players,
  });
});

/* ------------------------------------------------------------ timeline */

matchesRouter.get("/api/matches/:id/timeline", async (req, res) => {
  const matchId = String(req.params.id);
  if (!assertMatchAllowed(res, matchId)) return;
  let events = timelineRows(matchId);

  // Same missed-summary repair as the lineups read above.
  if (events.length === 0) {
    const match = matchReadState(matchId);
    if (match?.status === "finished") {
      await backfillSummary(match.league, matchId);
      events = timelineRows(matchId);
    }
  }

  res.json({ events: events.map((e) => ({ ...e, participants: safeArr(e.participants) })) });
});

/* ------------------------------------------------------------ head-to-head */

interface H2HEventView {
  id: string;
  date: string;
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number | null;
  awayScore: number | null;
  winnerTeamId: string | null;
  status: string;
}

/**
 * Last 5 meetings between the two teams (summary `seasonseries[0]`), stored by
 * the summary sync. The same missed-summary repair as the lineups read: no row
 * yet buys one summary fetch (the shared 10-minute cooldown), then re-reads.
 * ESPN serves this block for upcoming fixtures too, so a match not yet played
 * answers just as well as a finished one.
 */
matchesRouter.get("/api/matches/:id/h2h", async (req, res) => {
  const matchId = String(req.params.id);
  if (!assertMatchAllowed(res, matchId)) return;
  const select =
    "SELECT summary, series_label, events_json FROM match_head_to_head WHERE match_id = ?";
  let row = get<{ summary: string | null; series_label: string | null; events_json: string }>(
    db,
    select,
    [matchId],
  );
  if (!row) {
    const match = matchReadState(matchId);
    if (match) await backfillSummary(match.league, matchId);
    row = get(db, select, [matchId]);
  }
  if (!row) return res.json({ summary: null, seriesLabel: null, events: [] });
  res.json({
    summary: row.summary,
    seriesLabel: row.series_label,
    events: safeArr(row.events_json) as unknown as H2HEventView[],
  });
});

/* ------------------------------------------------------------ form */

/**
 * Both teams' last 5 results (`lastFiveGames[0..1]`). ESPN's home side is
 * block 0; the form string reads oldest→newest and the games carry the club's
 * own scoreline. Same on-demand backfill as the reads above.
 */
matchesRouter.get("/api/matches/:id/form", async (req, res) => {
  const matchId = String(req.params.id);
  if (!assertMatchAllowed(res, matchId)) return;
  const select =
    "SELECT home_form, away_form, home_games_json, away_games_json FROM match_form WHERE match_id = ?";
  let row = get<{
    home_form: string | null;
    away_form: string | null;
    home_games_json: string | null;
    away_games_json: string | null;
  }>(db, select, [matchId]);
  if (!row) {
    const match = matchReadState(matchId);
    if (match) await backfillSummary(match.league, matchId);
    row = get(db, select, [matchId]);
  }
  if (!row) return res.json({ home: null, away: null });
  res.json({
    home: row.home_form ? { form: row.home_form, games: safeArr(row.home_games_json) } : null,
    away: row.away_form ? { form: row.away_form, games: safeArr(row.away_games_json) } : null,
  });
});

/* ------------------------------------------------------------ per-match news */

interface MatchNewsRow {
  article_id: string;
  headline: string;
  description: string | null;
  published: string | null;
  byline: string | null;
  image_url: string | null;
  web_url: string | null;
  team_ids_json: string;
}

/**
 * Articles from the summary `news` block — the same NewsArticle shape the
 * league-news route serves, so the TeamPage card renders these unchanged.
 * A match with no stored articles gets the same one-shot backfill.
 */
matchesRouter.get("/api/matches/:id/news", async (req, res) => {
  const matchId = String(req.params.id);
  if (!assertMatchAllowed(res, matchId)) return;
  const select = `SELECT article_id, headline, description, published, byline, image_url, web_url, team_ids_json
     FROM match_news WHERE match_id = ? ORDER BY published DESC`;
  let rows = all<MatchNewsRow>(db, select, [matchId]);
  if (rows.length === 0) {
    const match = matchReadState(matchId);
    if (match) await backfillSummary(match.league, matchId);
    rows = all<MatchNewsRow>(db, select, [matchId]);
  }
  const articles = rows.map((r) => ({
    id: r.article_id,
    headline: r.headline,
    description: r.description ?? "",
    published: r.published ?? "",
    byline: r.byline,
    imageUrl: r.image_url,
    webUrl: r.web_url,
    teamIds: safeArr(r.team_ids_json),
  }));
  const lang = req.query.lang ? String(req.query.lang) : null;
  fillTranslations(articles);
  res.json({ articles: withTranslation(articles, lang) });
});

/* ------------------------------------------------------------ teams */

/*
 * All teams, optionally filtered by league — feeds the My Teams picker from
 * real data.
 *
 * `group_key` is the picker tab each side belongs under, and it is NOT the same
 * thing as `league`: cup-only clubs and national teams have an empty league, so
 * the client would otherwise have no bucket to show them in. Domestic clubs
 * group under their own league slug; sides that turn up in an international
 * tournament are national teams ("international"); the rest are clubs we know
 * only through cup football ("other" — Ajax, Benfica, the European long tail).
 */
matchesRouter.get("/api/teams", (req, res) => {
  const league = req.query.league ? String(req.query.league) : null;
  // Blocklisted clubs are hidden everywhere the team list is read, so they can
  // never surface in the picker or a team-scoped screen.
  if (league) {
    const teams = all<{ id: string }>(
      db,
      "SELECT *, CASE WHEN league != '' THEN league ELSE 'other' END AS group_key FROM teams WHERE league = ? ORDER BY name ASC",
      [league],
    );
    res.json({ teams: filterOutBlockedTeams(teams) });
    return;
  }
  const rows = all<{ id: string; league: string }>(
    db,
    `SELECT t.*, ${TEAM_GROUP_SQL} AS group_key
     FROM teams t
     ORDER BY t.league ASC, t.name ASC`,
    [...TEAM_GROUP_PARAMS],
  );
  res.json({
    teams: filterOutBlockedTeams(rows).filter((team) => isAllowedLeague(team.league)),
  });
});

// A single team with its season stat line.
matchesRouter.get("/api/teams/:id", (req, res) => {
  const teamId = String(req.params.id);
  // A blocked club has no team page either — same 404 as any unknown id.
  if (isBlockedTeamId(teamId)) return bad(res, "not found", 404);
  const team = get<{ league: string }>(db, "SELECT * FROM teams WHERE id = ?", [teamId]);
  if (!team) return bad(res, "not found", 404);
  if (!isAllowedLeague(team.league)) return bad(res, "LEAGUE_NOT_SUPPORTED", 404);
  const seasonStats = get(
    db,
    `SELECT * FROM team_season_stats WHERE team_id = ? ORDER BY season DESC LIMIT 1`,
    [teamId],
  );
  // The info card's one-line summary needs the league-table position and points;
  // team_season_stats carries the record but no rank, so the row comes from
  // standings (latest season the club has a row in).
  const standing = get<{ rank: number | null; played: number | null; points: number | null }>(
    db,
    `SELECT s.rank, s.played, s.points FROM standings s
     WHERE s.team_id = ? AND s.season = (SELECT MAX(s2.season) FROM standings s2 WHERE s2.team_id = ?)
     LIMIT 1`,
    [teamId, teamId],
  );
  // Results (newest first) then upcoming fixtures (soonest 7).
  const played = all(
    db,
    `SELECT m.*, th.short_name AS home_short, ta.short_name AS away_short
     FROM matches m JOIN teams th ON th.id = m.home_team_id JOIN teams ta ON ta.id = m.away_team_id
     WHERE (m.home_team_id = ? OR m.away_team_id = ?) AND m.status = 'finished'
     ORDER BY m.kickoff_at DESC LIMIT 7`,
    [teamId, teamId],
  );
  const upcoming = all(
    db,
    `SELECT m.*, th.short_name AS home_short, ta.short_name AS away_short
     FROM matches m JOIN teams th ON th.id = m.home_team_id JOIN teams ta ON ta.id = m.away_team_id
     WHERE (m.home_team_id = ? OR m.away_team_id = ?) AND m.status != 'finished'
     ORDER BY m.kickoff_at ASC LIMIT 7`,
    [teamId, teamId],
  );
  // Same flat shape the client already consumes; newest results first,
  // then upcoming in chronological order.
  const fixtures = [...played, ...upcoming];
  res.json({ team, seasonStats: seasonStats ?? null, standing: standing ?? null, fixtures });
});

/** Recent completed-match XI and used substitutes for a club. */
matchesRouter.get("/api/teams/:id/recent-lineup", async (req, res) => {
  const teamId = String(req.params.id);
  if (isBlockedTeamId(teamId)) return bad(res, "not found", 404);
  const team = get<{ league: string }>(db, "SELECT league FROM teams WHERE id = ?", [teamId]);
  if (!team) return bad(res, "not found", 404);
  if (!isAllowedLeague(team.league)) return bad(res, "LEAGUE_NOT_SUPPORTED", 404);

  const matchQuery = `SELECT id, league, home_team_id, away_team_id, home_formation, away_formation, kickoff_at
    FROM matches
    WHERE (home_team_id = ? OR away_team_id = ?) AND status = 'finished'
    ORDER BY kickoff_at DESC LIMIT 1`;
  let match = get<{
    id: string;
    league: string;
    home_team_id: string;
    away_team_id: string;
    home_formation: string | null;
    away_formation: string | null;
    kickoff_at: string;
  }>(db, matchQuery, [teamId, teamId]);
  if (!match) return res.json({ match: null, starters: [], subs: [] });

  let rows = lineupRows(match.id);
  if (rows.length === 0) {
    await backfillSummary(match.league, match.id);
    match = get(db, matchQuery, [teamId, teamId]) ?? match;
    rows = lineupRows(match.id);
  }

  const isHome = match.home_team_id === teamId;
  const formation = isHome ? match.home_formation : match.away_formation;
  const players = rows
    .filter((row) => row.team_id === teamId)
    .map((row) => ({
      id: String(row.player_id),
      name: String(row.full_name),
      position: String(row.position ?? "MID"),
      number: typeof row.jersey_number === "number" ? row.jersey_number : 0,
      headshot: typeof row.headshot_url === "string" ? row.headshot_url : null,
      avatarUrl: localHeadshotUrl(
        typeof row.headshot_url === "string" ? row.headshot_url : null,
        row.player_id as string | number,
      ),
      espnPosition: typeof row.espn_position === "string" ? row.espn_position : null,
      started: Number(row.started) === 1,
      availability: row.availability_status
        ? {
            status: row.availability_status as "injured" | "suspended" | "doubtful",
            reason: row.availability_reason,
            expected_return: row.availability_expected_return,
          }
        : null,
    }));
  // Split into starters, subs, and bench (all non-starters are on the bench)
  const starters = players.filter((player) => player.started);
  const subs = players.filter((player) => !player.started);
  const bench = players.filter((player) => !player.started);

  res.json({
    match: { id: match.id, kickoffAt: match.kickoff_at, formation },
    starters,
    subs,
    bench,
    availability: starters.map((p) => p.availability).filter(Boolean),
  });
});

/** Full squad for one club, position-grouped and shirt-number ordered. */
matchesRouter.get("/api/teams/:id/players", (req, res) => {
  const teamId = String(req.params.id);
  const team = get<{ league: string }>(db, "SELECT league FROM teams WHERE id = ?", [teamId]);
  if (!team) return bad(res, "not found", 404);
  if (!isAllowedLeague(team.league)) return bad(res, "LEAGUE_NOT_SUPPORTED", 404);
  const seasonRow = get<{ season: string }>(
    db,
    "SELECT season FROM player_season_stats WHERE league = ? ORDER BY season DESC LIMIT 1",
    [team.league],
  );
  const season = seasonRow?.season ?? currentSeasonLabel();
  const rows = all(
    db,
    `SELECT p.id, p.full_name, p.short_name, p.position, p.espn_position, p.jersey_number, p.headshot_url,
            s.appearances, s.goals AS season_goals, s.assists AS season_assists
     FROM players p
     LEFT JOIN player_season_stats s ON s.player_id = p.id AND s.league = ? AND s.season = ?
     WHERE p.team_id = ? AND p.active = 1
     ORDER BY CASE p.position WHEN 'GK' THEN 0 WHEN 'DEF' THEN 1 WHEN 'MID' THEN 2 ELSE 3 END,
              p.jersey_number ASC, p.full_name ASC`,
    [team.league, season, teamId],
  );
  const coach = get<{ name: string }>(db, "SELECT name FROM team_coaches WHERE team_id = ?", [teamId]);
  res.json({
    season,
    players: rows.map((row) => ({
      ...row,
      avatar_url: localHeadshotUrl(row.headshot_url as string | null, row.id as string | number),
    })),
    coach: coach?.name ?? null,
  });
});

/** Availability for one team (injured/suspended/doubtful), cached 30 min; empty result also cached. */
type AvailabilityCacheEntry = {
  players: { player_id: string; status: "injured" | "suspended" | "doubtful"; reason: string | null; expected_return: string | null }[];
  stale: boolean;
  ts: number;
};

const availabilityCache = new Map<string, AvailabilityCacheEntry>();

matchesRouter.get("/api/teams/:id/availability", async (req, res) => {
  const teamId = String(req.params.id);
  if (isBlockedTeamId(teamId)) return bad(res, "not found", 404);
  const team = get<{ league: string }>(db, "SELECT league FROM teams WHERE id = ?", [teamId]);
  if (!team) return bad(res, "not found", 404);
  if (!isAllowedLeague(team.league)) return bad(res, "LEAGUE_NOT_SUPPORTED", 404);

  // Check cache first (simple in-memory store shared across requests in one process)
  const cacheKey = `avail:${teamId}`;
  const cached = availabilityCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < 30 * 60_000) {
    return res.json({ players: cached.players, stale: cached.stale });
  }

  // Try to read from DB; if no rows exist, treat as empty (cached too).
  const rows = all<{ status: string; reason: string | null; expected_return: string | null }>(
    db,
    `SELECT status, reason, expected_return FROM team_availability WHERE team_id = ?`,
    [teamId],
  );
  const players = rows.map((r) => ({
    player_id: r.status, // reuse column names from DB for minimal payload
    status: r.status as "injured" | "suspended" | "doubtful",
    reason: r.reason,
    expected_return: r.expected_return,
  }));
  const hasData = rows.length > 0;

  // Cache the result (even if empty) for 30 minutes
  availabilityCache.set(cacheKey, { players, stale: !hasData, ts: Date.now() });

  res.json({ players, stale: !hasData });
});

/** Understat xG/xA data for a team (season-aggregated). */
matchesRouter.get("/api/teams/:id/understat", requireUser, (req, res) => {
  const teamId = String(req.params.id);
  const team = get<{ league: string }>(db, "SELECT league FROM teams WHERE id = ?", [teamId]);
  if (!team) return bad(res, "not found", 404);
  if (!isAllowedLeague(team.league)) return bad(res, "LEAGUE_NOT_SUPPORTED", 404);
  const season = Number(req.query.season ?? 2026);

  const players = all(
    db,
    `SELECT p.id, p.full_name AS name, p.position, p.jersey_number AS jersey, p.headshot_url AS headshot,
           u.xg, u.xa, u.xg90, u.xa90, u.sh90, u.kp90,
           u.apps, u.minutes, u.goals, u.assists
    FROM player_understat_stats u
    JOIN players p ON p.id = u.player_id
    WHERE u.team_id = ? AND u.season = ?
    ORDER BY u.xg DESC`,
    [teamId, season],
  );

  const teamStats = get(
    db,
    `SELECT xg, xga, xpts, ppda, deep FROM team_understat_stats
     WHERE team_id = ? AND season = ?`,
    [teamId, season],
  );

  const situations = all(
    db,
    `SELECT situation, shots, goals, shots_against, goals_against, xg, xga
    FROM team_shot_situations WHERE team_id = ? AND season = ?
    ORDER BY xg DESC`,
    [teamId, season],
  );

  res.json({ players, teamStats, situations });
});

/* ------------------------------------------------------------ season stat boards */

// Season player stats per league — sortable leaderboard (the "most assists and
// goals and… everything" tables).
matchesRouter.get("/api/leagues/:league/players", (req, res) => {
  const league = String(req.params.league);
  if (!isAllowedLeague(league)) return bad(res, "LEAGUE_NOT_SUPPORTED", 404);
  const sort = String(req.query.sort ?? "goals");
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "50"), 10) || 50));
  const sortable = new Set([
    "goals",
    "assists",
    "appearances",
    "minutes",
    "shots",
    "shots_on_target",
    "yellow_cards",
    "red_cards",
    "saves",
    "goals_conceded",
    "fouls_committed",
    "own_goals",
    "stat_score_total",
    "stat_score_avg",
  ]);
  const col = sortable.has(sort) ? sort : "goals";
  const season = getSeasonKeyDb(league);
  const rows = all(
    db,
    `SELECT s.*, p.full_name, p.short_name, p.position, p.headshot_url, p.jersey_number,
            t.name AS team_name, t.short_name AS team_short, t.color AS team_color, t.logo_url AS team_logo
     FROM player_season_stats s
     JOIN players p ON p.id = s.player_id
     JOIN teams t ON t.id = s.team_id
     WHERE s.league = ? AND s.season = ?
     ORDER BY s.${col} DESC, s.goals DESC, s.assists DESC
     LIMIT ?`,
    [league, season, limit],
  );
  res.json({
    season,
    sort: col,
    players: rows.map((row) => ({
      ...row,
      avatar_url: localHeadshotUrl(row.headshot_url as string | null, row.player_id as string | number),
    })),
  });
});

// Season team stats table per league.
matchesRouter.get("/api/leagues/:league/teams", (req, res) => {
  const league = String(req.params.league);
  if (!isAllowedLeague(league)) return bad(res, "LEAGUE_NOT_SUPPORTED", 404);
  const season = getSeasonKeyDb(league);
  const rows = all(
    db,
    `SELECT s.*, t.name, t.short_name, t.abbreviation, t.color, t.logo_url
     FROM team_season_stats s JOIN teams t ON t.id = s.team_id
     WHERE s.league = ? AND s.season = ?
     ORDER BY s.goals_for DESC`,
    [league, season],
  );
  res.json({ season, teams: rows });
});

/* ------------------------------------------------------------ league news */

interface NewsArticle {
  id: string;
  headline: string;
  description: string;
  /** ISO. */
  published: string;
  byline: string | null;
  imageUrl: string | null;
  webUrl: string | null;
  /** ESPN club ids the article is tagged with — the ids the app already uses. */
  teamIds: string[];
}

/**
 * One league's news for one minute. A club page asks for its club's slice of
 * the league feed, so without this cache twenty clubs in one league would mean
 * twenty identical ESPN calls for the same six articles.
 */
const newsCache = new Map<string, { at: number; payload: NewsArticle[] }>();
const NEWS_TTL_MS = 60_000;

/**
 * ESPN article → our shape. Every field is optional at the edge, and the feed
 * mixes in non-story cards, so anything without an id is dropped rather than
 * rendered as an empty row.
 */
function toNewsArticle(raw: unknown): NewsArticle | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as {
    id?: unknown;
    headline?: unknown;
    description?: unknown;
    published?: unknown;
    byline?: unknown;
    images?: unknown;
    links?: { web?: { href?: unknown } };
    categories?: unknown;
  };
  if (a.id == null || String(a.id) === "") return null;

  const images = Array.isArray(a.images) ? a.images : [];
  // The "header" crop is the wide one; a logo or a square thumb letterboxes.
  const image =
    images.find((i) => (i as { type?: unknown } | null)?.type === "header") ?? images[0];
  const imageUrl = (image as { url?: unknown } | undefined)?.url;

  const categories = Array.isArray(a.categories) ? a.categories : [];
  const teamIds = categories.flatMap((c) => {
    const cat = c as { type?: unknown; team?: { id?: unknown } } | null;
    return cat?.type === "team" && cat.team?.id != null ? [String(cat.team.id)] : [];
  });

  return {
    id: String(a.id),
    headline: typeof a.headline === "string" ? a.headline : "",
    description: typeof a.description === "string" ? a.description : "",
    published: typeof a.published === "string" ? a.published : "",
    byline: typeof a.byline === "string" && a.byline ? a.byline : null,
    imageUrl: typeof imageUrl === "string" && imageUrl ? imageUrl : null,
    webUrl: typeof a.links?.web?.href === "string" ? a.links.web.href : null,
    teamIds,
  };
}

async function getLeagueNews(league: LeagueSlug): Promise<NewsArticle[]> {
  const cached = newsCache.get(league);
  if (cached && Date.now() - cached.at < NEWS_TTL_MS) return cached.payload;
  const raw = (await fetchLeagueNews(league)) as { articles?: unknown };
  const payload = (Array.isArray(raw.articles) ? raw.articles : [])
    .map(toNewsArticle)
    .filter((a): a is NewsArticle => a != null);
  newsCache.set(league, { at: Date.now(), payload });
  return payload;
}

/**
 * League news, optionally narrowed to one club. The team-scoped ESPN path
 * (/teams/{id}/news) returns nothing for soccer — ESPN only populates it for
 * US sports — so a league feed plus a team.id filter is the only route to
 * per-club news. Public: it is the same content ESPN serves to anyone.
 */
matchesRouter.get("/api/leagues/:league/news", (req, res) => {
  const league = String(req.params.league);
  if (!isAllowedLeague(league)) return bad(res, "LEAGUE_NOT_SUPPORTED", 404);
  const team = req.query.team ? String(req.query.team) : null;
  const lang = req.query.lang ? String(req.query.lang) : null;
  getLeagueNews(league as LeagueSlug)
    .then((articles) => {
      const scoped = team ? articles.filter((a) => a.teamIds.includes(team)) : articles;
      // Answer in the reader's language where a translation is cached, and fill
      // the rest in the background rather than making the tab wait on a model.
      fillTranslations(scoped);
      res.json({ articles: withTranslation(scoped, lang) });
    })
    .catch((err) => {
      // News is decoration on a page that is otherwise complete: an ESPN
      // outage should empty the tab, not 500 the club page.
      console.error(`[news] ${league} FAILED:`, String(err));
      res.json({ articles: [] });
    });
});

function getSeasonKeyDb(league: string): string {
  const row = get<{ season: string }>(
    db,
    "SELECT season FROM standings WHERE league = ? ORDER BY season DESC LIMIT 1",
    [league],
  );
  if (row) return row.season;
  const now = new Date();
  const y = now.getUTCFullYear();
  const start = now.getUTCMonth() >= 7 ? y : y - 1;
  return `${start}-${String(start + 1).slice(2)}`;
}

/* ------------------------------------------------------------ standings */

matchesRouter.get("/api/standings/:league", (req, res) => {
  const league = String(req.params.league);
  if (!isAllowedLeague(league)) return bad(res, "LEAGUE_NOT_SUPPORTED", 404);
  const season = req.query.season ? String(req.query.season) : latestSeason(league);
  const rows = all(
    db,
    `SELECT s.*, t.name, t.short_name, t.abbreviation, t.color, t.logo_url,
            u.xpts AS xpts, u.xg AS xg, u.xga AS xga
     FROM standings s JOIN teams t ON t.id = s.team_id
     LEFT JOIN team_understat_stats u
       ON u.team_id = s.team_id
      AND u.league = s.league
      AND u.season = (SELECT MAX(season) FROM team_understat_stats WHERE team_id = s.team_id)
     WHERE s.league = ? AND s.season = ?
     ORDER BY s.rank ASC`,
    [league, season],
  );
  const formRows = all(
    db,
    `SELECT home_team_id, away_team_id, home_score, away_score
     FROM matches
     WHERE league = ? AND status = 'finished'
       AND home_score IS NOT NULL AND away_score IS NOT NULL
     ORDER BY kickoff_at DESC`,
    [league],
  ) as FormMatchRow[];
  const form = foldForm(formRows);
  // Home and away records come out of the same finished matches, so the table's
  // split view can never contradict the form strip beside it.
  const splits = foldSplits(formRows);
  // Leading scorers: our own season stat table, which the ESPN team-stats sync
  // fills for the big five. A competition with no stat rows returns an empty
  // list and the client simply does not draw the card.
  const scorers = all<{
    player_id: string;
    full_name: string;
    short_name: string | null;
    headshot_url: string | null;
    goals: number;
    assists: number;
    team_id: string;
    team_name: string;
    team_short: string | null;
    team_color: string | null;
    team_logo: string | null;
  }>(
    db,
    `SELECT s.player_id, p.full_name, p.short_name, p.headshot_url,
            s.goals, s.assists, s.team_id, t.name AS team_name, t.short_name AS team_short,
            t.color AS team_color, t.logo_url AS team_logo
     FROM player_season_stats s
     JOIN players p ON p.id = s.player_id
     JOIN teams t ON t.id = s.team_id
     WHERE s.league = ? AND s.season = ? AND s.goals > 0
     ORDER BY s.goals DESC, s.assists DESC, p.full_name ASC
     LIMIT 5`,
    [league, season],
  ).map((row) => ({
    ...row,
    avatar_url: localHeadshotUrl(row.headshot_url, row.player_id),
  }));
  res.json({
    season,
    standings: rows.map((row) => {
      const id = (row as { team_id: string }).team_id;
      return {
        ...row,
        form: form[id] ?? null,
        splits: splits[id] ?? null,
      };
    }),
    scorers,
  });
});

function latestSeason(league: string): string {
  const row = get<{ season: string }>(
    db,
    "SELECT season FROM standings WHERE league = ? ORDER BY season DESC LIMIT 1",
    [league],
  );
  return row?.season ?? currentSeasonLabel();
}

export { safeArr };
