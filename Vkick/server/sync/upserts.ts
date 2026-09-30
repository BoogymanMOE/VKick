import { run, get, upsert, upsertCoalesce, tx, type DB, type BindValue, getDb } from "../db/index.js";
import { isCup } from "../espn/types.js";
import {
  normalizeScoreboard,
  normalizeSummaryMatch,
  normalizeRosters,
  normalizeTimeline,
  normalizeStandings,
  normalizeSummaryTeams,
  normalizeCommentary,
  normalizeRosterPlayers,
  normalizeCoach,
} from "../espn/normalize.js";
import { statScore } from "../scoring/statScore.js";
import {
  normalizeTeamStats,
  applyTeamStats,
  recomputeSeasonStats,
  recomputeSeasonTeamStats,
  getSeasonKey,
} from "./teamStats.js";
import type { NormMatch, NormTeam } from "../espn/types.js";

export interface GoalAlert {
  matchId: string;
  scoringTeamId: string;
  scorerName: string;
  minute: string;
  homeScore: number;
  awayScore: number;
}

/**
 * Team row for upsert, with cup protection: `teams.league` must always hold
 * the club's DOMESTIC league (the favorites rule depends on it), so a row
 * synced from a cup competition simply omits the league column.
 */
function teamRow(t: NormTeam, fallbackLeague: string): Record<string, BindValue> {
  const row: Record<string, BindValue> = { ...t };
  const league = t.league || fallbackLeague;
  if (!league || isCup(league)) {
    // Cup-synced teams: insert '' when brand new (their domestic league fills
    // in on the next domestic sync); never overwrite on update (see skipEmpty).
    row.league = "";
  } else {
    row.league = league;
  }
  return row;
}

/** Upsert normalized teams + matches from a scoreboard payload. */
export function applyScoreboard(db: DB, json: any, league: string): void {
  const { teams, matches } = normalizeScoreboard(json, league);
  tx(db, () => {
    for (const t of teams) {
      upsertCoalesce(
        db,
        "teams",
        teamRow(t, league),
        ["id"],
        ["short_name", "abbreviation", "logo_url", "color"],
        // Cup scoreboards must not blank out a club's domestic league.
        ["league"],
      );
    }
    for (const m of matches) {
      const existing = get<{ status: string; home_score: number | null; away_score: number | null }>(
        db,
        "SELECT status, home_score, away_score FROM matches WHERE id = ?",
        [m.id],
      );
      // Never regress a finished match to scheduled, or a halftime match to
      // scheduled (ESPN can drop events from the scoreboard window once they
      // age out; and a stale pre-match row must not un-break the HT window).
      const status =
        (existing?.status === "finished" || existing?.status === "halftime") && m.status === "scheduled"
          ? existing.status
          : m.status;
      upsert(
        db,
        "matches",
        {
          id: m.id,
          league: m.league,
          home_team_id: m.home_team_id,
          away_team_id: m.away_team_id,
          kickoff_at: m.kickoff_at,
          status,
          home_score: m.home_score,
          away_score: m.away_score,
          minute_display: m.minute_display,
          espn_season: m.espn_season,
          round: m.round,
        },
        ["id"],
      );
    }
  });
}

export interface ApplySummaryResult {
  match: NormMatch;
  goals: GoalAlert[]; // goals newly seen in this sync
}

/** Upsert a summary payload: match state, teams, player stats, timeline. */
export function applySummary(db: DB, json: any, league: string): ApplySummaryResult {
  const { home, away } = normalizeSummaryTeams(json);
  const match = normalizeSummaryMatch(json);
  if (!match.id) return { match, goals: [] };

  const prev = get<{
    home_score: number | null;
    away_score: number | null;
    status: string;
    last_synced_at: string | null;
  }>(db, "SELECT home_score, away_score, status, last_synced_at FROM matches WHERE id = ?", [match.id]);

  const goals: GoalAlert[] = [];

  tx(db, () => {
    for (const t of [home, away]) {
      if (t)
        upsertCoalesce(
          db,
          "teams",
          teamRow(t, league),
          ["id"],
          ["short_name", "abbreviation", "logo_url", "color"],
          ["league"],
        );
    }

    upsert(
      db,
      "matches",
      {
        id: match.id,
        league: match.league || league,
        home_team_id: match.home_team_id,
        away_team_id: match.away_team_id,
        kickoff_at: match.kickoff_at,
        status: match.status,
        home_score: match.home_score,
        away_score: match.away_score,
        minute_display: match.minute_display,
        round: match.round,
        home_formation: match.home_formation,
        away_formation: match.away_formation,
        espn_season: match.espn_season,
        last_synced_at: new Date().toISOString(),
      },
      ["id"],
    );

    // Player stats + stat score
    const { players, stats } = normalizeRosters(json);
    for (const p of players) upsert(db, "players", { ...p }, ["id"]);

    const conceded: Record<string, number> = {};
    if (match.home_score !== null && match.away_score !== null) {
      conceded[match.home_team_id] = match.away_score;
      conceded[match.away_team_id] = match.home_score;
    }

    for (const s of stats) {
      const player = players.find((p) => p.id === s.player_id);
      const pos = (player?.position ?? "MID") as "GK" | "DEF" | "MID" | "FWD";
      const teamConceded = conceded[s.team_id] ?? 0;
      const scored =
        match.status === "finished"
          ? statScore(
              {
                minutes_played: s.minutes_played,
                goals: s.goals,
                assists: s.assists,
                yellow_cards: s.yellow_cards,
                red_cards: s.red_cards,
                own_goals: s.own_goals,
                saves: s.saves,
                goals_conceded: s.goals_conceded,
              },
              pos,
              teamConceded,
            )
          : null;
      upsert(
        db,
        "match_player_stats",
        {
          match_id: match.id,
          player_id: s.player_id,
          team_id: s.team_id,
          started: s.started ? 1 : 0,
          subbed_in: s.subbed_in ? 1 : 0,
          subbed_out: s.subbed_out ? 1 : 0,
          formation_place: s.formation_place,
          minutes_played: s.minutes_played,
          goals: s.goals,
          assists: s.assists,
          shots: s.shots,
          shots_on_target: s.shots_on_target,
          yellow_cards: s.yellow_cards,
          red_cards: s.red_cards,
          saves: s.saves,
          goals_conceded: s.goals_conceded,
          fouls_committed: s.fouls_committed,
          offsides: s.offsides,
          own_goals: s.own_goals,
          stat_score: scored?.total ?? null,
          stat_breakdown: scored ? JSON.stringify(scored.breakdown) : null,
        },
        ["match_id", "player_id"],
      );
    }

    // Timeline
    for (const ev of normalizeTimeline(json)) {
      if (ev.espn_event_key) {
        upsert(
          db,
          "timeline_events",
          {
            espn_event_key: ev.espn_event_key,
            match_id: match.id,
            minute_display: ev.minute_display,
            minute_seconds: ev.minute_seconds,
            type: ev.type,
            team_id: ev.team_id,
            description: ev.description,
            participants: ev.participants,
            field_x: ev.field_x,
            field_y: ev.field_y,
            goal_y: ev.goal_y,
          },
          ["match_id", "espn_event_key"],
        );
      }
    }

    // Full commentary track (replay companion for finished matches).
    for (const line of normalizeCommentary(json)) {
      upsert(
        db,
        "match_commentary",
        {
          match_id: match.id,
          sequence: line.sequence,
          minute_display: line.minute_display,
          minute_seconds: line.minute_seconds,
          text: line.text,
        },
        ["match_id", "sequence"],
      );
    }
  });

  // Team-level stats (own transaction — never nest inside the one above).
  applyTeamStats(db, normalizeTeamStats(json, league));

  // When a match just finished, refresh the season leaderboards for its league.
  // Cheap full recompute — see teamStats.ts.
  if (match.status === "finished" && (match.league || league)) {
    const lg = match.league || league;
    if (!isCup(lg)) {
      const season = getSeasonKey(db, lg);
      recomputeSeasonStats(db, lg, season);
      recomputeSeasonTeamStats(db, lg, season);
    }
  }

  // Detect newly seen goals by diffing timeline rows we have not seen before.
  // Backfill case (first-ever sync, no previous row): mark everything as
  // notified WITHOUT queueing alerts — nobody wants five retroactive pings.
  const goalQuery = `SELECT espn_event_key, team_id, minute_display, description, participants
       FROM timeline_events
       WHERE match_id = ? AND type = 'goal'
         AND espn_event_key IS NOT NULL
         AND espn_event_key NOT IN (SELECT espn_event_key FROM notified_goals WHERE match_id = ?)`;
  // A scoreboard-only row (last_synced_at IS NULL) is NOT "seen" — goals from
  // a first-ever summary sync must not fire retroactive alerts.
  const summarySeen = prev !== undefined && prev.last_synced_at !== null;
  const newGoalRows = all<{
    espn_event_key: string;
    team_id: string | null;
    minute_display: string;
    description: string;
    participants: string;
  }>(db, goalQuery, [match.id, match.id]);
  for (const row of newGoalRows) {
    if (summarySeen) {
      const parts = safeParseArray(row.participants);
      const scorer = parts[0]?.name ?? row.description.slice(0, 40);
      goals.push({
        matchId: match.id,
        scoringTeamId: row.team_id ?? "",
        scorerName: scorer,
        minute: row.minute_display,
        homeScore: match.home_score ?? 0,
        awayScore: match.away_score ?? 0,
      });
    }
    run(db, "INSERT INTO notified_goals (match_id, espn_event_key, notified_at) VALUES (?, ?, ?)", [
      match.id,
      row.espn_event_key,
      new Date().toISOString(),
    ]);
  }

  return { match, goals };
}

function safeParseArray(s: string | null): { id: string; name: string }[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/**
 * Squad sync: upsert player rows and the coach. Never deactivates players here —
 * transfers are handled by the next match summary that features the new club.
 */
export function applyRoster(db: DB, json: any, _league: string): void {
  const players = normalizeRosterPlayers(json);
  const coach = normalizeCoach(json);
  tx(db, () => {
    for (const p of players) upsert(db, "players", { ...p }, ["id"]);
    if (coach) {
      run(
        db,
        `INSERT INTO team_coaches (team_id, name) VALUES (?, ?)
         ON CONFLICT(team_id) DO UPDATE SET name = excluded.name`,
        [coach.team_id, coach.name],
      );
    }
  });
}

export function applyStandings(db: DB, json: any, league: string, season: string): void {
  const { teams, rows } = normalizeStandings(json);
  tx(db, () => {
    for (const t of teams) {
      upsertCoalesce(
        db,
        "teams",
        teamRow(t, league),
        ["id"],
        ["short_name", "abbreviation", "logo_url", "color"],
        ["league"],
      );
    }
    for (const r of rows) {
      upsert(
        db,
        "standings",
        {
          league,
          season,
          team_id: r.team_id,
          rank: r.rank,
          played: r.played,
          wins: r.wins,
          draws: r.draws,
          losses: r.losses,
          goals_for: r.goals_for,
          goals_against: r.goals_against,
          points: r.points,
        },
        ["league", "season", "team_id"],
      );
    }
  });
}

// Imported late to avoid cycles; small helpers used above.
import { all } from "../db/index.js";

export function upsertPlayerUnderstat(p: {
  understat_id: number;
  name: string;
  team_id: string;
  league: string;
  season: number;
  apps: number;
  minutes: number;
  goals: number;
  assists: number;
  sh90: number;
  kp90: number;
  xg: number;
  xa: number;
  xg90: number;
  xa90: number;
  last_synced_at: number;
}) {
  const db = getDb();
  // Join by name, but EXACTLY — the old `LIKE '%name%'` matched substrings, so
  // "Mendy" landed on whichever Mendy row came first and xG got attributed to
  // the wrong player. Two passes: exact lowercase, then a normalized exact
  // (accents/punctuation stripped) for "Ilkay Gündogan" vs "Ilkay Gundogan".
  // Both are scoped to the team, which is what makes them safe.
  const findPlayer = (): { id: string } | undefined => {
    const exact = db
      .prepare("SELECT id FROM players WHERE team_id = ? AND LOWER(full_name) = LOWER(?)")
      .get(p.team_id, p.name) as { id?: string } | undefined;
    if (exact?.id) return { id: exact.id };
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const rows = db.prepare("SELECT id, full_name FROM players WHERE team_id = ?").all(p.team_id) as Array<{
      id: string;
      full_name: string;
    }>;
    const target = norm(p.name);
    return rows.find((r) => norm(r.full_name) === target);
  };
  const row = findPlayer();

  if (!row?.id) {
    // Unknown mapping: skip loudly enough to be fixable, never guess.
    console.warn(`[understat] no ESPN player matches "${p.name}" on team ${p.team_id} — skipped`);
    return;
  }

  const {
    understat_id,
    team_id,
    league,
    season,
    apps,
    minutes,
    goals,
    assists,
    sh90,
    kp90,
    xg,
    xa,
    xg90,
    xa90,
    last_synced_at,
  } = p;

  db.prepare(
    `
    INSERT INTO player_understat_stats
      (player_id, understat_id, season, team_id, league,
       apps, minutes, goals, assists, sh90, kp90, xg, xa, xg90, xa90, last_synced_at)
    VALUES (@player_id, @understat_id, @season, @team_id, @league,
            @apps, @minutes, @goals, @assists, @sh90, @kp90, @xg, @xa, @xg90, @xa90, @last_synced_at)
    ON CONFLICT(player_id, season) DO UPDATE SET
      understat_id=excluded.understat_id,
      apps=excluded.apps, minutes=excluded.minutes,
      goals=excluded.goals, assists=excluded.assists,
      sh90=excluded.sh90, kp90=excluded.kp90,
      xg=excluded.xg, xa=excluded.xa,
      xg90=excluded.xg90, xa90=excluded.xa90,
      last_synced_at=excluded.last_synced_at
  `,
  ).run({
    player_id: row.id,
    understat_id,
    team_id,
    league,
    season,
    apps,
    minutes,
    goals,
    assists,
    sh90,
    kp90,
    xg,
    xa,
    xg90,
    xa90,
    last_synced_at,
  });
}

export function upsertShotSituations(
  teamId: string,
  league: string,
  season: number,
  rows: {
    situation: string;
    shots: number;
    goals: number;
    shots_against: number;
    goals_against: number;
    xg: number;
    xga: number;
  }[],
  now: number,
) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO team_shot_situations
      (team_id, season, situation, shots, goals, shots_against, goals_against, xg, xga, last_synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(team_id, season, situation) DO UPDATE SET
      shots=excluded.shots, goals=excluded.goals,
      shots_against=excluded.shots_against, goals_against=excluded.goals_against,
      xg=excluded.xg, xga=excluded.xga,
      last_synced_at=excluded.last_synced_at
  `);
  tx(db, () => {
    for (const r of rows) {
      stmt.run(
        teamId,
        season,
        r.situation,
        r.shots,
        r.goals,
        r.shots_against,
        r.goals_against,
        r.xg,
        r.xga,
        now,
      );
    }
  });
}

export function upsertTeamUnderstat(t: {
  team_id: string;
  season: number;
  league: string;
  xg?: number | null;
  xga?: number | null;
  xg_for_total?: number | null;
  xg_against_total?: number | null;
  xpts?: number | null;
  ppda?: number | null;
  deep?: number | null;
  last_synced_at: number;
}) {
  const db = getDb();
  db.prepare(
    `
    INSERT INTO team_understat_stats
      (team_id, season, league, xg, xga, xg_for_total, xg_against_total, xpts, ppda, deep, last_synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(team_id, season) DO UPDATE SET
      league=excluded.league,
      xg=excluded.xg,
      xga=excluded.xga,
      xg_for_total=excluded.xg_for_total,
      xg_against_total=excluded.xg_against_total,
      xpts=excluded.xpts,
      ppda=excluded.ppda,
      deep=excluded.deep,
      last_synced_at=excluded.last_synced_at
  `,
  ).run(
    t.team_id,
    t.season,
    t.league,
    t.xg ?? null,
    t.xga ?? null,
    t.xg_for_total ?? null,
    t.xg_against_total ?? null,
    t.xpts ?? null,
    t.ppda ?? null,
    t.deep ?? null,
    t.last_synced_at,
  );
}

/**
 * A league-wide walk (the expected tables) writes only the team aggregate, and
 * deliberately leaves `last_synced_at` alone on an existing row: that column is
 * the per-club scrape's freshness clock, and the league walk has NOT fetched
 * this club's players or shot situations. Bumping it would make the next
 * followed-club scrape skip a club that only ever got the summary row.
 */
export function upsertLeagueUnderstatSummary(t: {
  team_id: string;
  season: number;
  league: string;
  xg: number | null;
  xga: number | null;
  xpts: number | null;
  ppda: number | null;
  deep: number | null;
}) {
  const db = getDb();
  db.prepare(
    `
    INSERT INTO team_understat_stats
      (team_id, season, league, xg, xga, xg_for_total, xg_against_total, xpts, ppda, deep, last_synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    ON CONFLICT(team_id, season) DO UPDATE SET
      league=excluded.league,
      xg=excluded.xg,
      xga=excluded.xga,
      xg_for_total=excluded.xg_for_total,
      xg_against_total=excluded.xg_against_total,
      xpts=excluded.xpts,
      ppda=excluded.ppda,
      deep=excluded.deep
  `,
  ).run(t.team_id, t.season, t.league, t.xg, t.xga, t.xg, t.xga, t.xpts, t.ppda, t.deep);
}

/**
 * Per-match xG/xGA, one row per (match, club) — the replay pitch's expected
 * goals. Written by the league Understat walk for every club it can name; a
 * club/date/scoreline that didn't match cleanly simply gets no row.
 */
export function upsertMatchUnderstatXg(
  rows: Array<{ match_id: string; team_id: string; xg: number | null; xga: number | null }>,
): void {
  if (rows.length === 0) return;
  const db = getDb();
  const now = Date.now();
  const stmt = db.prepare(`
    INSERT INTO match_understat_stats (match_id, team_id, xg, xga, last_synced_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(match_id, team_id) DO UPDATE SET
      xg=excluded.xg, xga=excluded.xga, last_synced_at=excluded.last_synced_at
  `);
  tx(db, () => {
    for (const r of rows) stmt.run(r.match_id, r.team_id, r.xg, r.xga, now);
  });
}
