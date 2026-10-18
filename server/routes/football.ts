/**
 * Football-data reads: competitions, matches, match detail, commentary,
 * teams (+season line), squads, Understat, season stat
 * leaderboards, standings. Public routes stay public (web preview); the
 * Understat read keeps its requireUser gate. Behavior unchanged.
 */
import express from "express";
import { getDb, all, get } from "../db/index.js";
import { filterOutBlockedTeams, isBlockedTeamId } from "../db/blockedTeams.js";

import { competitionCatalog } from "../espn/catalog.js";
import { TEAM_GROUP_SQL, TEAM_GROUP_PARAMS } from "../db/teamGroups.js";
import { foldForm, type FormMatchRow } from "../standings/form.js";
import { buildFeedQuery } from "../matches/feed.js";
import { currentSeasonLabel } from "../scoring/ledger.js";
import { bad, requireUser } from "./shared.js";
// Sync freshness for the ops surface: the client shows "data as of <time>"
// rather than silently serving yesterday's football.
import { syncHealthSnapshot } from "../sync/sentinel.js";

const db = getDb();

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

function matchWithTeams(id: string): unknown {
  return get(
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

/* ------------------------------------------------------------ catalog */

/** All competitions: synced ones plus extra ESPN ones marked coming-soon. */
matchesRouter.get("/api/competitions", (_req, res) => {
  res.json({ competitions: competitionCatalog() });
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
  const rows = all(
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
  res.json({ matches: rows });
});

matchesRouter.get("/api/matches/:id", (req, res) => {
  const match = matchWithTeams(String(req.params.id));
  if (!match) return bad(res, "not found", 404);
  res.json({ match });
});

/** Full minute-by-minute commentary for one match (blow-by-blow tab). */
matchesRouter.get("/api/matches/:id/commentary", (req, res) => {
  const lines = all(
    db,
    "SELECT sequence, minute_display, minute_seconds, text FROM match_commentary WHERE match_id = ? ORDER BY sequence ASC",
    [String(req.params.id)],
  );
  res.json({ commentary: lines });
});

// All players who appeared in a given match (the match stats table).
matchesRouter.get("/api/matches/:id/players", (req, res) => {
  const matchId = String(req.params.id);
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

matchesRouter.get("/api/matches/:id/lineups", (req, res) => {
  const matchId = String(req.params.id);
  const match = get<{
    home_team_id: string;
    away_team_id: string;
    home_formation: string | null;
    away_formation: string | null;
    status: string;
  }>(
    db,
    "SELECT home_team_id, away_team_id, home_formation, away_formation, status FROM matches WHERE id = ?",
    [matchId],
  );
  if (!match) return bad(res, "not found", 404);
  const rows = all(
    db,
    `SELECT s.*, p.full_name, p.short_name, p.position, p.jersey_number, p.headshot_url,
            p.espn_position
     FROM match_player_stats s JOIN players p ON p.id = s.player_id
     WHERE s.match_id = ?
     ORDER BY s.started DESC, s.minutes_played DESC, p.jersey_number ASC`,
    [matchId],
  );
  res.json({
    home: { formation: match.home_formation },
    away: { formation: match.away_formation },
    players: rows,
  });
});

/* ------------------------------------------------------------ timeline */

matchesRouter.get("/api/matches/:id/timeline", (req, res) => {
  const matchId = String(req.params.id);
  const events = all(
    db,
    `SELECT e.*,
       (SELECT COUNT(*) FROM timeline_comments c WHERE c.event_id = e.id) AS comment_count
     FROM timeline_events e WHERE e.match_id = ?
     ORDER BY e.minute_seconds ASC`,
    [matchId],
  );
  res.json({ events: events.map((e) => ({ ...e, participants: safeArr(e.participants) })) });
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
  const rows = all<{ id: string }>(
    db,
    `SELECT t.*, ${TEAM_GROUP_SQL} AS group_key
     FROM teams t
     ORDER BY t.league ASC, t.name ASC`,
    [...TEAM_GROUP_PARAMS],
  );
  res.json({ teams: filterOutBlockedTeams(rows) });
});

// A single team with its season stat line.
matchesRouter.get("/api/teams/:id", (req, res) => {
  const teamId = String(req.params.id);
  // A blocked club has no team page either — same 404 as any unknown id.
  if (isBlockedTeamId(teamId)) return bad(res, "not found", 404);
  const team = get(db, "SELECT * FROM teams WHERE id = ?", [teamId]);
  if (!team) return bad(res, "not found", 404);
  const seasonStats = get(
    db,
    `SELECT * FROM team_season_stats WHERE team_id = ? ORDER BY season DESC LIMIT 1`,
    [teamId],
  );
  // Results (latest 7) then upcoming fixtures (soonest 7). One DESC query
  // filled the list with the whole rest-of-season backlog instead of the
  // games nearest the club's next kickoff.
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
  const fixtures = [...played.slice().reverse(), ...upcoming];
  res.json({ team, seasonStats: seasonStats ?? null, fixtures });
});

/** Full squad for one club, position-grouped and shirt-number ordered. */
matchesRouter.get("/api/teams/:id/players", (req, res) => {
  const teamId = String(req.params.id);
  const team = get<{ league: string }>(db, "SELECT league FROM teams WHERE id = ?", [teamId]);
  if (!team) return bad(res, "not found", 404);
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
  res.json({ season, players: rows, coach: coach?.name ?? null });
});

/** Understat xG/xA data for a team (season-aggregated). */
matchesRouter.get("/api/teams/:id/understat", requireUser, (req, res) => {
  const teamId = String(req.params.id);
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
  res.json({ season, sort: col, players: rows });
});

// Season team stats table per league.
matchesRouter.get("/api/leagues/:league/teams", (req, res) => {
  const league = String(req.params.league);
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
  res.json({
    season,
    standings: rows.map((row) => ({
      ...row,
      form: form[(row as { team_id: string }).team_id] ?? null,
    })),
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
