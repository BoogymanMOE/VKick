export type LeagueSlug =
  // Big five domestic leagues
  | "eng.1"
  | "esp.1"
  | "ita.1"
  | "ger.1"
  | "fra.1"
  // UEFA club competitions
  | "uefa.champions"
  | "uefa.europa"
  | "uefa.europa.conf"
  | "uefa.super_cup"
  | "uefa.champions_qual"
  // Domestic cups (the big five's own)
  | "eng.fa"
  | "eng.league_cup"
  | "esp.copa_del_rey"
  | "ita.coppa_italia"
  | "ger.dfb_pokal"
  | "fra.coupe_de_france"
  // International tournaments — national teams and the club world stage
  | "fifa.world"
  | "fifa.cwc"
  | "uefa.euro"
  | "uefa.euroq"
  | "uefa.nations"
  | "fifa.worldq.uefa"
  | "fifa.worldq.conmebol"
  | "conmebol.america"
  | "caf.nations"
  | "concacaf.gold";

/** The big five domestic leagues — the ones the favorites rule is built on. */
export const LEAGUES: LeagueSlug[] = ["eng.1", "esp.1", "ita.1", "ger.1", "fra.1"];

/**
 * Club cup competitions synced alongside the leagues (all confirmed on ESPN).
 * These are the big five's own cups plus the UEFA club competitions.
 */
export const CUPS: LeagueSlug[] = [
  "uefa.champions",
  "uefa.europa",
  "uefa.europa.conf",
  "uefa.super_cup",
  "uefa.champions_qual",
  "eng.fa",
  "eng.league_cup",
  "esp.copa_del_rey",
  "ita.coppa_italia",
  "ger.dfb_pokal",
  "fra.coupe_de_france",
];

/**
 * International football: national-team tournaments plus the club world stage.
 * These share the `teams` table with club competitions, but their sides carry
 * no domestic league (see `teamFromCompetitor`), so national teams land in the
 * app's "International" group instead of under a league tab.
 *
 * Every slug here was verified live against ESPN's scoreboard endpoint before
 * being added — a wrong slug fails silently as an empty competition.
 */
export const INTERNATIONALS: LeagueSlug[] = [
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

/** Big five + cups + internationals — everything the sync polls. */
export const LEAGUES_ALL: LeagueSlug[] = [...LEAGUES, ...CUPS, ...INTERNATIONALS];

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
  return !LEAGUES.includes(league as LeagueSlug);
}

/** Seeded competition labels — the display names users browse by. */
export const COMPETITIONS: Array<{
  slug: LeagueSlug;
  name: string;
  kind: "league" | "cup" | "tournament";
}> = [
  { slug: "eng.1", name: "Premier League", kind: "league" },
  { slug: "esp.1", name: "La Liga", kind: "league" },
  { slug: "ita.1", name: "Serie A", kind: "league" },
  { slug: "ger.1", name: "Bundesliga", kind: "league" },
  { slug: "fra.1", name: "Ligue 1", kind: "league" },
  { slug: "uefa.champions", name: "UEFA Champions League", kind: "cup" },
  { slug: "uefa.europa", name: "UEFA Europa League", kind: "cup" },
  { slug: "uefa.europa.conf", name: "UEFA Conference League", kind: "cup" },
  { slug: "uefa.super_cup", name: "UEFA Super Cup", kind: "cup" },
  { slug: "uefa.champions_qual", name: "UEFA Champions League Qualifying", kind: "cup" },
  { slug: "eng.fa", name: "English FA Cup", kind: "cup" },
  { slug: "eng.league_cup", name: "English Carabao Cup", kind: "cup" },
  { slug: "esp.copa_del_rey", name: "Spanish Copa del Rey", kind: "cup" },
  { slug: "ita.coppa_italia", name: "Coppa Italia", kind: "cup" },
  { slug: "ger.dfb_pokal", name: "German Cup", kind: "cup" },
  { slug: "fra.coupe_de_france", name: "Coupe de France", kind: "cup" },
  // International tournaments (national teams). `kind: "tournament"` is what
  // Browse groups separately and what tells the picker these are not clubs.
  { slug: "fifa.world", name: "FIFA World Cup", kind: "tournament" },
  { slug: "uefa.euro", name: "UEFA European Championship", kind: "tournament" },
  { slug: "uefa.euroq", name: "UEFA European Championship Qualifying", kind: "tournament" },
  { slug: "uefa.nations", name: "UEFA Nations League", kind: "tournament" },
  { slug: "fifa.worldq.uefa", name: "FIFA World Cup Qualifying — UEFA", kind: "tournament" },
  { slug: "fifa.worldq.conmebol", name: "FIFA World Cup Qualifying — CONMEBOL", kind: "tournament" },
  { slug: "conmebol.america", name: "Copa América", kind: "tournament" },
  { slug: "caf.nations", name: "Africa Cup of Nations", kind: "tournament" },
  { slug: "concacaf.gold", name: "CONCACAF Gold Cup", kind: "tournament" },
  { slug: "fifa.cwc", name: "FIFA Club World Cup", kind: "tournament" },
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
}
