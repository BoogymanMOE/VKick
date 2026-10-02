import fs from "node:fs";
import type { DB, BindValue } from "./index.js";

/**
 * Data retention: the football detail the sync keeps appending forever, on a
 * clock. Match rows themselves are never deleted — fixtures, teams and
 * standings read them — only the per-match detail tables (timeline events,
 * commentary, per-team/per-player stat sheets) and notification bookkeeping
 * grow with every gameweek. Those get pruned once a match is old enough that
 * nobody replays it: RETENTION_DAYS, default 120 (a full season window).
 *
 * opt-out: RETENTION_DAYS=0 keeps everything forever.
 */

const DAY_MS = 24 * 3_600_000;

export interface RetentionResult {
  /** Matches older than the window that still carried detail rows. */
  candidates: number;
  /** Rows actually deleted, per table (order matches the deletes). */
  deleted: Record<string, number>;
}

/** Days of finished-match detail to keep. 0 disables retention entirely. */
export function retentionDays(): number {
  const raw = process.env.RETENTION_DAYS;
  if (raw === undefined || raw.trim() === "") return 120;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Prune per-match detail for finished matches older than the window, plus the
 * push-audit rows and goal-dedupe bookkeeping that only reference them.
 * Sports tables first, then the audit tables — the cascades are declared in
 * the schema, so the order matters only for the tables without one.
 * Runs in one implicit transaction per call site; every DELETE is keyed on
 * the match cutoff so a partially-failed sweep leaves older rows, not a
 * half-pruned match.
 */
export function pruneFootballDetail(db: DB, now: number = Date.now()): RetentionResult {
  const days = retentionDays();
  if (days <= 0) return { candidates: 0, deleted: {} };

  const cutoff = new Date(now - days * DAY_MS).toISOString();
  const matchesParams: BindValue[] = [cutoff];

  // Finished matches older than the cutoff.
  const stale = db
    .prepare(`SELECT id FROM matches WHERE status = 'finished' AND kickoff_at < ?`)
    .all(...matchesParams) as Array<{ id: string }>;
  if (stale.length === 0) return { candidates: 0, deleted: {} };

  const placeholders = stale.map(() => "?").join(", ");
  const ids = stale.map((m) => m.id);

  // Nothing left to prune? (Match rows live forever, so stale ids re-select
  // every sweep — the detail check keeps the daily log honest and the no-op
  // sweep cheap instead of reporting the same backlog forever.)
  const anyDetail = db
    .prepare(
      `SELECT (
         EXISTS(SELECT 1 FROM timeline_events WHERE match_id IN (${placeholders}))
         OR EXISTS(SELECT 1 FROM match_commentary WHERE match_id IN (${placeholders}))
         OR EXISTS(SELECT 1 FROM match_team_stats WHERE match_id IN (${placeholders}))
         OR EXISTS(SELECT 1 FROM match_player_stats WHERE match_id IN (${placeholders}))
         OR EXISTS(SELECT 1 FROM match_understat_stats WHERE match_id IN (${placeholders}))
         OR EXISTS(SELECT 1 FROM notified_goals WHERE match_id IN (${placeholders}))
         OR EXISTS(SELECT 1 FROM match_notifications WHERE match_id IN (${placeholders}))
       ) AS any`,
    )
    .get(...ids) as { any: number };
  if (!anyDetail?.any) return { candidates: 0, deleted: {} };

  const deleted: Record<string, number> = {};

  // Detail tables: the replay payload reads these.
  deleted.timeline_events = runCount(db, `DELETE FROM timeline_events WHERE match_id IN (${placeholders})`, ids);
  deleted.match_commentary = runCount(db, `DELETE FROM match_commentary WHERE match_id IN (${placeholders})`, ids);
  deleted.match_team_stats = runCount(db, `DELETE FROM match_team_stats WHERE match_id IN (${placeholders})`, ids);
  deleted.match_player_stats = runCount(db, `DELETE FROM match_player_stats WHERE match_id IN (${placeholders})`, ids);
  deleted.match_understat_stats = runCount(
    db,
    `DELETE FROM match_understat_stats WHERE match_id IN (${placeholders})`,
    ids,
  );

  // Notification bookkeeping: goal-dedupe keys and per-user push audit rows.
  // Push audit rows are the audit trail of who was told what; after the
  // window they describe matches nobody can open anymore.
  deleted.notified_goals = runCount(db, `DELETE FROM notified_goals WHERE match_id IN (${placeholders})`, ids);
  deleted.match_notifications = runCount(
    db,
    `DELETE FROM match_notifications WHERE match_id IN (${placeholders})`,
    ids,
  );

  return { candidates: stale.length, deleted };
}

/** Rowcount helper: node:sqlite returns { changes } from run(). */
function runCount(db: DB, sql: string, params: BindValue[]): number {
  const res = db.prepare(sql).run(...params);
  return Number(res.changes ?? 0);
}

/* ------------------------------------------------------------ session sweep */

/** Sessions die 30 days after their last use (sliding expiry). */
export const SESSION_TTL_MS = 30 * 24 * 3_600_000;

/**
 * Delete sessions idle past the TTL. Same job as the sweep in server/index.ts,
 * re-expressed so retention (boot + daily) can run it in one place. Returns
 * the number of rows removed.
 */
export function pruneSessions(db: DB, now: number = Date.now()): number {
  const cutoff = new Date(now - SESSION_TTL_MS).toISOString();
  const res = db.prepare(`DELETE FROM user_sessions WHERE last_used_at < ?`).run(cutoff);
  return Number(res.changes ?? 0);
}

/* ------------------------------------------------------------ sqlite log rotation */

/**
 * Size-capped rotating log for api.log. Synchronous appends (the whole server
 * is sync-I/O by design — node:sqlite), one fsync-free write per line, and a
 * single rotation: api.log -> api.log.1, overwriting the previous generation.
 * RETENTION_LOG_KB caps the live file (default 512); 0 disables the cap.
 */
export class RotatingLogger {
  private file: string;
  private capBytes: number;

  constructor(file: string, capKb: number) {
    this.file = file;
    this.capBytes = capKb > 0 ? capKb * 1024 : 0;
  }

  append(line: string): void {
    if (this.capBytes > 0) {
      let size = 0;
      try {
        size = fs.statSync(this.file).size;
      } catch {
        /* first write */
      }
      if (size >= this.capBytes) {
        try {
          fs.renameSync(this.file, `${this.file}.1`);
        } catch {
          /* no previous generation to rotate */
        }
      }
    }
    fs.appendFileSync(this.file, line);
  }
}

/** Log cap in KB from the environment. 0 disables the cap (default 512). */
export function logCapKb(): number {
  const raw = process.env.RETENTION_LOG_KB;
  if (raw === undefined || raw.trim() === "") return 512;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : 512;
}
