/**
 * The nightly backup scheduler's two pieces of real logic: WHEN it fires and
 * WHAT it produces.
 *
 * The `due` gate is the subtle part — a naive `setInterval(tick, 24h)` drifts,
 * and a plain "is it the backup hour?" check fires again on every hourly tick
 * (and on every redeploy inside the hour). The gate must run at most once per
 * UTC day at the configured hour. The run itself must reuse the backup module's
 * snapshot + prune, so this pins the naming/keep behaviour the CLI shares.
 */
import { strict as assert } from "node:assert";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { migrate } from "../server/db/schema.js";
import { backupDue, runNightlyBackup } from "../server/backupSchedule.js";
import { listBackups } from "../server/backup.js";

export async function runBackupScheduleTests(): Promise<void> {
  /* ------------------------------------------------ the due gate */
  const at03 = new Date("2026-10-07T03:00:00Z");
  assert.equal(backupDue(at03, 3, ""), true, "the backup hour with nothing run yet is due");
  assert.equal(backupDue(at03, 3, "2026-10-07"), false, "a second tick in the same day is not due");
  assert.equal(backupDue(at03, 4, ""), false, "a non-matching hour is not due");
  assert.equal(backupDue(new Date("2026-10-07T15:59:00Z"), 3, ""), false, "the gate is hour-specific");
  assert.equal(
    backupDue(new Date("2026-10-08T03:00:00Z"), 3, "2026-10-07"),
    true,
    "the next UTC day runs again",
  );
  // The hour is read in UTC so a server's local timezone cannot shift it.
  assert.equal(backupDue(new Date("2026-10-07T03:00:00Z"), 3, ""), true);
  assert.equal(backupDue(new Date("2026-10-07T03:30:00Z"), 3, ""), true, "any minute inside the hour counts");

  /* ------------------------------------------------ the run */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vkick-bksched-"));
  try {
    const dbPath = path.join(dir, "matchday.db");
    const db = new DatabaseSync(dbPath);
    migrate(db);
    db.prepare("INSERT INTO users (telegram_id, display_name, created_at) VALUES (?, ?, ?)").run(
      "sched1",
      "Sched",
      "2026-10-07T00:00:00.000Z",
    );
    db.close();

    const backupDir = path.join(dir, "backups");
    let last: ReturnType<typeof runNightlyBackup> | null = null;
    for (let i = 0; i < 3; i += 1) {
      last = runNightlyBackup(dbPath, backupDir, 2, new Date(Date.UTC(2026, 0, 1 + i, 3, 0, 0)));
    }

    assert.ok(last, "three runs happened");
    assert.match(path.basename(last!.file), /^matchday-\d{8}-\d{6}\.db$/, "snapshot uses the managed name");
    assert.ok(last!.bytes > 0, "the snapshot has content");
    assert.equal(last!.kept, 2, "keep=2 leaves exactly two snapshots");
    assert.equal(listBackups(backupDir).length, 2);
    assert.equal(last!.pruned.length, 1, "the oldest of three is pruned on the last run");

    // The newest snapshot is a real, readable database carrying the row.
    const snap = new DatabaseSync(last!.file, { readOnly: true });
    const n = (snap.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
    snap.close();
    assert.equal(n, 1, "the snapshot holds the data written before it");

    // A missing source is a hard error, not an empty "successful" backup.
    assert.throws(() => runNightlyBackup(path.join(dir, "nope.db"), backupDir, 2), /not found/);

    console.log("  backupSchedule: once-per-UTC-day gate + snapshot naming/keep OK");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
