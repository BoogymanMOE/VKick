/**
 * The staleness sentinel: sync has two silent failure modes — the loop stops
 * being scheduled (a dead cron, an exception inside the pass), and the loop
 * keeps running but ESPN answers with nothing useful (shape change, rate
 * limit). Both leave the feed showing yesterday's football with no error
 * anywhere. This module is the signal for both:
 *
 *  - a live match whose row has not been touched for 15+ minutes → stale;
 *  - a sync pass that has not COMPLETED for 30+ minutes → the loop is dead;
 *  - a followed competition with no fixture within ±7 days → the sync for it
 *    is producing (or being fed) nothing.
 *
 * Everything takes `db` as an argument rather than closing over `getDb()`, so
 * tests can drive it against a temp database like every other server module.
 * The alert sender is a callback so the Telegram wiring (which needs a bot
 * instance) stays in the caller and the logic here stays testable.
 */
import { all, get, type DB } from "../db/index.js";

/** A live match untouched for this long means the summary path is broken. */
const STALE_LIVE_MS = 15 * 60_000;
/** A pass that has not completed for this long means the loop is dead. */
const DEAD_LOOP_MS = 30 * 60_000;
/** Minimum spacing between repeated alerts — matchday moments are noisy. */
const ALERT_COOLDOWN_MS = 30 * 60_000;

interface PassState {
  /** Epoch ms of the last sync pass that completed without throwing. */
  lastOkMs: number | null;
  /** Completed passes since the last completed one (0 = healthy). */
  consecutiveFailures: number;
  /** Epoch ms of the last alert actually sent (cooldown reference). */
  lastAlertMs: number;
}

const state: PassState = { lastOkMs: null, consecutiveFailures: 0, lastAlertMs: 0 };

/** Reset for tests; production code never calls this. */
export function resetSentinelStateForTest(): void {
  state.lastOkMs = null;
  state.consecutiveFailures = 0;
  state.lastAlertMs = 0;
}

/** Record one sync pass that finished (0 new rows is still a finished pass). */
export function recordSyncPassOk(): void {
  state.lastOkMs = Date.now();
  state.consecutiveFailures = 0;
}

/** Record one sync pass that threw. */
export function recordSyncPassFail(): void {
  state.consecutiveFailures += 1;
}

export function syncPassHealth(): { lastOkMs: number | null; consecutiveFailures: number } {
  return { lastOkMs: state.lastOkMs, consecutiveFailures: state.consecutiveFailures };
}

export interface LeagueSyncRow {
  league: string;
  lastSyncedAt: string | null;
}

export interface SyncHealthSnapshot {
  /** Newest last_synced_at across all matches — "the data is as fresh as this". */
  latestLastSyncedAt: string | null;
  /** Live/halftime matches whose row is STALE_LIVE_MS old or more. */
  staleLive: number;
  liveCount: number;
  scheduledCount: number;
  finishedCount: number;
  /** Per-league freshness, for the endpoint consumer to display or alert on. */
  perLeague: LeagueSyncRow[];
  /** Followed competitions with no fixture within ±7 days of now. */
  quietFollowedLeagues: string[];
  lastOkSyncAt: string | null;
  consecutiveFailures: number;
}

/**
 * One SQL snapshot of everything the sentinel knows. Read-only: safe to call
 * from an unauthenticated ops route (it exposes ledger dates and league slugs,
 * nothing user-owned).
 */
export function syncHealthSnapshot(db: DB, now: Date = new Date()): SyncHealthSnapshot {
  const counts = get<{ live: number; scheduled: number; finished: number }>(
    db,
    `SELECT
       SUM(CASE WHEN status IN ('live','halftime') THEN 1 ELSE 0 END) AS live,
       SUM(CASE WHEN status = 'scheduled' THEN 1 ELSE 0 END) AS scheduled,
       SUM(CASE WHEN status = 'finished' THEN 1 ELSE 0 END) AS finished
     FROM matches`,
  );
  const latest = get<{ t: string | null }>(
    db,
    "SELECT MAX(last_synced_at) AS t FROM matches WHERE last_synced_at IS NOT NULL",
  );
  const perLeague = all<LeagueSyncRow>(
    db,
    `SELECT league, MAX(last_synced_at) AS lastSyncedAt
     FROM matches WHERE last_synced_at IS NOT NULL GROUP BY league ORDER BY league ASC`,
  );

  const nowMs = now.getTime();
  const staleLive =
    get<{ n: number }>(
      db,
      `SELECT COUNT(*) AS n FROM matches
       WHERE status IN ('live','halftime')
         AND last_synced_at IS NOT NULL
         AND last_synced_at <= ?`,
      [new Date(nowMs - STALE_LIVE_MS).toISOString()],
    )?.n ?? 0;

  const quiet = all<{ league: string }>(
    db,
    `SELECT DISTINCT f.league AS league FROM followed_leagues f
     WHERE NOT EXISTS (
       SELECT 1 FROM matches m
       WHERE m.league = f.league
         AND m.kickoff_at >= ? AND m.kickoff_at <= ?
     )`,
    [new Date(nowMs - 7 * 24 * 3_600_000).toISOString(), new Date(nowMs + 7 * 24 * 3_600_000).toISOString()],
  );

  return {
    latestLastSyncedAt: latest?.t ?? null,
    staleLive: staleLive ?? 0,
    liveCount: counts?.live ?? 0,
    scheduledCount: counts?.scheduled ?? 0,
    finishedCount: counts?.finished ?? 0,
    perLeague: perLeague.map((r) => ({ league: r.league, lastSyncedAt: r.lastSyncedAt })),
    quietFollowedLeagues: quiet.map((r) => r.league),
    lastOkSyncAt: state.lastOkMs ? new Date(state.lastOkMs).toISOString() : null,
    consecutiveFailures: state.consecutiveFailures,
  };
}

export interface SentinelCheck {
  /** True when an alert was sent on this call (cooldown allowed it). */
  alerted: boolean;
  /** Human-readable line describing the worst finding; null when healthy. */
  problem: string | null;
}

/**
 * The cron-side check: healthy data and a live loop send nothing; anything
 * wrong sends at most one alert per cooldown, in the caller-provided
 * transport, and reports the rest to the log.
 *
 * `send` never throws — the caller wraps it; a failed Telegram call must not
 * throw out of a sync pass.
 */
export function checkAndAlert(
  db: DB,
  send: (text: string) => void,
  now: Date = new Date(),
): SentinelCheck {
  const snap = syncHealthSnapshot(db, now);
  const problems: string[] = [];

  const passDead =
    (snap.lastOkSyncAt === null && snap.consecutiveFailures >= 5) ||
    (snap.lastOkSyncAt !== null &&
      now.getTime() - new Date(snap.lastOkSyncAt).getTime() > DEAD_LOOP_MS);
  if (passDead) {
    problems.push(
      `sync loop dead: no completed pass since ${snap.lastOkSyncAt ?? "boot"} ` +
        `(${snap.consecutiveFailures} consecutive failures)`,
    );
  }
  if (snap.staleLive > 0) {
    problems.push(`${snap.staleLive} live match(es) untouched for 15+ min — summary sync is not keeping up`);
  }
  if (snap.quietFollowedLeagues.length > 0) {
    problems.push(`followed league(s) with no fixture within ±7d: ${snap.quietFollowedLeagues.join(", ")}`);
  }

  if (problems.length === 0) return { alerted: false, problem: null };
  const problem = problems.join("; ");

  const cooldownOver = now.getTime() - state.lastAlertMs >= ALERT_COOLDOWN_MS;
  if (cooldownOver) {
    state.lastAlertMs = now.getTime();
    send(`[vkick] sync sentinel: ${problem}`);
    return { alerted: true, problem };
  }
  return { alerted: false, problem };
}
