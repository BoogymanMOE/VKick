import { fetchTeamData, fetchLeagueData } from "../understat/client.js";
import {
  matchLeagueHistory,
  matchResultsToMatches,
  normalizePlayersFromApi,
  normalizeShotSituationsFromApi,
  normalizeTeamHistoryFromApi,
} from "../understat/normalize.js";
import { TEAM_SLUGS, LEAGUE_SLUGS, ABBR_BY_SLUG } from "../understat/ids.js";
import { getDb } from "../db/index.js";
import {
  upsertLeagueUnderstatSummary,
  upsertMatchUnderstatXg,
  upsertPlayerUnderstat,
  upsertTeamUnderstat,
  upsertShotSituations,
} from "./upserts.js";

const db = getDb();
const SEASON = Number(process.env.UNDERSTAT_TEST_SEASON ?? 2026);
const STALE_MS = 6 * 60 * 60 * 1000;

async function shouldSkipTeam(teamId: string): Promise<boolean> {
  const row = db
    .prepare("SELECT last_synced_at FROM team_understat_stats WHERE team_id = ? AND season = ?")
    .get(teamId, SEASON) as { last_synced_at?: number } | undefined;
  const lastSynced = row?.last_synced_at ?? 0;
  return Date.now() - lastSynced < STALE_MS;
}

export async function syncTeamUnderstat(teamAbbr: string, teamId: string, league: string): Promise<void> {
  const slug = TEAM_SLUGS[teamAbbr];
  if (!slug) {
    console.warn(`[understat] no slug for ${teamAbbr}, skipping`);
    return;
  }
  if (await shouldSkipTeam(teamId)) {
    console.log(`[understat] ${teamAbbr} fresh, skipping`);
    return;
  }

  const [teamData, leagueData] = await Promise.all([
    fetchTeamData(slug, SEASON),
    fetchLeagueData(league, SEASON),
  ]);
  if (!teamData) {
    console.warn(`[understat] no data for ${teamAbbr} (${slug})`);
    return;
  }
  const now = Date.now();

  // Players
  const players = normalizePlayersFromApi(teamData.players);
  for (const p of players) {
    upsertPlayerUnderstat({
      understat_id: p.understat_id,
      name: p.name,
      team_id: teamId,
      league,
      season: SEASON,
      apps: p.apps,
      minutes: p.minutes,
      goals: p.goals,
      assists: p.assists,
      sh90: p.sh90,
      kp90: p.kp90,
      xg: p.xg,
      xa: p.xa,
      xg90: p.xg90,
      xa90: p.xa90,
      last_synced_at: now,
    });
  }

  // Shot situations
  const situations = normalizeShotSituationsFromApi(teamData.statistics.situation);
  upsertShotSituations(teamId, league, SEASON, situations, now);

  // Team aggregates from league data (has full history with xG/xGA per match).
  // League history is keyed by Understat's own team ids/titles — NOT by our
  // ESPN team id, so look the side up by its Understat slug, with the slug's
  // underscore title as the fallback key. A miss falls through to the
  // per-fixture sum below instead of writing zeros.
  let xgTotal = 0;
  let xgaTotal = 0;
  let xpts: number | null = null;
  let ppda: number | null = null;
  let deep: number | null = null;
  let historyHit = false;
  if (leagueData?.teams) {
    const teamHistory = normalizeTeamHistoryFromApi(leagueData.teams);
    const candidates = [slug, slug.replace(/_/g, " ")];
    for (const key of candidates) {
      const myTeam = teamHistory[key];
      if (myTeam && (myTeam.xg > 0 || myTeam.xga > 0)) {
        xgTotal = myTeam.xg;
        xgaTotal = myTeam.xga;
        xpts = myTeam.xpts;
        ppda = myTeam.ppda;
        deep = myTeam.deep;
        historyHit = true;
        break;
      }
    }
  }

  // Fallback: sum from team data dates (fixtures) — used when the league
  // history lookup missed, so a wrong key never silently writes 0 xG.
  if (!historyHit && teamData.dates) {
    for (const m of teamData.dates) {
      const isHome = m.side === "h";
      const xg = isHome ? parseFloat(m.xG.h) : parseFloat(m.xG.a);
      const xga = isHome ? parseFloat(m.xG.a) : parseFloat(m.xG.h);
      if (!isNaN(xg)) xgTotal += xg;
      if (!isNaN(xga)) xgaTotal += xga;
    }
  }

  upsertTeamUnderstat({
    team_id: teamId,
    season: SEASON,
    league,
    xg: xgTotal || null,
    xga: xgaTotal || null,
    xg_for_total: xgTotal || null,
    xg_against_total: xgaTotal || null,
    // Only meaningful when the league-history walk actually matched: the
    // per-fixture fallback above has no xPts or pressing numbers.
    xpts: historyHit ? xpts : null,
    ppda: historyHit ? ppda : null,
    deep: historyHit ? deep : null,
    last_synced_at: now,
  });

  console.log(
    `[understat] ${teamAbbr} done — ${players.length} players, ${situations.length} situations, xG: ${xgTotal.toFixed(2)}, xGA: ${xgaTotal.toFixed(2)}`,
  );
}

/**
 * One pass per league over the Understat league payload — the same file the
 * per-club walk reads, but here every side in the division gets its season
 * totals written, not just the followed ones.
 *
 * This is what makes an expected-points table possible at all: xPts only exists
 * as a per-match field on the history rows, so the league payload is the only
 * source that covers a whole table. Fetched once per league (the per-club walk
 * fetches it once per club), and players/shot situations are deliberately NOT
 * written here — those stay a followed-club, weekly job.
 */
export async function syncLeagueUnderstatTables(): Promise<void> {
  for (const [leagueSlug, understatLeague] of Object.entries(LEAGUE_SLUGS)) {
    let leagueData: unknown;
    try {
      leagueData = await fetchLeagueData(leagueSlug, SEASON);
    } catch (err) {
      console.error(`[understat] league ${understatLeague} fetch failed:`, err);
      continue;
    }
    const teams = (leagueData as { teams?: Record<string, unknown> } | null)?.teams;
    if (!teams) {
      console.warn(`[understat] league ${understatLeague} returned no teams`);
      continue;
    }

    const history = normalizeTeamHistoryFromApi(teams as Parameters<typeof normalizeTeamHistoryFromApi>[0]);
    const local = db.prepare("SELECT id, abbreviation FROM teams WHERE league = ?").all(leagueSlug) as {
      id: string;
      abbreviation: string | null;
    }[];
    const matched = matchLeagueHistory(history, local, ABBR_BY_SLUG);

    // One statement, reused for every club: its finished matches, from its own
    // perspective (is_home plus the goals it scored/conceded).
    const matchStmt = db.prepare(`
      SELECT m.id, m.kickoff_at,
             (m.home_team_id = ?) AS is_home,
             CASE WHEN m.home_team_id = ? THEN m.home_score ELSE m.away_score END AS goals_for,
             CASE WHEN m.home_team_id = ? THEN m.away_score ELSE m.home_score END AS goals_against
      FROM matches m
      WHERE m.status = 'finished' AND (m.home_team_id = ? OR m.away_team_id = ?)
    `);

    let written = 0;
    for (const { team_id, stats } of matched) {
      // Early season: a side with no completed match would otherwise land a
      // 0.00 xG row and sort as the division's worst attack.
      if (stats.matches === 0) continue;
      upsertLeagueUnderstatSummary({
        team_id,
        season: SEASON,
        league: leagueSlug,
        xg: stats.xg,
        xga: stats.xga,
        xpts: stats.xpts,
        ppda: stats.ppda,
        deep: stats.deep,
      });
      // Per-match xG for the replay pitch: pair this club's Understat history
      // with its finished local matches by side, both goal counts and a
      // within-a-day kickoff. Ambiguous or unmatchable rows are dropped.
      const localMatches = matchStmt.all(team_id, team_id, team_id, team_id, team_id) as Array<{
        id: string;
        kickoff_at: string;
        is_home: number;
        goals_for: number | null;
        goals_against: number | null;
      }>;
      const xgRows = matchResultsToMatches(
        stats.results,
        localMatches.map((m) => ({
          id: m.id,
          kickoff_at: m.kickoff_at,
          is_home: m.is_home === 1,
          goals_for: m.goals_for,
          goals_against: m.goals_against,
        })),
      );
      if (xgRows.length > 0) {
        upsertMatchUnderstatXg(xgRows.map((r) => ({ ...r, team_id })));
      }
      written++;
    }
    console.log(`[understat] league ${understatLeague}: ${written}/${local.length} team rows`);
  }
}

export async function syncAllFavoriteTeamsUnderstat(): Promise<void> {
  const rows = db
    .prepare(
      `
    SELECT DISTINCT t.id, t.abbreviation, t.league
    FROM favorite_teams ft
    JOIN teams t ON t.id = ft.team_id
    WHERE t.league IN ('eng.1','esp.1','ita.1','ger.1','fra.1')
  `,
    )
    .all() as { id: string; abbreviation: string; league: string }[];

  for (const t of rows) {
    try {
      await syncTeamUnderstat(t.abbreviation, t.id, t.league);
    } catch (err) {
      console.error(`[understat] failed ${t.abbreviation}:`, err);
    }
  }
}
