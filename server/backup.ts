/**
 * Local SQLite backups — snapshot, prune, restore. No cloud wiring.
 *
 * The snapshot uses `VACUUM INTO`, which SQLite executes as an ONLINE backup:
 * it reads a transactionally consistent snapshot of a live database (WAL and
 * all) and writes a fresh, defragmented file — unlike `cp matchday.db`, which
 * can capture a torn page set while the server is mid-write. It is chosen
 * over node:sqlite's async `backup()` helper because it exists on every
 * node:sqlite version this app supports (22.5+), it is one synchronous call,
 * and the resulting file has no WAL left to recover.
 *
 * Nothing here uploads anywhere: scheduling (nightly cron / Render cron job)
 * and off-site storage are ops decisions made in server/backupCli.ts and
 * outside the repo. A backup is only a backup if it lives on another disk —
 * treat BACKUP_DIR as staging, not as safety.
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/** Every managed backup starts with this; prune only ever touches these. */
export const BACKUP_PREFIX = "matchday-";
/** Fixed-width UTC stamp so plain name sort == chronological sort. */
const NAME_RE = /^matchday-\d{8}-\d{6}\.db$/;

/** `matchday-20261007-153012.db` (UTC, sortable, Windows-safe — no colons). */
export function backupFileName(now: Date = new Date()): string {
  const iso = now.toISOString(); // 2026-10-07T15:30:12.345Z
  const date = iso.slice(0, 10).replace(/-/g, "");
  const time = iso.slice(11, 19).replace(/:/g, "");
  return `${BACKUP_PREFIX}${date}-${time}.db`;
}

/**
 * Copy `sourcePath` to `destPath` through VACUUM INTO — the online-backup
 * path. Refuses to clobber an existing file, and refuses a missing source
 * (a bare `new DatabaseSync(path)` would silently CREATE an empty database).
 */
function vacuumInto(sourcePath: string, destPath: string): { bytes: number } {
  if (!fs.existsSync(sourcePath)) throw new Error(`database file not found: ${sourcePath}`);
  if (fs.existsSync(destPath)) throw new Error(`destination already exists: ${destPath}`);
  fs.mkdirSync(path.dirname(path.resolve(destPath)), { recursive: true });

  const db = new DatabaseSync(sourcePath, { readOnly: true });
  try {
    db.prepare("VACUUM INTO ?").run(destPath);
  } catch (err) {
    // A failed VACUUM may have left a 0-byte dest behind — never leave a
    // file that looks like a backup but isn't.
    try {
      if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
    } catch {
      /* best effort */
    }
    throw err;
  } finally {
    db.close();
  }
  return { bytes: fs.statSync(destPath).size };
}

/** Snapshot the (possibly live) database at `sourcePath` into `destPath`. */
export function backupTo(sourcePath: string, destPath: string): { bytes: number } {
  return vacuumInto(sourcePath, destPath);
}

/**
 * Restore a snapshot to `destPath` (fresh file — refuses to exist, so a
 * restore can never overwrite a live database by accident). Materialising
 * through VACUUM INTO also validates the backup: a corrupt file fails here
 * instead of being copied into production.
 */
export function restoreBackup(backupPath: string, destPath: string): { bytes: number } {
  return vacuumInto(backupPath, destPath);
}

/** Managed backups in `dir`, newest first (fixed-width names sort by time). */
export function listBackups(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => NAME_RE.test(f))
    .sort()
    .reverse();
}

/**
 * Keep the newest `keep` managed backups; delete the rest. Only files
 * matching the strict `matchday-<stamp>.db` name are ever touched — a
 * hand-placed file, the live database or anything else in the directory is
 * invisible to the prune. Returns the deleted paths.
 */
export function pruneBackups(dir: string, keep: number): string[] {
  if (!Number.isInteger(keep) || keep < 1) throw new Error(`keep must be a positive integer, got ${keep}`);
  const doomed = listBackups(dir).slice(keep); // list is newest-first
  for (const file of doomed) fs.unlinkSync(path.join(dir, file));
  return doomed;
}
