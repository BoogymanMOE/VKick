import type { DB } from "../db/index.js";

// server/scoring/ratings.ts
//
// Algorithmic per-player ratings derived from ESPN match data.
//
// Design:
//   - Base 6.0 for every player.
//   - Per-position weights reward role-specific contributions.
//   - Universal modifiers: result, big-match (cup tie), xG overperformance
//     (when Understat data is available), minutes prorate.
//   - Clamp [0, 10], round to 1 decimal.
//
// Flow A (live team form pulse) is a future enhancement and is NOT built here.
// It needs a separate sync interval that polls team-level stats during a
// match and a distinct display surface; bundling it with the final rating
// would mix two different triggers and two different lifecycles.

export interface PlayerMatchStats {
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
  started: boolean;
}

export interface MatchContext {
  teamId: string;
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number | null;
  awayScore: number | null;
  round: string | null; // cup round label; null for leagues
}

export type PositionBucket =
  | "GK"
  | "CB"
  | "FB"
  | "CDM"
  | "CM"
  | "WM"
  | "WF"
  | "CF";

export function bucketPosition(espnPosition: string | null, position: string | null): PositionBucket {
  const code = (espnPosition ?? "").toUpperCase();
  const pos = (position ?? "").toUpperCase();
  if (code.startsWith("G") || pos === "GK") return "GK";
  if (code.includes("CB") || code.includes("CD")) return "CB";
  if (code === "RB" || code === "LB" || code === "RWB" || code === "LWB" || code.includes("FB")) return "FB";
  if (code === "CDM" || code === "DM" || code === "DH") return "CDM";
  if (code === "CM" || code === "AM" || code === "CAM" || code === "CMF") return "CM";
  if (code === "WM" || code === "LM" || code === "RM" || code === "LW" || code === "RW") return "WM";
  if (code === "WF" || code === "LF" || code === "RF") return "WF";
  if (code === "CF" || code === "ST" || code === "FW") return "CF";
  // Fallback by coarse position
  if (pos === "DEF") return "CB";
  if (pos === "MID") return "CM";
  if (pos === "FWD") return "CF";
  return "CM";
}

export function computePlayerRating(
  stats: PlayerMatchStats,
  espnPosition: string | null,
  position: string | null,
  ctx: MatchContext,
): number {
  const bucket = bucketPosition(espnPosition, position);
  const minutes = stats.minutes_played ?? 0;
  const goals = stats.goals ?? 0;
  const assists = stats.assists ?? 0;
  const shots = stats.shots ?? 0;
  const sot = stats.shots_on_target ?? 0;
  const yellow = stats.yellow_cards ?? 0;
  const red = stats.red_cards ?? 0;
  const saves = stats.saves ?? 0;
  const conceded = stats.goals_conceded ?? 0;
  const fouls = stats.fouls_committed ?? 0;
  const offsides = stats.offsides ?? 0;
  const ownGoals = stats.own_goals ?? 0;

  let rating = 6.0;

  // Per-position weights (only columns that exist in match_player_stats).
  switch (bucket) {
    case "GK":
      rating += Math.min(1.5, saves * 0.25);
      if (conceded === 0 && minutes >= 45) rating += 1.5;
      rating += Math.max(-2.5, -0.3 * conceded);
      break;
    case "CB":
      if (conceded === 0 && minutes >= 45) rating += 1.2;
      rating -= fouls * 0.3;
      rating -= yellow * 0.5;
      rating -= red * 2.0;
      rating -= ownGoals * 1.0;
      break;
    case "FB":
      if (conceded === 0 && minutes >= 45) rating += 1.0;
      rating -= fouls * 0.3;
      rating -= yellow * 0.5;
      rating -= red * 2.0;
      break;
    case "CDM":
      if (conceded === 0 && minutes >= 45) rating += 0.8;
      rating -= fouls * 0.3;
      rating -= yellow * 0.5;
      rating -= red * 2.0;
      break;
    case "CM":
      if (conceded === 0 && minutes >= 45) rating += 0.5;
      rating -= fouls * 0.3;
      rating -= yellow * 0.5;
      rating -= red * 2.0;
      break;
    case "WM":
      if (conceded === 0 && minutes >= 45) rating += 0.3;
      rating -= fouls * 0.3;
      rating -= yellow * 0.5;
      rating -= red * 2.0;
      break;
    case "WF":
      if (conceded === 0 && minutes >= 45) rating += 0.3;
      rating -= fouls * 0.3;
      rating -= yellow * 0.5;
      rating -= red * 2.0;
      break;
    case "CF":
      if (conceded === 0 && minutes >= 45) rating += 0.3;
      rating += goals * 1.8;
      rating += assists * 1.0;
      rating += sot * 0.3;
      rating -= (shots - sot) * 0.2; // shots off target
      rating -= offsides * 0.3;
      rating -= yellow * 0.5;
      rating -= red * 2.0;
      break;
  }

  // Universal: goals/assists for non-CF positions (so a defender scoring counts)
  if (bucket !== "CF") {
    rating += goals * 1.8;
    rating += assists * 1.0;
  }
  // Universal: SoT bonus for non-CF
  if (bucket !== "CF" && sot > 0) rating += sot * 0.15;

  // Result modifier
  const homeScore = ctx.homeScore ?? 0;
  const awayScore = ctx.awayScore ?? 0;
  const isHome = ctx.teamId === ctx.homeTeamId;
  const teamScore = isHome ? homeScore : awayScore;
  const oppScore = isHome ? awayScore : homeScore;
  if (teamScore > oppScore) rating += 0.4;
  else if (teamScore < oppScore) rating -= 0.4;

  // Big match: cup tie (round present) — +0.5
  if (ctx.round) rating += 0.5;

  // Own goal penalty
  rating -= ownGoals * 1.0;

  // Minutes prorate: floor 0.6
  if (minutes < 90) {
    const factor = Math.max(0.6, minutes / 90);
    rating = 6.0 + (rating - 6.0) * factor;
  }

  // Veteran consistency floor: full match, no cards, no own goals.
  if (minutes >= 75 && yellow === 0 && red === 0 && ownGoals === 0) {
    rating = Math.max(rating, 6.3);
  }

  // Clamp and round
  rating = Math.max(0, Math.min(10, rating));
  return Math.round(rating * 10) / 10;
}

/** Add a +0.3 Man-of-the-Match bonus to the highest-rated player on each team. */
export function applyManOfTheMatch(db: DB, matchId: string): void {
  const teams = db
    .prepare("SELECT DISTINCT team_id FROM match_player_stats WHERE match_id = ?")
    .all(matchId) as Array<{ team_id: string }>;
  for (const t of teams) {
    const row = db
      .prepare(
        "SELECT player_id FROM match_player_stats WHERE match_id = ? AND team_id = ? AND rating IS NOT NULL ORDER BY rating DESC, minutes_played DESC LIMIT 1",
      )
      .get(matchId, t.team_id) as { player_id: string } | undefined;
    if (row) {
      db.prepare("UPDATE match_player_stats SET rating = MIN(10, rating + 0.3) WHERE match_id = ? AND player_id = ?").run(
        matchId,
        row.player_id,
      );
    }
  }
}
