export type DomesticLeagueSlug = "eng.1" | "esp.1" | "ita.1" | "ger.1" | "fra.1";

/** European club cups — knockout competitions with no league table. */
export type EuropeanCupSlug = "uefa.champions" | "uefa.europa";

export type LeagueSlug = DomesticLeagueSlug | EuropeanCupSlug;

/** The big five domestic leagues — the ones the favorites rule is built on. */
export const LEAGUES: DomesticLeagueSlug[] = ["eng.1", "esp.1", "ita.1", "ger.1", "fra.1"];

/** Every competition that owns a league table (big five only). */
export const ALL_DOMESTIC: DomesticLeagueSlug[] = [...LEAGUES];

/**
 * European club cups, synced alongside the big five. They share ESPN's team-id
 * space with the domestic leagues, so a cup sync never overwrites a club's
 * domestic `league` (see `isCup` and the team upsert).
 */
export const CUPS: EuropeanCupSlug[] = ["uefa.champions", "uefa.europa"];

/** Every competition the scoreboard/fixture sync polls: big five + cups. */
export const ALL_COMPETITIONS: LeagueSlug[] = [...LEAGUES, ...CUPS];

/** Seeded competition labels — the big five leagues plus the two UEFA cups. */
export const COMPETITIONS: Array<{
  slug: LeagueSlug;
  name: string;
  kind: "league" | "cup";
}> = [
  { slug: "eng.1", name: "Premier League", kind: "league" },
  { slug: "esp.1", name: "La Liga", kind: "league" },
  { slug: "ita.1", name: "Serie A", kind: "league" },
  { slug: "ger.1", name: "Bundesliga", kind: "league" },
  { slug: "fra.1", name: "Ligue 1", kind: "league" },
  { slug: "uefa.champions", name: "UEFA Champions League", kind: "cup" },
  { slug: "uefa.europa", name: "UEFA Europa League", kind: "cup" },
];

/** Internationals remain out of scope — no national-team competitions synced. */
export const INTERNATIONALS: string[] = [];

/**
 * True for every competition WITHOUT a league table. It also carries the "this
 * competition does not own a club's domestic league" meaning used by the team
 * upsert, which is what stops a Real Madrid synced from a Champions League
 * scoreboard from claiming uefa.champions as its own league.
 */
export function isCup(league: string): boolean {
  return (CUPS as string[]).includes(league);
}

/**
 * Sweep window: 21 days forward for every synced competition.
 *
 * `back` is a CEILING, not the window the sweeps actually use (callers pass
 * their own budget), so widening it only widens sweeps that ASK for more: the
 * daily results lookback runs a week back so a short outage — a box down for
 * a weekend — self-heals on the next morning tick instead of waiting for the
 * boot backfill to notice a whole-gameweek gap.
 *
 * Cups use the same window: their league phase is one matchday every week or
 * two, so a three-week lookahead is what keeps the next round on the feed.
 */
export function pollWindow(_league: string): { back: number; forward: number } {
  return { back: 7, forward: 21 };
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
  /**
   * This appearance's own position, from the boxscore XI: the granular ESPN code
   * ("G", "CD-L", "AM") and its GK/DEF/MID/FWD bucket. Null when ESPN marked
   * the row "SUB" and published no real code — the squad roster is the only
   * source then, so readers fall back to the player row instead of guessing.
   */
  position: string | null;
  espn_position: string | null;
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
