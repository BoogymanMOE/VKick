import { run, get, upsert, tx, type DB } from "../db/index.js";

export interface NormTeamStats {
  match_id: string;
  team_id: string;
  possession_pct: number | null;
  shots: number | null;
  shots_on_target: number | null;
  corners: number | null;
  fouls: number | null;
  offsides: number | null;
  saves: number | null;
  passes_total: number | null;
  passes_accurate: number | null;
  pass_accuracy_pct: number | null;
}

function num(stats: any[] | undefined, name: string): number | null {
  const s = (stats ?? []).find((x) => x.name === name);
  if (!s) return null;
  const raw = s.value ?? s.displayValue;
  if (raw === undefined || raw === null || raw === "") return null;
  const v = Number(raw);
  return Number.isNaN(v) ? null : v;
}

/** Team-level stats from `boxscore.teams[].statistics[]` (per-league stat schemas). */
export function normalizeTeamStats(json: any, league: string): NormTeamStats[] {
  const out: NormTeamStats[] = [];
  const matchId = String(json.header?.competitions?.[0]?.id ?? "");
  if (!matchId) return out;
  const names =
    league === "eng.1"
      ? {
          shotsOnTarget: "onTargetShots",
          fouls: "totalFouls",
        }
      : {
          shotsOnTarget: "shotsOnTarget",
          fouls: "foulsCommitted",
        };
  const pct = (stats: any[] | undefined, name: string): number | null => {
    const v = num(stats, name);
    if (v === null) return null;
    return v <= 1 ? v * 100 : v; // ESPN mixes fractions and percents
  };
  for (const t of json.boxscore?.teams ?? []) {
    const teamId = String(t.team?.id ?? "");
    if (!teamId) continue;
    out.push({
      match_id: matchId,
      team_id: teamId,
      possession_pct: num(t.statistics, "possessionPct"),
      shots: num(t.statistics, "totalShots"),
      shots_on_target: num(t.statistics, names.shotsOnTarget),
      corners: num(t.statistics, "wonCorners"),
      fouls: num(t.statistics, names.fouls),
      offsides: num(t.statistics, "offsides"),
      saves: num(t.statistics, "saves"),
      passes_total: num(t.statistics, "totalPasses"),
      passes_accurate: num(t.statistics, "accuratePasses"),
      pass_accuracy_pct: pct(t.statistics, "passPct"),
    });
  }
  return out;
}

export function applyTeamStats(db: DB, rows: NormTeamStats[]): void {
  if (rows.length === 0) return;
  tx(db, () => {
    for (const r of rows) {
      upsert(db, "match_team_stats", { ...r }, ["match_id", "team_id"]);
    }
  });
}

/**
 * Season player aggregates: recompute the per-league leaderboard from
 * match_player_stats × matches for finished matches. Local SQLite makes a full
 * recompute cheap; grouped queries beat incrementally-maintained counters (no
 * drift, ever) and run in milliseconds at this scale.
 */
export function recomputeSeasonStats(db: DB, league: string, season: string): void {
  // Domestic seasons span Aug–May ("2026-27"); cups use calendar years ("2026").
  const calendarYear = !season.includes("-");
  const startYear = parseInt(season.slice(0, 4), 10);
  const from = calendarYear ? `${startYear}-01-01` : `${startYear}-08-01`;
  const to = calendarYear ? `${startYear + 1}-01-01` : `${startYear + 1}-08-01`;
  tx(db, () => {
    run(db, "DELETE FROM player_season_stats WHERE league = ? AND season = ?", [league, season]);
    run(
      db,
      `INSERT INTO player_season_stats
        (league, season, player_id, team_id, appearances, starts, minutes, goals, assists,
         shots, shots_on_target, yellow_cards, red_cards, saves, goals_conceded,
         fouls_committed, own_goals, stat_score_total, stat_score_avg, updated_at)
      SELECT
        ?, ?,
        s.player_id,
        s.team_id,
        COUNT(*)                                          AS appearances,
        SUM(s.started)                                    AS starts,
        SUM(s.minutes_played)                             AS minutes,
        SUM(s.goals)                                      AS goals,
        SUM(s.assists)                                    AS assists,
        SUM(s.shots)                                      AS shots,
        SUM(s.shots_on_target)                            AS shots_on_target,
        SUM(s.yellow_cards)                               AS yellow_cards,
        SUM(s.red_cards)                                  AS red_cards,
        SUM(COALESCE(s.saves, 0))                         AS saves,
        SUM(COALESCE(s.goals_conceded, 0))                AS goals_conceded,
        SUM(s.fouls_committed)                            AS fouls_committed,
        SUM(s.own_goals)                                  AS own_goals,
        SUM(COALESCE(s.stat_score, 0))                    AS stat_score_total,
        CAST(SUM(COALESCE(s.stat_score, 0)) AS REAL) / COUNT(*) AS stat_score_avg,
        ?
      FROM match_player_stats s
      JOIN matches m ON m.id = s.match_id
      JOIN players p ON p.id = s.player_id
      WHERE m.league = ? AND m.status = 'finished'
        AND m.kickoff_at >= ? AND m.kickoff_at < ?
        AND s.minutes_played > 0
        AND p.active = 1
      GROUP BY s.player_id`,
      [league, season, new Date().toISOString(), league, from, to],
    );
  });
}

/**
 * Season team aggregates for the per-team stats table. Goals come from the
 * match scoreline (authoritative), possession/pass accuracy from boxscore
 * team stats, W/D/L from the scores.
 */
export function recomputeSeasonTeamStats(db: DB, league: string, season: string): void {
  const calendarYear = !season.includes("-");
  const startYear = parseInt(season.slice(0, 4), 10);
  const from = calendarYear ? `${startYear}-01-01` : `${startYear}-08-01`;
  const to = calendarYear ? `${startYear + 1}-01-01` : `${startYear + 1}-08-01`;
  tx(db, () => {
    run(db, "DELETE FROM team_season_stats WHERE league = ? AND season = ?", [league, season]);
    run(
      db,
      `INSERT INTO team_season_stats
        (league, season, team_id, played, wins, draws, losses, goals_for, goals_against,
         clean_sheets, avg_possession, avg_pass_accuracy, total_shots, total_shots_on_target,
         total_corners, total_fouls, updated_at)
      SELECT
        ?, ?,
        ts.team_id,
        COUNT(*)                                              AS played,
        SUM(CASE WHEN ts.goals_for > ts.goals_against THEN 1 ELSE 0 END) AS wins,
        SUM(CASE WHEN ts.goals_for = ts.goals_against THEN 1 ELSE 0 END) AS draws,
        SUM(CASE WHEN ts.goals_for < ts.goals_against THEN 1 ELSE 0 END) AS losses,
        SUM(ts.goals_for)                                     AS goals_for_total,
        SUM(ts.goals_against)                                 AS goals_against_total,
        SUM(CASE WHEN ts.goals_against = 0 THEN 1 ELSE 0 END) AS clean_sheets,
        AVG(COALESCE(b.possession_pct, 0))                    AS avg_possession,
        AVG(COALESCE(b.pass_accuracy_pct, 0))                 AS avg_pass_accuracy,
        SUM(COALESCE(b.shots, 0))                             AS total_shots,
        SUM(COALESCE(b.shots_on_target, 0))                   AS total_shots_on_target,
        SUM(COALESCE(b.corners, 0))                           AS total_corners,
        SUM(COALESCE(b.fouls, 0))                             AS total_fouls,
        ?
      FROM (
        SELECT m.id AS match_id, m.home_team_id AS team_id, m.home_score AS goals_for, m.away_score AS goals_against
        FROM matches m WHERE m.home_score IS NOT NULL
        UNION ALL
        SELECT m.id AS match_id, m.away_team_id AS team_id, m.away_score AS goals_for, m.home_score AS goals_against
        FROM matches m WHERE m.away_score IS NOT NULL
      ) ts
      JOIN matches m ON m.id = ts.match_id
      LEFT JOIN match_team_stats b ON b.match_id = ts.match_id AND b.team_id = ts.team_id
      WHERE m.league = ? AND m.status = 'finished'
        AND m.kickoff_at >= ? AND m.kickoff_at < ?
      GROUP BY ts.team_id`,
      [league, season, new Date().toISOString(), league, from, to],
    );
  });
}

/**
 * The season label for aggregations. Prefer the label the standings sync
 * stored; fall back to deriving from the current date (Aug–May season).
 */
export function getSeasonKey(db: DB, league: string): string {
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
