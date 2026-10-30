/**
 * Home / away splits: a league table's other half, folded out of the matches we
 * already store rather than a second ESPN feed — the same rule that keeps the
 * form strip honest. A viewer checking "who is best at home" gets an answer
 * that can never disagree with the fixtures on the club page.
 */

export interface SplitMatchRow {
  home_team_id: string;
  away_team_id: string;
  home_score: number;
  away_score: number;
}

/** One side of a club's season, in the same terms as a standings row. */
export interface SplitRow {
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
}

export interface TeamSplits {
  home: SplitRow;
  away: SplitRow;
}

function empty(): SplitRow {
  return { played: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0, points: 0 };
}

function add(row: SplitRow, goalsFor: number, goalsAgainst: number): void {
  row.played += 1;
  row.goalsFor += goalsFor;
  row.goalsAgainst += goalsAgainst;
  if (goalsFor > goalsAgainst) {
    row.wins += 1;
    row.points += 3;
  } else if (goalsFor === goalsAgainst) {
    row.draws += 1;
    row.points += 1;
  } else {
    row.losses += 1;
  }
}

/**
 * Fold every finished, scored match of a league into each club's home and away
 * record. Clubs with no matches are simply absent — callers render "no split"
 * rather than an empty 0-0-0 row that looks like a played season.
 */
export function foldSplits(rows: SplitMatchRow[]): Record<string, TeamSplits> {
  const out: Record<string, TeamSplits> = {};
  const splitsOf = (teamId: string): TeamSplits => (out[teamId] ??= { home: empty(), away: empty() });
  for (const match of rows) {
    add(splitsOf(match.home_team_id).home, match.home_score, match.away_score);
    add(splitsOf(match.away_team_id).away, match.away_score, match.home_score);
  }
  return out;
}
