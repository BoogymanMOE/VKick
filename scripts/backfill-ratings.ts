import { getDb } from "../server/db/index.js";
import { computePlayerRating, applyManOfTheMatch } from "../server/scoring/ratings.js";

const db = getDb();

const matches = db
  .prepare(
    `SELECT m.id, m.home_team_id, m.away_team_id, m.home_score, m.away_score, m.round, m.league, m.espn_season
     FROM matches m
     WHERE m.status = 'finished'
       AND EXISTS (SELECT 1 FROM match_player_stats mps WHERE mps.match_id = m.id)`,
  )
  .all() as Array<{
  id: string;
  home_team_id: string;
  away_team_id: string;
  home_score: number | null;
  away_score: number | null;
  round: string | null;
  league: string;
  espn_season: string | null;
}>;

let done = 0;
let totalRated = 0;
for (const m of matches) {
  const tsRows = db
    .prepare("SELECT team_id, tackles_total, interceptions, shots_on_target, corners FROM match_team_stats WHERE match_id = ?")
    .all(m.id) as Array<{ team_id: string; tackles_total: number | null; interceptions: number | null; shots_on_target: number | null; corners: number | null }>;
  const tsByTeam = new Map(tsRows.map((r) => [r.team_id, r]));

  const stats = db
    .prepare(
      `SELECT mps.player_id, mps.team_id, mps.minutes_played, mps.goals, mps.assists, mps.shots, mps.shots_on_target,
              mps.yellow_cards, mps.red_cards, mps.saves, mps.goals_conceded, mps.fouls_committed, mps.offsides, mps.own_goals,
              mps.position, mps.espn_position,
              adv.tackles, adv.interceptions, adv.clearances, adv.blocks, adv.dribbles_success, adv.key_passes, adv.crosses, adv.aerials_won, adv.xg, adv.xa
       FROM match_player_stats mps
       LEFT JOIN match_player_advanced_stats adv ON adv.match_id = mps.match_id AND adv.player_id = mps.player_id
       WHERE mps.match_id = ?`,
    )
    .all(m.id) as Array<{
    player_id: string;
    team_id: string;
    minutes_played: number | null;
    goals: number;
    assists: number;
    shots: number;
    shots_on_target: number;
    yellow_cards: number;
    red_cards: number;
    saves: number | null;
    goals_conceded: number | null;
    fouls_committed: number;
    offsides: number;
    own_goals: number;
    position: string | null;
    espn_position: string | null;
    tackles: number | null;
    interceptions: number | null;
    clearances: number | null;
    blocks: number | null;
    dribbles_success: number | null;
    key_passes: number | null;
    crosses: number | null;
    aerials_won: number | null;
    xg: number | null;
    xa: number | null;
  }>;

  for (const s of stats) {
    const ts = tsByTeam.get(s.team_id);
    const rating = computePlayerRating(
      {
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
        started: false,
        tackles: s.tackles,
        interceptions: s.interceptions,
        clearances: s.clearances,
        blocks: s.blocks,
        dribbles_success: s.dribbles_success,
        key_passes: s.key_passes,
        crosses: s.crosses,
        aerials_won: s.aerials_won,
        xg: s.xg,
        xa: s.xa,
      },
      s.espn_position,
      s.position,
      {
        teamId: s.team_id,
        homeTeamId: m.home_team_id,
        awayTeamId: m.away_team_id,
        homeScore: m.home_score,
        awayScore: m.away_score,
        round: m.round,
        teamTacklesTotal: ts?.tackles_total ?? null,
        teamInterceptions: ts?.interceptions ?? null,
        teamShotsOnTarget: ts?.shots_on_target ?? null,
        teamCorners: ts?.corners ?? null,
      },
    );
    db.prepare("UPDATE match_player_stats SET rating = ? WHERE match_id = ? AND player_id = ?").run(
      rating,
      m.id,
      s.player_id,
    );
    totalRated++;
  }
  applyManOfTheMatch(db, m.id);
  done++;
  if (done % 100 === 0) console.log(`[backfill] ${done}/${matches.length} matches, ${totalRated} ratings`);
}

console.log(`[backfill] done: ${done} matches, ${totalRated} ratings`);

// Distribution
const rows = db.prepare("SELECT rating FROM match_player_stats WHERE rating IS NOT NULL").all() as Array<{ rating: number }>;
const buckets: Record<string, number> = {};
let sum = 0;
for (const r of rows) {
  const b = Math.floor(r.rating).toString() + ".x";
  buckets[b] = (buckets[b] || 0) + 1;
  sum += r.rating;
}
console.log("[backfill] total rated rows:", rows.length);
console.log("[backfill] average rating:", (sum / rows.length).toFixed(3));
console.log("[backfill] distribution:", JSON.stringify(buckets, null, 2));
