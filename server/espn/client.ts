import { LEAGUES_ALL, type LeagueSlug } from "./types.js";

const BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer";

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

/** Full squad for one club (site API roster endpoint, season included). */
export async function fetchTeamRoster(league: LeagueSlug, teamId: string): Promise<any> {
  return fetchJson(`${BASE}/${league}/teams/${encodeURIComponent(teamId)}/roster`);
}

export function allLeagueSlugs(): LeagueSlug[] {
  return [...LEAGUES_ALL];
}
