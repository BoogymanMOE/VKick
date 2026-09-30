/**
 * ESPN normalization layer — the only file that knows ESPN's response shapes.
 * If ESPN changes something, fix it here and nothing downstream notices.
 *
 * Field shapes verified against real payloads captured in `.tmp/`
 * (scoreboard, pre-match summary, post-match summary).
 *
 * ESPN quirks confirmed from samples:
 * - `rosters[]` (not `boxscore.teams[].roster[]`) carries per-player stats
 * - roster stats have no minutes; derive from starter/sub flags + sub events
 * - summary standings carry GP/W/D/L/points/rank only (no goals for/against)
 * - `header.competitions[0].details[]` are goals/cards; keyEvents[] is the curated timeline
 */
import type {
  NormCommentaryLine,
  NormMatch,
  NormPlayer,
  NormPlayerStats,
  NormStandingRow,
  NormTeam,
  NormTimelineEvent,
  OurStatus,
} from "./types.js";

import { isCup } from "./types.js";

export type { LeagueSlug } from "./types.js";
export { LEAGUES, CUPS, LEAGUES_ALL, isCup } from "./types.js";

/* ------------------------------------------------------------ positions */

// ESPN uses granular abbreviations (CD-L, AM-R, RM...). Map to the four
// categories the stat score and lineup views need.
const POS_MAP: Record<string, "GK" | "DEF" | "MID" | "FWD"> = {
  G: "GK",
  GK: "GK",
  GDP: "GK",
  D: "DEF",
  DEF: "DEF",
  CB: "DEF",
  LB: "DEF",
  RB: "DEF",
  LWB: "DEF",
  RWB: "DEF",
  "CD-L": "DEF",
  "CD-R": "DEF",
  "CD-M": "DEF",
  "CD-C": "DEF",
  M: "MID",
  MID: "MID",
  CM: "MID",
  DM: "MID",
  AM: "MID",
  CDM: "MID",
  CAM: "MID",
  LM: "MID",
  RM: "MID",
  LCM: "MID",
  RCM: "MID",
  "DM-L": "MID",
  "DM-R": "MID",
  "DM-M": "MID",
  "M-L": "MID",
  "M-R": "MID",
  "M-M": "MID",
  "AM-L": "MID",
  "AM-R": "MID",
  "AM-M": "MID",
  LW: "MID",
  RW: "MID",
  "W-L": "MID",
  "W-R": "MID",
  F: "FWD",
  FWD: "FWD",
  ST: "FWD",
  CF: "FWD",
  SS: "FWD",
  "ST-L": "FWD",
  "ST-R": "FWD",
  "F-L": "FWD",
  "F-R": "FWD",
  "F-C": "FWD",
};

/**
 * ESPN marks anyone who wasn't in the last XI with the pseudo-position "SUB".
 * It carries no positional meaning, and returning MID for it put a centre-back
 * and a striker in the same bucket — which is what made a full squad read as
 * "GK 1, DEF 4, MID 14, FWD 1". Callers fall through to the athlete's own
 * position instead.
 */
export function isPositional(abbr: string | undefined | null): boolean {
  if (!abbr) return false;
  return !NON_POSITIONAL.has(abbr.trim().toUpperCase());
}

const NON_POSITIONAL = new Set(["SUB", "N/A", "NA", "-", "--", "NONE", "OUT", "RES"]);

export function normalizePosition(abbr: string | undefined | null): string {
  if (!abbr) return "MID"; // conservative default
  const raw = String(abbr).trim();
  const mapped = POS_MAP[raw.toUpperCase()] ?? POS_MAP[raw];
  if (mapped) return mapped;
  const a = raw.toUpperCase();
  if (a.includes("GK") || a.includes("GOALKEEPER")) return "GK";
  if (a.includes("BACK") || /^(C|L|R)?[DB]/.test(a)) return "DEF";
  if (a.includes("FWD") || a.includes("STRIKER") || a.endsWith("F")) return "FWD";
  if (a.includes("MID") || a.includes("WING")) return "MID";
  if (a.includes("FORWARD") || a.includes("ATTACK")) return "FWD";
  if (a.includes("DEF")) return "DEF";
  return "MID";
}

/** Full name forms ("Goalkeeper", "Centre-Back"), which roster feeds use when
 *  there's no abbreviation at all. */
export function normalizePositionName(name: string | undefined | null): string | null {
  if (!name) return null;
  return normalizePosition(String(name).replace(/\s+/g, "-"));
}

/* ------------------------------------------------------------ clock */

export function clockSeconds(c: { value?: number; displayValue?: string } | undefined): number {
  if (c && typeof c.value === "number") return c.value;
  const s = c?.displayValue ?? "";
  const m = s.match(/^(\d+)'?(?:\+(\d+)')?/);
  if (!m) return 0;
  const base = parseInt(m[1] as string, 10) * 60;
  const added = m[2] ? parseInt(m[2] as string, 10) * 60 : 0;
  return base + added;
}

export function minuteDisplay(c: { displayValue?: string } | undefined): string {
  return (c?.displayValue ?? "?").replace(/'/g, "");
}

/* ------------------------------------------------------------ status */

/**
 * Halftime detection: ESPN's scoreboard/summary status stays state:"in"
 * through the break — the description/shortDetail text ("Halftime", "HT",
 * localized variants like "Mitad", "پایان نیمه اول") is the only reliable
 * signal. Matches a word-boundary "HT" so "Chelsea" (…) never trips it.
 *
 * Accepted limitation (deliberate): when a league's payload never carries an
 * HT detail, the match degrades to "live until FT" — the Sub Predictor stays
 * open through the break for those games. That is preferred over a hard
 * failure or a wrongly-locked window; the text signal is the only one ESPN
 * publishes, so there is no clock-based fallback that would not guess.
 */
export function statusDetailSaysHalftime(detail: string | undefined | null): boolean {
  const s = String(detail ?? "")
    .toLowerCase()
    .trim();
  if (!s) return false;
  return s.includes("halftime") || s.includes("half time") || s.includes("half-time") || /\bht\b/.test(s);
}

export function normalizeStatus(
  state: string | undefined,
  completed: boolean | undefined,
  detail?: string | null,
): OurStatus {
  if (completed || state === "post") return "finished";
  if (state === "in") {
    if (statusDetailSaysHalftime(detail)) return "halftime";
    return "live";
  }
  return "scheduled";
}

function parseScore(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = parseInt(String(v), 10);
  return Number.isNaN(n) ? null : n;
}

/* ------------------------------------------------------------ scoreboard */

function teamFromCompetitor(comp: any, league: string): NormTeam {
  const t = comp.team ?? {};
  const isCupComp = isCup(league);
  return {
    id: String(t.id),
    name: t.displayName ?? t.name ?? `Team ${t.id}`,
    short_name: t.shortDisplayName ?? t.name ?? null,
    abbreviation: t.abbreviation ?? null,
    // Some league payloads use `logos[]`, others a bare `logo` string.
    logo_url: t.logos?.[0]?.href ?? (typeof t.logo === "string" ? t.logo : null),
    color: t.color ? `#${String(t.color).replace("#", "")}` : null,
    // A cup never claims a team's domestic league — Real Madrid stays esp.1
    // even when synced from a uefa.champions scoreboard.
    league: isCupComp ? "" : league,
  };
}

/**
 * ESPN's per-event notes carry the cup round ("UEFA Champions League " +
 * "Quarter-final"). We keep only the bare round so the Cups screen can group
 * and order fixtures into a bracket; leagues leave null and never render it.
 * Tries the event's headline and the competition's notes, since ESPN populates
 * one or the other depending on the competition.
 */
function roundFromEvent(ev: any, competition: any): string | null {
  const note: string | undefined = competition?.notes?.[0]?.headline ?? ev?.notes?.[0]?.headline ?? null;
  const source = note ?? ev?.name ?? null;
  if (!source) return null;
  const m = source.match(
    /\b(final|semi-?final|quarter-?final|round of \d+|\d+(?:st|nd|rd|th) round|round \d+|play-?off|qualifying round)\b/i,
  );
  if (!m) return null;
  const raw = m[1]!.toLowerCase();
  // Canonical display forms; "1st round" style ordinals stay as-is.
  if (raw.startsWith("final")) return "Final";
  if (raw.startsWith("semi")) return "Semi-final";
  if (raw.startsWith("quarter")) return "Quarter-final";
  if (raw.startsWith("play")) return "Play-off";
  if (raw.startsWith("qualifying")) return "Qualifying round";
  return raw.replace(/\b\w/g, (c: string) => c.toUpperCase());
}

export function normalizeScoreboard(json: any, league: string): { teams: NormTeam[]; matches: NormMatch[] } {
  const teams = new Map<string, NormTeam>();
  const matches: NormMatch[] = [];
  for (const ev of json.events ?? []) {
    const competition = ev.competitions?.[0] ?? {};
    const competitors: any[] = competition.competitors ?? [];
    const home = competitors.find((c) => c.homeAway === "home");
    const away = competitors.find((c) => c.homeAway === "away");
    if (!home || !away) continue;
    const ht = teamFromCompetitor(home, league);
    const at = teamFromCompetitor(away, league);
    teams.set(ht.id, ht);
    teams.set(at.id, at);
    const st = competition.status ?? ev.status ?? {};
    const type = st.type ?? {};
    const status = normalizeStatus(type.state, type.completed, type.description ?? type.shortDetail);
    matches.push({
      id: String(ev.id),
      league,
      home_team_id: ht.id,
      away_team_id: at.id,
      kickoff_at: ev.date,
      status,
      home_score: status === "scheduled" ? null : parseScore(home.score),
      away_score: status === "scheduled" ? null : parseScore(away.score),
      minute_display:
        status === "live" || status === "halftime" ? (type.displayClock ?? type.shortDetail ?? null) : null,
      espn_season: ev.season ? `${ev.season.year}` : null,
      round: roundFromEvent(ev, competition),
      home_formation: null,
      away_formation: null,
    });
  }
  return { teams: [...teams.values()], matches };
}

/* ------------------------------------------------------------ summary */

export function normalizeSummaryTeams(json: any): { home: NormTeam | null; away: NormTeam | null } {
  const comps: any[] = json.header?.competitions?.[0]?.competitors ?? [];
  let home: NormTeam | null = null;
  let away: NormTeam | null = null;
  for (const c of comps) {
    const norm = teamFromCompetitor(c, json.header?.league?.slug ?? "");
    if (!norm.logo_url) {
      const box = (json.boxscore?.teams ?? []).find((b: any) => String(b.team?.id) === norm.id);
      norm.logo_url = box?.team?.logo ?? null;
    }
    if (c.homeAway === "home") home = norm;
    else away = norm;
  }
  return { home, away };
}

export function normalizeSummaryMatch(json: any): NormMatch {
  const h = json.header?.competitions?.[0];
  const comps: any[] = h?.competitors ?? [];
  const home = comps.find((c) => c.homeAway === "home");
  const away = comps.find((c) => c.homeAway === "away");
  const type = h?.status?.type ?? {};
  const status = normalizeStatus(type.state, type.completed, type.description ?? type.shortDetail);
  const rosters: any[] = json.rosters ?? [];
  const homeRoster = rosters.find((r) => r.homeAway === "home");
  const awayRoster = rosters.find((r) => r.homeAway === "away");
  return {
    id: String(h?.id ?? json.header?.id ?? ""),
    league: json.header?.league?.slug ?? "",
    home_team_id: String(home?.team?.id ?? ""),
    away_team_id: String(away?.team?.id ?? ""),
    kickoff_at: h?.date ?? json.header?.gregorianDate ?? new Date().toISOString(),
    status,
    home_score: status === "scheduled" ? null : parseScore(home?.score),
    away_score: status === "scheduled" ? null : parseScore(away?.score),
    minute_display:
      status === "live" || status === "halftime" ? (type.displayClock ?? type.shortDetail ?? null) : null,
    home_formation: homeRoster?.formation ?? null,
    away_formation: awayRoster?.formation ?? null,
    espn_season: json.header?.season?.year ? `${json.header.season.year}` : null,
    round: roundFromEvent(json.header, h ?? {}),
  };
}

/* ------------------------------------------------------------ rosters */

const STAT_NAMES = {
  goals: "totalGoals",
  assists: "goalAssists",
  shots: "totalShots",
  shotsOnTarget: "shotsOnTarget",
  yellowCards: "yellowCards",
  redCards: "redCards",
  saves: "saves",
  goalsConceded: "goalsConceded",
  foulsCommitted: "foulsCommitted",
  offsides: "offsides",
  ownGoals: "ownGoals",
} as const;

function statValue(stats: any[] | undefined, name: string): number | null {
  const s = (stats ?? []).find((x) => x.name === name);
  if (!s || s.value === undefined || s.value === null) return null;
  const v = typeof s.value === "number" ? s.value : parseFloat(String(s.displayValue ?? s.value));
  return Number.isNaN(v) ? null : v;
}

/**
 * ESPN gives no minutes for field players. Derive:
 * - starter not subbed out: 90
 * - starter subbed out: minute of their sub event (fallback 80)
 * - sub: 90 minus the minute they came on (fallback 25)
 * - unused/didNotPlay: 0
 */
export function deriveMinutes(entry: any, json: any): number {
  if (entry.didNotPlay === true || (entry.stats ?? []).length === 0) return 0;
  const pid = String(entry.athlete?.id ?? "");
  if (entry.starter) {
    if (entry.subbedOut !== true) return 90;
    const out = findSubMinute(json, pid, "out");
    return out ?? 80;
  }
  if (entry.subbedIn === true) {
    const cameOn = findSubMinute(json, pid, "in");
    return cameOn !== null ? Math.max(1, 90 - cameOn) : 25;
  }
  return 0;
}

/** ESPN convention on sub keyEvents: participants[0] = on, participants[1] = off. */
function findSubMinute(json: any, playerId: string, direction: "in" | "out"): number | null {
  for (const ke of json.keyEvents ?? []) {
    const t = (ke.type?.text ?? "").toLowerCase();
    if (!t.includes("substitution")) continue;
    const parts: any[] = ke.participants ?? [];
    const idx = direction === "in" ? 0 : 1;
    const p = parts[idx]?.athlete?.id;
    if (p && String(p) === playerId) {
      const m = String(ke.clock?.displayValue ?? "").match(/^(\d+)/);
      return m ? parseInt(m[1] as string, 10) : null;
    }
  }
  return null;
}

export function normalizeRosters(json: any): {
  players: NormPlayer[];
  stats: NormPlayerStats[];
} {
  const players: NormPlayer[] = [];
  const stats: NormPlayerStats[] = [];
  for (const side of json.rosters ?? []) {
    const teamId = String(side.team?.id ?? "");
    for (const entry of side.roster ?? []) {
      const athlete = entry.athlete ?? {};
      const id = String(athlete.id ?? "");
      if (!id) continue;
      // "SUB" means "wasn't in the XI", not a position — prefer the athlete's
      // own position so the squad keeps real GK/DEF/MID/FWD buckets.
      const entryPos = entry.position?.abbreviation ?? null;
      const pos =
        (isPositional(entryPos) ? entryPos : null) ??
        athlete.position?.abbreviation ??
        normalizePositionName(athlete.position?.name ?? athlete.position?.displayName);
      const storedPos = isPositional(entryPos) ? entryPos : null;
      players.push({
        id,
        team_id: teamId,
        full_name: athlete.displayName ?? athlete.fullName ?? id,
        short_name: athlete.shortName ?? null,
        position: normalizePosition(pos),
        espn_position: storedPos,
        jersey_number:
          entry.jersey !== undefined && entry.jersey !== null ? parseInt(String(entry.jersey), 10) : null,
        headshot_url: athlete.headshot?.href ?? null,
      });
      const didNotPlay = entry.didNotPlay === true || (entry.stats ?? []).length === 0;
      stats.push({
        player_id: id,
        team_id: teamId,
        started: entry.starter === true,
        subbed_in: entry.subbedIn === true,
        subbed_out: entry.subbedOut === true,
        formation_place:
          entry.formationPlace !== undefined && entry.formationPlace !== null
            ? String(entry.formationPlace)
            : null,
        minutes_played: didNotPlay ? 0 : deriveMinutes(entry, json),
        goals: statValue(entry.stats, STAT_NAMES.goals) ?? 0,
        assists: statValue(entry.stats, STAT_NAMES.assists) ?? 0,
        shots: statValue(entry.stats, STAT_NAMES.shots) ?? 0,
        shots_on_target: statValue(entry.stats, STAT_NAMES.shotsOnTarget) ?? 0,
        yellow_cards: statValue(entry.stats, STAT_NAMES.yellowCards) ?? 0,
        red_cards: statValue(entry.stats, STAT_NAMES.redCards) ?? 0,
        saves: statValue(entry.stats, STAT_NAMES.saves),
        goals_conceded: statValue(entry.stats, STAT_NAMES.goalsConceded),
        fouls_committed: statValue(entry.stats, STAT_NAMES.foulsCommitted) ?? 0,
        offsides: statValue(entry.stats, STAT_NAMES.offsides) ?? 0,
        own_goals: statValue(entry.stats, STAT_NAMES.ownGoals) ?? 0,
      });
    }
  }
  return { players, stats };
}

/* ------------------------------------------------------------ timeline */

const EVENT_TYPE_MAP: Record<string, string> = {
  goal: "goal",
  "own goal": "goal",
  penalty: "goal",
  "penalty - scored": "goal",
  "penalty kick": "goal",
  "yellow card": "card",
  yellowcard: "card",
  "red card": "card",
  redcard: "card",
  card: "card",
  substitution: "substitution",
  sub: "substitution",
  var: "var",
  "var decision": "var",
  "video review": "var",
  kickoff: "kickoff",
  halftime: "halftime",
  "half time": "halftime",
  fulltime: "fulltime",
  "full time": "fulltime",
};

/**
 * ESPN keyEvent types include goal SUBTYPES ("Goal - Free-kick", "Goal -
 * Header", "Second Yellow Card"...) that the exact map above misses — a
 * subtype goal landing in "other" would vanish from goal feeds, the replay
 * score and the shot plot. Map by substring after the exact lookup.
 */
export function mapEventType(raw: string): string {
  const exact = EVENT_TYPE_MAP[raw];
  if (exact) return exact;
  if (raw.includes("own goal")) return "goal";
  if (raw.startsWith("goal")) return "goal"; // goal - free-kick / header / ...
  if (raw.includes("penalty - scored") || raw.includes("penalty scored")) return "goal";
  if (raw.includes("yellow") || raw.includes("red card") || raw.includes("redcard")) return "card";
  if (raw.includes("substitution") || raw === "sub") return "substitution";
  if (raw.includes("var") || raw.includes("video review")) return "var";
  if (raw.includes("half time") || raw === "halftime") return "halftime";
  if (raw.includes("full time") || raw === "fulltime") return "fulltime";
  if (raw === "kickoff") return "kickoff";
  return "other";
}

export function normalizeTimeline(json: any): NormTimelineEvent[] {
  const out: NormTimelineEvent[] = [];
  for (const ke of json.keyEvents ?? []) {
    const raw = String(ke.type?.text ?? ke.type?.type ?? "other").toLowerCase();
    const type = mapEventType(raw);
    if (type === "other" && !ke.text && !ke.shortText) continue;
    const participants = (ke.participants ?? []).map((p: any) => ({
      id: String(p.athlete?.id ?? ""),
      name: p.athlete?.displayName ?? "",
    }));
    // Shot origin + goal-line position: ESPN only fills these on goal events,
    // and only in some leagues. Null elsewhere; the replay pitch copes.
    const num = (v: unknown): number | null => {
      if (v === undefined || v === null || v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    out.push({
      espn_event_key: ke.id ? String(ke.id) : null,
      minute_display: minuteDisplay(ke.clock),
      minute_seconds: clockSeconds(ke.clock),
      type,
      team_id: ke.team?.id ? String(ke.team.id) : null,
      description: ke.text ?? ke.shortText ?? type,
      participants: JSON.stringify(participants),
      field_x: num(ke.fieldPositionX),
      field_y: num(ke.fieldPositionY),
      goal_y: num(ke.goalPositionY),
    });
  }
  return out;
}

/* ------------------------------------------------------------ commentary */

/**
 * The dense minute-by-minute feed (fouls, corners, every shot). Stored per
 * match so finished matches get a replayable commentary track.
 */
export function normalizeCommentary(json: any): NormCommentaryLine[] {
  const out: NormCommentaryLine[] = [];
  for (const line of json.commentary ?? []) {
    const text = String(line.text ?? "").trim();
    if (!text) continue;
    out.push({
      sequence: Number(line.sequence ?? out.length),
      minute_display: line.time?.displayValue ? String(line.time.displayValue) : null,
      minute_seconds: typeof line.time?.value === "number" ? line.time.value : null,
      text,
    });
  }
  return out;
}

/* ------------------------------------------------------------ rosters */

/** Coach entry from the roster endpoint (`coach[]`, first row wins). */
export function normalizeCoach(json: any): { team_id: string; name: string } | null {
  const teamId = String(json.team?.id ?? "");
  // Some league payloads nest the coach under a different key (or omit it).
  const first = (json.coach ?? json.coaches ?? json.team?.coach ?? [])[0];
  const name = [first?.firstName, first?.lastName].filter(Boolean).join(" ").trim();
  if (!teamId || !name) return null;
  return { team_id: teamId, name };
}

/**
 * Squad rows from the roster endpoint. Roster positions are granular ("G",
 * "CD-L"...), so reuse the match-roster mapping for the GK/DEF/MID/FWD buckets.
 */
export function normalizeRosterPlayers(json: any): NormPlayer[] {
  const teamId = String(json.team?.id ?? "");
  const out: NormPlayer[] = [];
  for (const a of json.athletes ?? []) {
    const id = String(a.id ?? "");
    if (!id) continue;
    const abbr = a.position?.abbreviation ?? null;
    const pos = isPositional(abbr)
      ? abbr
      : normalizePositionName(a.position?.name ?? a.position?.displayName);
    out.push({
      id,
      team_id: teamId,
      full_name: a.fullName ?? a.displayName ?? id,
      short_name: a.shortName ?? null,
      position: normalizePosition(pos),
      espn_position: abbr,
      jersey_number: a.jersey !== undefined && a.jersey !== null ? parseInt(String(a.jersey), 10) : null,
      headshot_url: a.headshot?.href ?? (typeof a.image === "string" ? a.image : null),
    });
  }
  return out;
}

/* ------------------------------------------------------------ standings */

export function normalizeStandings(json: any): {
  teams: NormTeam[];
  rows: NormStandingRow[];
} {
  const teams: NormTeam[] = [];
  const rows: NormStandingRow[] = [];
  const groups: any[] = json.standings?.groups ?? (json.standings ? [json.standings] : []);
  for (const g of groups) {
    for (const entry of g.standings?.entries ?? []) {
      const byName: Record<string, number | null> = {};
      for (const s of entry.stats ?? []) {
        byName[s.name] = s.value !== undefined && s.value !== null ? Number(s.value) : null;
      }
      const teamId = String(entry.id ?? entry.team?.id ?? "");
      // entry.team is a plain string in summary standings ("Manchester City")
      const teamObj = typeof entry.team === "object" && entry.team ? entry.team : {};
      const teamName =
        typeof entry.team === "string" && entry.team
          ? entry.team
          : (teamObj.displayName ?? teamObj.name ?? null);
      const logo =
        (Array.isArray(entry.logo) ? entry.logo?.[0]?.href : entry.logo) ?? teamObj.logos?.[0]?.href ?? null;
      teams.push({
        id: teamId,
        name: teamName ?? `Team ${teamId}`,
        short_name: teamObj.shortDisplayName ?? null,
        abbreviation: teamObj.abbreviation ?? null,
        logo_url: logo,
        color: teamObj.color ? `#${String(teamObj.color).replace("#", "")}` : null,
        league: json.header?.league?.slug ?? "",
      });
      rows.push({
        team_id: teamId,
        rank: byName["rank"] ?? null,
        played: byName["gamesPlayed"] ?? null,
        wins: byName["wins"] ?? null,
        draws: byName["ties"] ?? null,
        losses: byName["losses"] ?? null,
        goals_for: byName["pointsFor"] ?? null,
        goals_against: byName["pointsAgainst"] ?? null,
        points: byName["points"] ?? null,
      });
    }
  }
  return { teams, rows };
}
