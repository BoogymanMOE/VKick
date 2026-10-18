/**
 * Stuck-match reconciliation — the safety net for a match whose row says
 * `live`/`halftime` long after the whistle should have gone.
 *
 * A live loop can stop mid-match (a dead cron, an ESPN shape change, a rate
 * limit), and a summary fetch that fails leaves the row exactly as it was.
 * The feed and the match page would then show a two-day-old game as "live"
 * forever. Two layers close that:
 *
 *  - the sync loop re-fetches stuck rows from ESPN and stores `finished` when
 *    the source says so (server/sync/service.ts);
 *  - this module settles them at READ time: any live/halftime row whose kickoff
 *    is older than STALE_LIVE_HOURS is served as `finished` with its last known
 *    score, and one warning line is logged per match id. Nothing is stored —
 *    the row stays as-is for the sync to repair, and a match that genuinely is
 *    still running (a delayed kickoff) is untouched.
 *
 * Kept as a pure function so the route and the tests share one rule.
 */

/** A live/halftime match older than this is treated as finished at read time. */
export const STALE_LIVE_HOURS = 5;
export const STALE_LIVE_MS = STALE_LIVE_HOURS * 3_600_000;

export interface LiveMatchRow {
  id: string;
  status: string;
  kickoff_at: string;
}

/** True when a row is live/halftime AND its kickoff is long past. */
export function isStaleLive(
  row: Pick<LiveMatchRow, "status" | "kickoff_at">,
  now: Date = new Date(),
): boolean {
  if (row.status !== "live" && row.status !== "halftime") return false;
  return now.getTime() - new Date(row.kickoff_at).getTime() > STALE_LIVE_MS;
}

/**
 * Return the row with a stale live/halftime status rewritten to `finished`.
 * The score is left exactly as stored — the last known score is the honest one.
 */
export function settleStaleLive<T extends LiveMatchRow>(row: T, now: Date = new Date()): T {
  if (!isStaleLive(row, now)) return row;
  console.warn(
    `[api] match ${row.id} stuck '${row.status}' >${STALE_LIVE_HOURS}h past kickoff — serving finished`,
  );
  return { ...row, status: "finished" };
}

/** Map form of settleStaleLive, for the feed's row list. */
export function settleStaleLiveAll<T extends LiveMatchRow>(rows: T[], now: Date = new Date()): T[] {
  return rows.map((row) => settleStaleLive(row, now));
}
