interface ApiFixture {
  id: string;
  isResult: boolean;
  side: "h" | "a";
  h: { id: string; title: string; short_title: string };
  a: { id: string; title: string; short_title: string };
  goals: { h: string; a: string };
  xG: { h: string; a: string };
  datetime: string;
  forecast?: { w: number; d: number; l: number };
  result?: "w" | "d" | "l";
}

interface ApiPlayer {
  id: string;
  player_name: string;
  position: string;
  team_title: string;
  games: string;
  time: string;
  goals: string;
  assists: string;
  shots: string;
  key_passes: string;
  xG: string;
  xA: string;
  npg?: string;
  npxG?: string;
  xGChain?: string;
  xGBuildup?: string;
  yellow_cards?: string;
  red_cards?: string;
}

interface ApiStatRow {
  shots: string | number;
  goals: string | number;
  xG: string | number;
  against?: {
    shots: string | number;
    goals: string | number;
    xG: string | number;
  };
}

interface ApiTeamHistory {
  h_a: "h" | "a";
  xG: number;
  xGA: number;
  npxG: number;
  npxGA: number;
  ppda: { att: number; def: number };
  ppda_allowed: { att: number; def: number };
  deep: number;
  deep_allowed: number;
  scored: number;
  missed: number;
  xpts: number;
  result: "w" | "d" | "l";
  date: string;
  wins: number;
  draws: number;
  loses: number;
  pts: number;
  npxGD: number;
}

export interface NormFixture {
  understat_match_id: string;
  date_iso: string;
  is_home: boolean;
  opponent_title: string;
  goals_for: number | null;
  goals_against: number | null;
  xg: number | null;
  xga: number | null;
}

export interface NormPlayer {
  understat_id: number;
  name: string;
  position: string;
  team_title: string;
  apps: number;
  minutes: number;
  goals: number;
  assists: number;
  sh90: number;
  kp90: number;
  xg: number;
  xa: number;
  xg90: number;
  xa90: number;
}

export interface NormStatRow {
  situation: string;
  shots: number;
  goals: number;
  shots_against: number;
  goals_against: number;
  xg: number;
  xga: number;
}

function parseNum(v: string | number): number {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isNaN(n) ? 0 : n;
}

function parseIntSafe(v: string | number): number {
  const n = typeof v === "number" ? v : parseInt(v, 10);
  return Number.isNaN(n) ? 0 : n;
}

function mapUnderstatPosition(pos: string): string {
  const positions = pos.split(" ");
  const primary = positions[0];
  switch (primary) {
    case "GK":
      return "GK";
    case "D":
      return "DEF";
    case "M":
      return "MID";
    case "F":
      return "FWD";
    case "S":
      return "FWD";
    default:
      return "MID";
  }
}

export function normalizePlayersFromApi(players: ApiPlayer[]): NormPlayer[] {
  return players.map((p) => ({
    understat_id: parseIntSafe(p.id),
    name: p.player_name,
    position: mapUnderstatPosition(p.position),
    team_title: p.team_title,
    apps: parseIntSafe(p.games),
    minutes: parseIntSafe(p.time),
    goals: parseIntSafe(p.goals),
    assists: parseIntSafe(p.assists),
    sh90: p.time && parseIntSafe(p.time) > 0 ? (parseNum(p.shots) * 90) / parseIntSafe(p.time) : 0,
    kp90: p.time && parseIntSafe(p.time) > 0 ? (parseNum(p.key_passes) * 90) / parseIntSafe(p.time) : 0,
    xg: parseNum(p.xG),
    xa: parseNum(p.xA),
    xg90: p.time && parseIntSafe(p.time) > 0 ? (parseNum(p.xG) * 90) / parseIntSafe(p.time) : 0,
    xa90: p.time && parseIntSafe(p.time) > 0 ? (parseNum(p.xA) * 90) / parseIntSafe(p.time) : 0,
  }));
}

export function normalizeShotSituationsFromApi(statistics: Record<string, ApiStatRow>): NormStatRow[] {
  const situationOrder = ["OpenPlay", "FromCorner", "SetPiece", "DirectFreekick", "Penalty"];
  const situationLabels: Record<string, string> = {
    OpenPlay: "Open play",
    FromCorner: "From corner",
    SetPiece: "Set piece",
    DirectFreekick: "Direct Freekick",
    Penalty: "Penalty",
  };
  return situationOrder
    .filter((s): s is keyof typeof statistics => !!statistics[s])
    .map((s) => {
      const r = statistics[s]!;
      const against = r.against || { shots: 0, goals: 0, xG: 0 };
      return {
        situation: situationLabels[s] || s,
        shots: parseIntSafe(r.shots),
        goals: parseIntSafe(r.goals),
        shots_against: parseIntSafe(against.shots),
        goals_against: parseIntSafe(against.goals),
        xg: parseNum(r.xG),
        xga: parseNum(against.xG),
      };
    });
}

export function normalizeFixturesFromApi(dates: ApiFixture[]): NormFixture[] {
  return dates.map((f) => {
    const isHome = f.side === "h";
    const gf = isHome ? parseIntSafe(f.goals.h) : parseIntSafe(f.goals.a);
    const ga = isHome ? parseIntSafe(f.goals.a) : parseIntSafe(f.goals.h);
    const xg = isHome ? parseNum(f.xG.h) : parseNum(f.xG.a);
    const xga = isHome ? parseNum(f.xG.a) : parseNum(f.xG.h);
    const opp = isHome ? f.a.title : f.h.title;
    return {
      understat_match_id: f.id,
      date_iso: f.datetime.replace(" ", "T"),
      is_home: isHome,
      opponent_title: opp,
      goals_for: f.isResult ? gf : null,
      goals_against: f.isResult ? ga : null,
      xg: xg || null,
      xga: xga || null,
    };
  });
}

/**
 * One match as a club's own Understat history sees it: the raw date string
 * (matched against our kickoff by calendar day), which end it played, and the
 * score + xG for both teams. The league history carries no opponent name, so
 * this is deliberately team-perspective — the matcher pairs it to an ESPN
 * match by club + date + scoreline, and drops anything ambiguous.
 */
export interface NormTeamMatch {
  date: string;
  is_home: boolean;
  goals_for: number;
  goals_against: number;
  xg: number | null;
  xga: number | null;
}

/**
 * League payload -> per-team season totals. Keyed by the Understat team key
 * exactly as the API returns it (its own id/title), NOT by our ESPN team id —
 * callers must translate (see sync/understat.ts) before looking a team up.
 */
export interface NormTeamHistory {
  team_id: string;
  xg: number;
  xga: number;
  npxG: number;
  npxGA: number;
  /** Season sum of per-match expected points — the "expected table" input. */
  xpts: number;
  /** Mean passes-allowed-per-defensive-action; null when no match had both. */
  ppda: number | null;
  /** Completed passes into the final 20m, summed. */
  deep: number;
  /** Matches walked, so callers can average per-game figures. */
  matches: number;
  /** The same walk, per match — the per-match xG table's raw material. */
  results: NormTeamMatch[];
}

/**
 * League payload -> the clubs we can honestly label, joined on abbreviation.
 *
 * The league walk covers every side in a division, but Understat names them
 * itself, so a key only earns a row when it resolves through the static slug
 * table AND that abbreviation is a club we have synced. Anything that doesn't
 * resolve is dropped on purpose: an expected table with a mislabelled row is
 * worse than a shorter one, and callers already render "no data" for the rest.
 */
export function matchLeagueHistory(
  history: Record<string, NormTeamHistory>,
  teams: Array<{ id: string; abbreviation: string | null }>,
  abbrBySlug: Record<string, string>,
): Array<{ team_id: string; stats: NormTeamHistory }> {
  const idByAbbr = new Map<string, string>();
  for (const team of teams) {
    if (team.abbreviation) idByAbbr.set(team.abbreviation.toUpperCase(), team.id);
  }
  const matched: Array<{ team_id: string; stats: NormTeamHistory }> = [];
  for (const [key, stats] of Object.entries(history)) {
    // Understat keys are titles with underscores, but the space form leaks
    // through in some payloads — normalise to the underscore map we own.
    const abbr = abbrBySlug[key.replace(/ /g, "_")];
    if (!abbr) continue;
    const teamId = idByAbbr.get(abbr.toUpperCase());
    if (!teamId) continue;
    matched.push({ team_id: teamId, stats });
  }
  return matched;
}

/** UTC calendar day ("YYYY-MM-DD") of an ISO-ish timestamp, or null. */
function utcDay(value: string | null | undefined): string | null {
  if (!value) return null;
  const iso = value.includes("T") ? value : value.replace(" ", "T");
  // Understat dates are bare "2026-08-15 14:00:00"; Date.parse wants a zone.
  const zoned = /(Z|[+-]\d\d:?\d\d)$/.test(iso) ? iso : `${iso}Z`;
  const ms = Date.parse(zoned);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

/** Whole days between two "YYYY-MM-DD" strings; Infinity when unparseable. */
function dayDistance(a: string, b: string): number {
  const ta = Date.parse(`${a}T00:00:00Z`);
  const tb = Date.parse(`${b}T00:00:00Z`);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return Infinity;
  return Math.abs(ta - tb) / 86_400_000;
}

/** One of a club's ESPN matches, from that club's own perspective. */
export interface EspnTeamMatch {
  id: string;
  kickoff_at: string;
  is_home: boolean;
  goals_for: number | null;
  goals_against: number | null;
}

/** A matched row ready for `match_understat_stats` (club perspective). */
export interface MatchXgRow {
  match_id: string;
  xg: number | null;
  xga: number | null;
}

/**
 * Pair one club's Understat history with its ESPN matches.
 *
 * Understat's league history carries no opponent name, only the date, the end
 * the club played and the scoreline — so a fixture earns a match only when the
 * side (home/away), both goal counts and a within-a-day kickoff all line up,
 * and exactly one candidate does. Two identical scorelines in the same window
 * are dropped rather than guessed: a wrong xG on a replay is worse than none.
 * `xg`/`xga` stay in the club's own perspective.
 */
export function matchResultsToMatches(results: NormTeamMatch[], matches: EspnTeamMatch[]): MatchXgRow[] {
  const dated = results
    .map((r) => ({ ...r, day: utcDay(r.date) }))
    .filter((r): r is NormTeamMatch & { day: string } => r.day !== null);

  const rows: MatchXgRow[] = [];
  for (const match of matches) {
    if (match.goals_for == null || match.goals_against == null) continue;
    const day = utcDay(match.kickoff_at);
    if (!day) continue;
    const hits = dated.filter(
      (r) =>
        r.is_home === match.is_home &&
        r.goals_for === match.goals_for &&
        r.goals_against === match.goals_against &&
        dayDistance(r.day, day) <= 1,
    );
    if (hits.length !== 1) continue;
    const hit = hits[0];
    if (!hit) continue;
    rows.push({ match_id: match.id, xg: hit.xg, xga: hit.xga });
  }
  return rows;
}

export function normalizeTeamHistoryFromApi(
  teams: Record<string, { id: string; title: string; history: ApiTeamHistory[] }>,
): Record<string, NormTeamHistory> {
  const result: Record<string, NormTeamHistory> = {};
  for (const [key, team] of Object.entries(teams)) {
    let totalXg = 0;
    let totalXga = 0;
    let totalNpxG = 0;
    let totalNpxGA = 0;
    let totalXpts = 0;
    let totalDeep = 0;
    // PPDA is att/def, so it has to be re-derived from the season totals —
    // averaging per-match ratios would weight a 1-pass game the same as a full
    // one. Understat omits it on some rows, hence the guards.
    let ppdaAtt = 0;
    let ppdaDef = 0;
    let count = 0;
    const results: NormTeamMatch[] = [];
    for (const m of team.history) {
      totalXg += m.xG;
      totalXga += m.xGA;
      totalNpxG += m.npxG;
      totalNpxGA += m.npxGA;
      totalXpts += m.xpts ?? 0;
      totalDeep += m.deep ?? 0;
      ppdaAtt += m.ppda?.att ?? 0;
      ppdaDef += m.ppda?.def ?? 0;
      count++;
      results.push({
        date: String(m.date ?? ""),
        is_home: m.h_a === "h",
        goals_for: parseIntSafe(m.scored),
        goals_against: parseIntSafe(m.missed),
        xg: m.xG == null ? null : parseNum(m.xG),
        xga: m.xGA == null ? null : parseNum(m.xGA),
      });
    }
    result[key] = {
      team_id: team.id,
      xg: count > 0 ? totalXg : 0,
      xga: count > 0 ? totalXga : 0,
      npxG: count > 0 ? totalNpxG : 0,
      npxGA: count > 0 ? totalNpxGA : 0,
      xpts: count > 0 ? totalXpts : 0,
      ppda: ppdaDef > 0 ? ppdaAtt / ppdaDef : null,
      deep: count > 0 ? totalDeep : 0,
      matches: count,
      results,
    };
  }
  return result;
}
