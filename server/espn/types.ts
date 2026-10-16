export type LeagueSlug = "eng.1" | "esp.1" | "ita.1" | "ger.1" | "fra.1";

/** The big five domestic leagues — the ones the favorites rule is built on. */
export const LEAGUES: LeagueSlug[] = ["eng.1", "esp.1", "ita.1", "ger.1", "fra.1"];

/**
 * Domestic leagues beyond the big five — EMPTY. Trimmed to top-5 only.
 */
export const DOMESTIC_EXTRAS: LeagueSlug[] = [];

/** Every competition that owns a league table. */
export const ALL_DOMESTIC: LeagueSlug[] = [...LEAGUES];

/**
 * Cup competitions — synced alongside the big five for table exemptions only.
 * Trimmed to the competitions the fallen-aways file still tracks (Copa del Rey
 * had FallenAway rows, the rest are legacy). No new cup will be added here.
 */
export const CUPS: string[] = ["esp.copa_del_rey"];

/**
 * International football: national-team tournaments plus the club world stage.
 * These share the `teams` table with club competitions, but their sides carry
 * no domestic league (see `teamFromCompetitor`), so national teams land in the
 * app's "International" group instead of under a league tab.
 *
 * Every slug here was verified live against ESPN's scoreboard endpoint before
 * being added — a wrong slug fails silently as an empty competition.
 */
export const INTERNATIONALS: string[] = [
  "fifa.world",
  "fifa.cwc",
  "uefa.euro",
  "uefa.euroq",
  "uefa.nations",
  "fifa.worldq.uefa",
  "fifa.worldq.conmebol",
  "conmebol.america",
  "caf.nations",
  "concacaf.gold",
];

/** All domestic leagues + cups + internationals — everything the sync polls. */
export const LEAGUES_ALL: string[] = [...ALL_DOMESTIC, ...CUPS, ...INTERNATIONALS];

/**
 * Competitions polled on the narrow sweep window instead of the wide one.
 *
 * See `pollWindow`: the international calendars are a handful of fixed
 * matchdays, so a 21-day lookahead for them is almost entirely wasted requests
 * against ESPN's unofficial API. UCL qualifying and the Super Cup are one-off
 * dates for the same reason.
 */
const NARROW_WINDOW = new Set<string>([...INTERNATIONALS, "uefa.super_cup", "uefa.champions_qual"]);

/**
 * Sweep window (days either side of today) for one competition.
 *
 * This is the knob governing our request budget: the 6-hourly sweep walks
 * every competition DAY BY DAY, so widening the catalog multiplies its call
 * count. The big five and the club cups keep the wide 21-day lookahead that
 * future-fixture browsing and prediction need; the long tail gets a week.
 */
export function pollWindow(league: string): { back: number; forward: number } {
  return NARROW_WINDOW.has(league) ? { back: 1, forward: 7 } : { back: 1, forward: 21 };
}

/**
 * True for every competition WITHOUT a league table — cups and international
 * tournaments alike. It also carries the "this competition does not own a
 * club's domestic league" meaning used by the team upsert, which is what stops
 * a Real Madrid synced from a Champions League scoreboard from claiming
 * uefa.champions as its own league.
 */
export function isCup(league: string): boolean {
  return !ALL_DOMESTIC.includes(league as LeagueSlug);
}

/** Seeded competition labels — the display names users browse by. */
export const COMPETITIONS: Array<{
  slug: string;
  name: string;
  kind: "league";
}> = [
  { slug: "eng.1", name: "Premier League", kind: "league" },
  { slug: "esp.1", name: "La Liga", kind: "league" },
  { slug: "ita.1", name: "Serie A", kind: "league" },
  { slug: "ger.1", name: "Bundesliga", kind: "league" },
  { slug: "fra.1", name: "Ligue 1", kind: "league" },
];

/**
 * "halftime" is a real status, not a flavour of live: the Sub Predictor's
 * lock rule needs it. ESPN stays state:"in" through the break — the
 * description/shortDetail ("Halftime" / "HT") is the only reliable signal.
 */
export type OurStatus = "scheduled" | "live" | "halftime" | "finished";

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
