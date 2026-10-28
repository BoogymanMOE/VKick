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

async function fetchJsonWithRetry(url: string, options: RequestInit = {}, attempts = 3): Promise<unknown> {
  for (let i = 0; i < attempts; i++) {
    await politeDelay();
    const headers = {
      "User-Agent": UA,
      Accept: "application/json",
      "X-Requested-With": "XMLHttpRequest",
      Referer: BASE + "/",
      ...options.headers,
    };

    let res: Response;
    try {
      res = await fetch(url, { ...options, headers, signal: AbortSignal.timeout(15_000) });
    } catch (err) {
      // Network failures and timeouts are transient; retry with backoff.
      if (i === attempts - 1) throw err;
      await new Promise((r) => setTimeout(r, 5000 * (i + 1)));
      continue;
    }

    if (res.ok) return res.json();
    // Understat doesn't cover this team/season — not an error, just empty.
    if (res.status === 404) return null;

    if (res.status === 429) {
      // Honor Retry-After (seconds or HTTP date), capped to avoid a long stall.
      const retryAfter = res.headers.get("retry-after");
      const retryAt = retryAfter === null ? Number.NaN : Date.parse(retryAfter);
      const retrySeconds = retryAfter === null ? Number.NaN : Number(retryAfter);
      const waitMs = Number.isFinite(retrySeconds)
        ? retrySeconds * 1000
        : Number.isFinite(retryAt)
          ? Math.max(0, retryAt - Date.now())
          : 5000 * (i + 1);
      if (i === attempts - 1) throw new Error(`Understat 429 after ${attempts} attempts: ${url}`);
      await new Promise((r) => setTimeout(r, Math.min(Math.max(waitMs, 0), 30_000)));
      continue;
    }

    // Other 4xx responses are permanent — retrying will not help.
    if (res.status >= 400 && res.status < 500) {
      throw new Error(`Understat ${res.status} (permanent): ${url}`);
    }

    // Server errors are transient; back off before trying again.
    if (i === attempts - 1) throw new Error(`Understat HTTP ${res.status} after ${attempts} attempts: ${url}`);
    await new Promise((r) => setTimeout(r, 5000 * (i + 1)));
  }
  throw new Error(`Understat failed after ${attempts} attempts: ${url}`);
}

export async function fetchTeamData(teamSlug: string, season: number): Promise<unknown> {
  return fetchJsonWithRetry(`${BASE}/getTeamData/${teamSlug}/${season}`);
}

export async function fetchLeagueData(leagueSlug: string, season: number): Promise<unknown> {
  const league = LEAGUE_SLUGS[leagueSlug] || leagueSlug;
  return fetchJsonWithRetry(`${BASE}/getLeagueData/${league}/${season}`);
}

export async function fetchPlayerStats(
  teamSlug: string,
  season: number,
  filters?: Record<string, string>,
): Promise<unknown> {
  const body = new URLSearchParams({ team: teamSlug, season: String(season), ...filters });
  return fetchJsonWithRetry(`${BASE}/main/getPlayersStats/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
    body: body.toString(),
  });
}
