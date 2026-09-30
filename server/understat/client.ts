import { LEAGUE_SLUGS } from "./ids.js";

const BASE = "https://understat.com";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

let lastCallAt = 0;
const MIN_INTERVAL_MS = 1500;

async function politeDelay() {
  const elapsed = Date.now() - lastCallAt;
  const wait = Math.max(0, MIN_INTERVAL_MS - elapsed);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCallAt = Date.now();
}

async function fetchJsonWithRetry(url: string, options: RequestInit = {}, attempts = 3): Promise<any> {
  for (let i = 0; i < attempts; i++) {
    await politeDelay();
    const headers = {
      "User-Agent": UA,
      Accept: "application/json",
      "X-Requested-With": "XMLHttpRequest",
      Referer: BASE + "/",
      ...options.headers,
    };
    const res = await fetch(url, { ...options, headers });
    if (res.ok) return res.json();
    if (res.status === 404) return null;
    await new Promise((r) => setTimeout(r, 5000 * (i + 1)));
  }
  throw new Error(`Understat failed after ${attempts} attempts: ${url}`);
}

export async function fetchTeamData(teamSlug: string, season: number): Promise<any> {
  return fetchJsonWithRetry(`${BASE}/getTeamData/${teamSlug}/${season}`);
}

export async function fetchLeagueData(leagueSlug: string, season: number): Promise<any> {
  const league = LEAGUE_SLUGS[leagueSlug] || leagueSlug;
  return fetchJsonWithRetry(`${BASE}/getLeagueData/${league}/${season}`);
}

export async function fetchPlayerStats(
  teamSlug: string,
  season: number,
  filters?: Record<string, string>,
): Promise<any> {
  const body = new URLSearchParams({ team: teamSlug, season: String(season), ...filters });
  return fetchJsonWithRetry(`${BASE}/main/getPlayersStats/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
    body: body.toString(),
  });
}
