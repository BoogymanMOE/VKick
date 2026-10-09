/**
 * Backup CLI — nightly snapshot of SQLITE_PATH, keep the newest BACKUP_KEEP.
 *
 *   npm run backup                          # snapshot + prune to the newest 7
 *   npm run backup:restore -- <file> [dest] # restore a snapshot (stop the server first!)
 *
 * Env: SQLITE_PATH (default ./data/matchday.db), BACKUP_DIR (default
 * ./backups), BACKUP_KEEP (default 7).
 *
 * Scheduling (nothing runs automatically — pick one):
 *   - Render: a second service of `type: cron` running
 *     `npm ci && npm run backup` on a `0 3 * * *` schedule, sharing the same
 *     persistent disk (mount it at the same path in both services).
 *   - Any box with the repo: `30 2 * * * cd /srv/vkick && npm run backup`.
 *   - Inside the server process: not done on purpose — a backup tied to the
 *     app's lifetime dies with the app.
 *
 * Off-site is wired in the server, not here: the nightly loop in
 * server/backupSchedule.ts pushes each snapshot to a private git repo (see
 * server/offsiteBackup.ts). This CLI stays local-only on purpose.
 */
import fs from "node:fs";
import path from "node:path";
import { backupFileName, backupTo, listBackups, pruneBackups, restoreBackup } from "./backup.js";
import { loadEnv } from "./env.js";

// Apply `.env` before reading any config below: `npm run backup` invoked from a
// shell that never exported SQLITE_PATH/BACKUP_DIR must still find the same
// database and destination the server uses.
loadEnv();

const SQLITE_PATH = process.env.SQLITE_PATH ?? "./data/matchday.db";
const BACKUP_DIR = process.env.BACKUP_DIR ?? "./backups";
const KEEP = Number(process.env.BACKUP_KEEP ?? "7");

function fail(message: string): never {
  console.error(`[backup] ${message}`);
  process.exit(1);
}

function main(): void {
  const [command, ...rest] = process.argv.slice(2);
  const action = command && !command.startsWith("-") ? command : "backup";

  if (action === "restore") {
    const [backupPath, destPath] = rest;
    if (!backupPath) {
      fail("restore needs a snapshot file: npm run backup:restore -- <file> [dest]");
    }
    const dest = destPath ?? SQLITE_PATH;
    if (fs.existsSync(dest)) {
      fail(
        `refusing to overwrite an existing file: ${dest}\n` +
          `        stop the server, move the current database aside, then re-run`,
      );
    }
    const { bytes } = restoreBackup(backupPath, dest);
    console.log(`[backup] restored ${backupPath} → ${dest} (${bytes} bytes)`);
    console.log(`[backup] start the server and check /health before trusting it`);
    return;
  }

  if (action !== "backup") fail(`unknown command "${action}" — use "backup" or "restore"`);

  if (!Number.isInteger(KEEP) || KEEP < 1) fail(`BACKUP_KEEP must be a positive integer, got ${KEEP}`);

  const dest = path.join(BACKUP_DIR, backupFileName());
  const { bytes } = backupTo(SQLITE_PATH, dest);
  console.log(`[backup] ${SQLITE_PATH} → ${dest} (${bytes} bytes, VACUUM INTO online snapshot)`);

  const pruned = pruneBackups(BACKUP_DIR, KEEP);
  const remaining = listBackups(BACKUP_DIR);
  console.log(`[backup] kept newest ${KEEP}: ${remaining.length} on disk, pruned ${pruned.length}`);
  for (const file of pruned) console.log(`  - pruned ${file}`);
}

try {
  main();
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
