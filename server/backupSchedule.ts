/**
 * Nightly database backup, run from inside the web service.
 *
 * WHY THIS LIVES IN THE SERVER, NOT A RENDER CRON JOB: a Render persistent disk
 * is bound to the single service that owns it — the docs are explicit that "You
 * can't add a disk to a cron job service" and "You can't access a service's disk
 * from any other service". A separate cron container therefore can never see
 * /var/data/matchday.db, so the schedule has to run in the one process that can.
 * It reuses exactly the server/backup.ts functions the CLI does, and produces the
 * same `matchday-<stamp>.db` snapshots, so a restore is identical either way.
 *
 * This is local durability, not off-site: Render also snapshots the disk itself
 * once every 24h (kept >= 7 days), which covers the case where this process is
 * down. Only an off-site copy survives losing the disk (see README "Backups").
 *
 * Env: BACKUP_DIR (default ./backups), BACKUP_KEEP (default 7), BACKUP_HOUR
 * (UTC hour 0-23, default 3), SQLITE_PATH (default ./data/matchday.db).
 */
import path from "node:path";
import { backupFileName, backupTo, listBackups, pruneBackups } from "./backup.js";

export interface BackupRunResult {
  file: string;
  bytes: number;
  pruned: string[];
  kept: number;
}

/** Take one snapshot and prune old ones. Throws on failure. */
export function runNightlyBackup(
  dbPath: string,
  dir: string,
  keep: number,
  now: Date = new Date(),
): BackupRunResult {
  const dest = path.join(dir, backupFileName(now));
  const { bytes } = backupTo(dbPath, dest);
  const pruned = pruneBackups(dir, keep);
  return { file: dest, bytes, pruned, kept: listBackups(dir).length };
}

/**
 * True when the nightly job should run now: the UTC hour matches and it has not
 * already run today. `lastRunDay` is the UTC `YYYY-MM-DD` of the previous run
 * ("" when none), so a redeploy inside the backup hour never fires a second
 * snapshot on the same day.
 */
export function backupDue(now: Date, hour: number, lastRunDay: string): boolean {
  if (now.getUTCHours() !== hour) return false;
  return now.toISOString().slice(0, 10) !== lastRunDay;
}

/**
 * Start the hourly check that performs the nightly backup once the configured
 * UTC hour arrives. Returns a stop function (tests). Unref'd, so it never keeps
 * the process alive on its own.
 */
export function startBackupLoop(): () => void {
  const dbPath = process.env.SQLITE_PATH ?? "./data/matchday.db";
  const dir = process.env.BACKUP_DIR ?? "./backups";
  const keepRaw = process.env.BACKUP_KEEP ?? "7";
  const hourRaw = process.env.BACKUP_HOUR ?? "3";
  const keep = Number(keepRaw);
  const hour = Number(hourRaw);

  if (!Number.isInteger(keep) || keep < 1) {
    console.error(
      `[backup] BACKUP_KEEP must be a positive integer, got "${keepRaw}" — nightly backup disabled`,
    );
    return () => {};
  }
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    console.error(`[backup] BACKUP_HOUR must be an integer 0-23, got "${hourRaw}" — nightly backup disabled`);
    return () => {};
  }

  let lastRunDay = "";
  const tick = (): void => {
    const now = new Date();
    if (!backupDue(now, hour, lastRunDay)) return;
    lastRunDay = now.toISOString().slice(0, 10);
    try {
      const r = runNightlyBackup(dbPath, dir, keep, now);
      console.log(
        `[backup] nightly: ${dbPath} → ${r.file} (${r.bytes} bytes); kept ${r.kept}, pruned ${r.pruned.length}`,
      );
    } catch (err) {
      // A failed snapshot must never take the API down; Render's own disk
      // snapshots are the safety net for the day this one misses.
      console.error("[backup] nightly failed:", String(err).slice(0, 200));
    }
  };

  tick(); // a boot landing inside the backup hour still gets one in
  const timer = setInterval(tick, 60 * 60_000);
  timer.unref?.();
  console.log(
    `[backup] nightly backup scheduled for ${String(hour).padStart(2, "0")}:00 UTC → ${dir} (keep ${keep})`,
  );
  return () => clearInterval(timer);
}
