export type LeagueSlug = "eng.1" | "esp.1" | "ita.1" | "ger.1" | "fra.1";

/** The big five domestic leagues — the ones the favorites rule is built on. */
export const LEAGUES: LeagueSlug[] = ["eng.1", "esp.1", "ita.1", "ger.1", "fra.1"];

/** Every competition that owns a league table (big five only now). */
export const ALL_DOMESTIC: LeagueSlug[] = [...LEAGUES];

/** Seeded competition labels — the 5 big-five leagues with display names. */
export const COMPETITIONS: Array<{
  slug: LeagueSlug;
  name: string;
  kind: "league";
}> = [
  { slug: "eng.1", name: "Premier League", kind: "league" },
  { slug: "esp.1", name: "La Liga", kind: "league" },
  { slug: "ita.1", name: "Serie A", kind: "league" },
  { slug: "ger.1", name: "Bundesliga", kind: "league" },
  { slug: "fra.1", name: "Ligue 1", kind: "league" },
];

/** Cups removed — top-5 leagues only. Empty for consumers that still import it. */
export const CUPS: LeagueSlug[] = [];

/** Internationals removed — top-5 leagues only. Empty for consumers that still import it. */
export const INTERNATIONALS: string[] = [];

/**
 * Cups and internationals removed — top-5 leagues only.
 * isCup always returns false for the big five.
 */
export function isCup(_league: string): boolean {
  return false;
}

/**
 * Sweep window: 21 days forward for all big-five leagues.
 */
export function pollWindow(_league: string): { back: number; forward: number } {
  return { back: 1, forward: 21 };
}

/** "halftime" is a real status, not a flavour of live: the Sub Predictor's
 * lock rule needs it. ESPN stays state:"in" through the break — the
 * description/shortDetail ("Halftime" / "HT") is the only reliable signal.
 */
export type OurStatus =
  | "scheduled"
  | "live"
  | "halftime"
  | "finished"
  // Not played. ESPN sends all three under state "post", which used to be
  // enough to call them finished (a called-off fixture rendered as a 0-0
  // result). They carry no score and must never count as a result.
  | "postponed"
  | "abandoned"
  | "cancelled";

export interface NormTeam {
  id: string;
  name: string;
  short_name: string | null;
  abbreviation: string | null;
  logo_url: string | null;
  color: string | null;
  league: string;
}

export interface NormMatch {
  id: string;
  league: string;
  home_team_id: string;
  away_team_id: string;
  kickoff_at: string;
  status: OurStatus;
  home_score: number | null;
  away_score: number | null;
  minute_display: string | null;
  espn_season: string | null;
  /** Cup round label ("Quarter-final"); null for league matches. */
  round: string | null;
  home_formation: string | null;
  away_formation: string | null;
  /** Shootout score when a knockout tie went to penalties; null otherwise. */
  home_pens: number | null;
  away_pens: number | null;
  /** How a level tie was separated: 'penalties' | 'extra-time' | null. */
  decided_by: "penalties" | "extra-time" | null;
  venue: string | null;
  referee: string | null;
  attendance: number | null;
}

export interface NormPlayer {
  id: string;
  team_id: string;
  full_name: string;
  short_name: string | null;
  position: string;
  espn_position: string | null;
  jersey_number: number | null;
  headshot_url: string | null;
}

export interface NormPlayerStats {
  player_id: string;
  team_id: string;
  started: boolean;
  subbed_in: boolean;
  subbed_out: boolean;
  formation_place: string | null;
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
}

export interface NormTimelineEvent {
  espn_event_key: string | null;
  minute_display: string;
  minute_seconds: number;
  type: string;
  team_id: string | null;
  description: string;
  participants: string; // JSON [{id, name}]
  /** Shot origin, 0..100 along the length / across the width (goals only). */
  field_x: number | null;
  field_y: number | null;
  /** Where the ball crossed the goal line, 0..100 across the width. */
  goal_y: number | null;
}

export interface NormCommentaryLine {
  sequence: number;
  minute_display: string | null;
  minute_seconds: number | null;
  text: string;
}

export interface NormStandingRow {
  team_id: string;
  rank: number | null;
  played: number | null;
  wins: number | null;
  draws: number | null;
  losses: number | null;
  goals_for: number | null;
  goals_against: number | null;
  points: number | null;
  group_name: string | null;
}
