/**
 * Player stat score — display-only, straight from `scoring-rules.md`.
 * Returns the total plus a per-rule breakdown so the UI can show a
 * transparent "why did I get X" panel.
 */
export interface StatLine {
  minutes_played: number | null;
  goals: number;
  assists: number;
  yellow_cards: number;
  red_cards: number;
  own_goals: number;
  saves: number | null;
  goals_conceded: number | null;
}

export interface StatScoreResult {
  total: number;
  breakdown: Record<string, number>;
}

export function statScore(
  line: StatLine,
  position: "GK" | "DEF" | "MID" | "FWD",
  teamConceded: number,
): StatScoreResult {
  const b: Record<string, number> = {};
  const mins = line.minutes_played ?? 0;

  // Appearance
  if (mins >= 60) {
    b.appearance60 = 2;
  } else if (mins >= 1) {
    b.appearanceUnder60 = 1;
  } else {
    b.didNotPlay = 0;
  }

  // Goals by position
  if (line.goals > 0) {
    const per = position === "GK" || position === "DEF" ? 6 : position === "MID" ? 5 : 4;
    b[`goals(${position})`] = line.goals * per;
  }

  // Assists
  if (line.assists > 0) b.assists = line.assists * 3;

  // Clean sheet: GK/DEF +4, MID +1 — played 60+ and team conceded 0
  if (mins >= 60 && teamConceded === 0 && line.goals_conceded !== null) {
    if (position === "GK" || position === "DEF") b.cleanSheet = 4;
    else if (position === "MID") b.cleanSheet = 1;
  }

  // Goals conceded: -1 per 2 while on pitch (GK/DEF only)
  if ((position === "GK" || position === "DEF") && line.goals_conceded && line.goals_conceded > 0) {
    b.goalsConceded = -Math.floor(line.goals_conceded / 2);
  }

  // Saves: +1 per 3 (GK)
  if (position === "GK" && line.saves && line.saves > 0) {
    b.saves = Math.floor(line.saves / 3);
  }

  // Cards & own goals
  if (line.yellow_cards > 0) b.yellowCards = -line.yellow_cards;
  if (line.red_cards > 0) b.redCards = -3 * line.red_cards;
  if (line.own_goals > 0) b.ownGoals = -2 * line.own_goals;

  const total = Object.values(b).reduce((a, c) => a + c, 0);
  return { total, breakdown: b };
}
