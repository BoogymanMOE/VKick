/**
 * A hard blocklist of clubs that must never enter the app.
 *
 * These six sides were removed by product decision. The static seed does not
 * contain them, but ESPN's sync loop discovers clubs dynamically (they play in
 * leagues/cups the catalog polls), so the block has to live in the sync itself:
 *
 *  - server/sync/upserts.ts skips them on every team upsert — no insert and no
 *    update, so a pre-existing row is frozen rather than refreshed;
 *  - server/routes/football.ts hides them from GET /api/teams and 404s
 *    GET /api/teams/:id, so they cannot appear in the picker or a team page.
 *
 * Matching is by ESPN id first (stable, exact), with a normalised-name fallback
 * for the case where a club reappears under a corrected id. The ids were taken
 * from ESPN's own team lists; Rangers is already present in our database as 257.
 *
 * Note: this blocks TEAMS. Match/standings rows that already reference a blocked
 * club are left untouched (per the "do not update them" rule); the match feed
 * inner-joins `teams`, so a blocked club with no team row drops out of the feed
 * automatically.
 */

/** ESPN team ids to block, in a stable order. */
export const BLOCKED_TEAM_IDS: readonly string[] = [
  "5", // Boca Juniors
  "16", // River Plate
  "257", // Rangers
  "440", // Dynamo Kyiv
  "819", // Flamengo
  "2029", // Palmeiras
];

const BLOCKED_TEAM_ID_SET = new Set(BLOCKED_TEAM_IDS);

/** Normalised (trimmed, lower-cased) ESPN display names to block. */
const BLOCKED_TEAM_NAMES = new Set([
  "boca juniors",
  "river plate",
  "rangers",
  "dynamo kyiv",
  "flamengo",
  "palmeiras",
]);

/** Minimal shape needed to test a team row or a normalized ESPN team. */
export interface BlockableTeam {
  id?: string | number | null;
  name?: string | null;
}

/** True when a team id is blocked. */
export function isBlockedTeamId(id: string | number | null | undefined): boolean {
  return id != null && BLOCKED_TEAM_ID_SET.has(String(id));
}

/** True when a team (id and/or name) is blocked. */
export function isBlockedTeam(team: BlockableTeam): boolean {
  if (isBlockedTeamId(team.id)) return true;
  const name = typeof team.name === "string" ? team.name.trim().toLowerCase() : "";
  return name.length > 0 && BLOCKED_TEAM_NAMES.has(name);
}

/**
 * Drop blocked rows from a team list, preserving order. Used by the read routes
 * that serve `teams` rows, so the picker and team screens never see them.
 */
export function filterOutBlockedTeams<T extends { id: string }>(rows: T[]): T[] {
  return rows.filter((row) => !isBlockedTeamId(row.id));
}
