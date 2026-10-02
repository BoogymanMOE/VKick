/**
 * Form guide: the last few results per club, folded out of the matches we
 * already store rather than a second ESPN feed. Deriving it here means the
 * strip on the table can never disagree with the fixtures the club page shows.
 */

export interface FormMatchRow {
  home_team_id: string;
  away_team_id: string;
  home_score: number;
  away_score: number;
}

/** 'W' | 'D' | 'L' from one club's point of view. */
function resultOf(goalsFor: number, goalsAgainst: number): string {
  if (goalsFor > goalsAgainst) return "W";
  if (goalsFor < goalsAgainst) return "L";
  return "D";
}

function push(
  byTeam: Record<string, string[]>,
  teamId: string,
  goalsFor: number,
  goalsAgainst: number,
  limit: number,
): void {
  const results = (byTeam[teamId] ??= []);
  if (results.length >= limit) return;
  results.push(resultOf(goalsFor, goalsAgainst));
}

/**
 * Rows must arrive NEWEST first (the caller orders by kickoff desc); the
 * returned string is oldest-first so a strip reads left to right like a
 * timeline, ending on the club's most recent match. Clubs with no finished
 * match are simply absent — callers render "no form" rather than an empty strip.
 */
export function foldForm(rows: FormMatchRow[], limit = 5): Record<string, string> {
  const byTeam: Record<string, string[]> = {};
  for (const match of rows) {
    push(byTeam, match.home_team_id, match.home_score, match.away_score, limit);
    push(byTeam, match.away_team_id, match.away_score, match.home_score, limit);
  }
  const out: Record<string, string> = {};
  for (const [teamId, results] of Object.entries(byTeam)) {
    out[teamId] = results.reverse().join("");
  }
  return out;
}
