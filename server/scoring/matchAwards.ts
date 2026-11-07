import type { DB } from "../db/index.js";
import { get, all } from "../db/index.js";

export interface PlayerAward {
  player_id: string;
  name: string;
  team_id: string;
  team_short: string;
  team_color: string | null;
  position: string | null;
  jersey_number: number;
  rating: number | null;
  headshot_url: string | null;
  avatarUrl: string | null;
  reason: string;
}

export interface MatchAwards {
  mvp: PlayerAward | null;
  honorable: PlayerAward[];
}

function teamShortColor(db: DB, teamId: string): { short: string; color: string | null } {
  const row = get<{ short_name: string | null; color: string | null }>(
    db,
    "SELECT short_name, color FROM teams WHERE id = ?",
    [teamId],
  );
  return { short: row?.short_name ?? teamId, color: row?.color ?? null };
}

export function computeMatchAwards(db: DB, matchId: string): MatchAwards {
  const match = get<{
    id: string;
    home_team_id: string;
    away_team_id: string;
    home_score: number | null;
    away_score: number | null;
  }>(db, "SELECT id, home_team_id, away_team_id, home_score, away_score FROM matches WHERE id = ?", [matchId]);
  if (!match) return { mvp: null, honorable: [] };

  const homeScore = match.home_score ?? 0;
  const awayScore = match.away_score ?? 0;
  const homeWon = homeScore > awayScore;
  const awayWon = awayScore > homeScore;
  const scoreStr = `${homeScore}-${awayScore}`;

  const players = all<{
    player_id: string;
    team_id: string;
    full_name: string;
    position: string | null;
    espn_position: string | null;
    jersey_number: number | null;
    rating: number | null;
    saves: number | null;
    goals: number;
    assists: number;
    headshot_url: string | null;
  }>(
    db,
    `SELECT mps.player_id, mps.team_id, p.full_name, mps.position, mps.espn_position,
            p.jersey_number, mps.rating, mps.saves, mps.goals, mps.assists, p.headshot_url
     FROM match_player_stats mps JOIN players p ON p.id = mps.player_id
     WHERE mps.match_id = ?`,
    [matchId],
  );

  // Count goals/assists from timeline as a cross-check (match_player_stats already has them).
  const goalCounts = new Map<string, number>();
  const assistCounts = new Map<string, number>();
  const events = all<{ participants: string | null }>(
    db,
    "SELECT participants FROM timeline_events WHERE match_id = ? AND type = 'goal'",
    [matchId],
  );
  for (const e of events) {
    try {
      const parts = JSON.parse(e.participants ?? "[]") as Array<{ id: string }>;
      if (parts[0]?.id) goalCounts.set(parts[0].id, (goalCounts.get(parts[0].id) ?? 0) + 1);
      if (parts[1]?.id) assistCounts.set(parts[1].id, (assistCounts.get(parts[1].id) ?? 0) + 1);
    } catch {
      // ignore
    }
  }

  const awards: (PlayerAward & { _impact: number })[] = players.map((p) => {
    const goals = goalCounts.get(p.player_id) ?? p.goals ?? 0;
    const assists = assistCounts.get(p.player_id) ?? p.assists ?? 0;
    const saves = p.saves ?? 0;
    const rating = p.rating ?? 0;
    const teamWon = p.team_id === match.home_team_id ? homeWon : awayWon;
    const teamLost = p.team_id === match.home_team_id ? awayWon : homeWon;
    const position = (p.espn_position ?? p.position ?? "").toUpperCase();
    const isGK = position.startsWith("G") || (p.position ?? "").toUpperCase() === "GK";
    const isDef = position.includes("CB") || position.includes("CD") || position === "RB" || position === "LB" || (p.position ?? "").toUpperCase() === "DEF";

    let impact = rating + goals * 3 + assists * 2 + (isGK ? saves * 0.3 : 0);
    if (teamWon && (goals + assists > 0)) impact += 5;
    if (teamWon && goals >= 2) impact += 3;

    // Reason
    let reason = "Top-rated on the pitch";
    if (goals >= 2 && teamWon) reason = `Brace in ${scoreStr} win`;
    else if (goals >= 1 && assists >= 1 && teamWon) reason = `Goal + assist in ${scoreStr} win`;
    else if (goals >= 2 && teamLost) reason = `${goals} goals in losing effort`;
    else if (goals === 1 && teamLost) reason = "Goal in losing effort";
    else if (isGK && saves >= 6 && teamLost && Math.abs(homeScore - awayScore) <= 1) reason = `${saves} saves in narrow loss`;
    else if (isDef && (p.goals ?? 0) === 0 && rating >= 7 && ((p.team_id === match.home_team_id && homeScore === 0 && awayScore === 0) || (p.team_id === match.home_team_id && homeScore === 0) || (p.team_id === match.away_team_id && awayScore === 0))) {
      // clean sheet if their team conceded 0
      const conceded = p.team_id === match.home_team_id ? awayScore : homeScore;
      if (conceded === 0) reason = "Clean sheet, solid at the back";
    }
    if (reason === "Top-rated on the pitch" && rating >= 7.5) reason = "Top-rated on the pitch";

    const tc = teamShortColor(db, p.team_id);
    return {
      player_id: p.player_id,
      name: p.full_name,
      team_id: p.team_id,
      team_short: tc.short,
      team_color: tc.color,
      position: p.position,
      jersey_number: p.jersey_number ?? 0,
      rating: p.rating,
      headshot_url: p.headshot_url,
      avatarUrl: null,
      reason,
      _impact: impact,
    };
  });

  awards.sort((a, b) => b._impact - a._impact || (b.rating ?? 0) - (a.rating ?? 0));

  const mvp = awards[0] ?? null;
  const honorable = awards.slice(1, 3);

  const strip = (a: (PlayerAward & { _impact: number }) | null): PlayerAward | null => {
    if (!a) return null;
    const { _impact, ...rest } = a;
    return rest;
  };

  return {
    mvp: strip(mvp),
    honorable: honorable.map((a) => strip(a) as PlayerAward),
  };
}
