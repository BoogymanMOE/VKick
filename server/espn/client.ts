import { LEAGUES_ALL, type LeagueSlug } from "./types.js";

const BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer";

/**
 * The standings feed lives on a DIFFERENT API version than the rest of the app
 * (`/apis/v2/…`, not `/apis/site/v2/…`). It matters: the per-match summary
 * endpoint also returns a standings block, but it publishes only
 * gamesPlayed/wins/ties/losses/points/rank — no goals for or against — so a
 * table built from it shows a goal-difference column of zeros. The v2 endpoint
 * carries the full set (pointsFor/pointsAgainst/pointDifferential).
 */
const BASE_V2 = "https://site.api.espn.com/apis/v2/sports/soccer";

export class EspnError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "EspnError";
  }
}

async function fetchJson(url: string, retries = 2): Promise<any> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(15_000),
        headers: { accept: "application/json" },
      });
      if (!res.ok) throw new EspnError(`HTTP ${res.status} for ${url}`, res.status);
      return (await res.json()) as any;
    } catch (err) {
      if (attempt === retries) {
        if (err instanceof EspnError) throw err;
        throw new EspnError(`fetch failed: ${String(err)}`);
      }
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  throw new EspnError("unreachable");
}

export async function fetchScoreboard(league: LeagueSlug, dates?: string): Promise<any> {
  const qs = dates ? `?dates=${encodeURIComponent(dates)}` : "";
  return fetchJson(`${BASE}/${league}/scoreboard${qs}`);
}

export async function fetchSummary(league: LeagueSlug, eventId: string): Promise<any> {
  return fetchJson(`${BASE}/${league}/summary?event=${encodeURIComponent(eventId)}`);
}

/**
 * Season standings for a whole league table (`season` = the START year, e.g.
 * 2026 for 2026-27). Returns the v2 payload: `children[].standings.entries[]`,
 * each with a real `team` object (so `team.id` is available) and the full stat
 * set including pointsFor/pointsAgainst.
 */
export async function fetchStandings(league: LeagueSlug, season: number): Promise<any> {
  return fetchJson(`${BASE_V2}/${league}/standings?season=${encodeURIComponent(String(season))}`);
}

/** Full squad for one club (site API roster endpoint, season included). */
export async function fetchTeamRoster(league: LeagueSlug, teamId: string): Promise<any> {
  return fetchJson(`${BASE}/${league}/teams/${encodeURIComponent(teamId)}/roster`);
}

export function allLeagueSlugs(): LeagueSlug[] {
  return [...LEAGUES_ALL];
}
