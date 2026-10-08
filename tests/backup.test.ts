/**
 * Backup/restore round-trip.
 *
 * Pins the three promises of the nightly backup:
 *  1. the snapshot is taken with VACUUM INTO against a LIVE, open database
 *     (online backup — not `cp` under the writer's feet) and is point-in-time:
 *     writes landing after the snapshot stay out of it;
 *  2. restore materialises a fresh file whose row counts match the snapshot
 *     exactly, never touching the live source, and refuses to clobber an
 *     existing file;
 *  3. prune keeps the newest BACKUP managed backups and deletes nothing else —
 *     hand-placed files with other names survive.
 */
import { strict as assert } from "node:assert";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { migrate } from "../server/db/schema.js";
import { backupFileName, backupTo, listBackups, pruneBackups, restoreBackup } from "../server/backup.js";

function countUsers(db: DatabaseSync): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
}

export async function runBackupTests(): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "verdikick-backup-"));
  try {
    // --- a live source: real schema, WAL (migrate sets it), held open ---
    const srcPath = path.join(dir, "source.db");
    const src = new DatabaseSync(srcPath);
    migrate(src);
    const insert = src.prepare("INSERT INTO users (telegram_id, display_name, created_at) VALUES (?, ?, ?)");
    for (let i = 0; i < 25; i += 1) insert.run(`t${i}`, `User ${i}`, "2026-10-07T00:00:00.000Z");

    // Snapshot WHILE the source connection is open and WAL is active.
    const backupDir = path.join(dir, "backups");
    const backupPath = path.join(backupDir, backupFileName(new Date("2026-10-07T02:00:00Z")));
    const { bytes } = backupTo(srcPath, backupPath);
    assert.ok(bytes > 0, "the snapshot file has content");

    // Writes after the snapshot must NOT leak into it — point-in-time.
    for (let i = 25; i < 35; i += 1) insert.run(`t${i}`, `User ${i}`, "2026-10-07T00:00:00.000Z");
    assert.equal(countUsers(src), 35, "the live source keeps accepting writes");

    const snapshot = new DatabaseSync(backupPath, { readOnly: true });
    assert.equal(countUsers(snapshot), 25, "snapshot is point-in-time: 25 rows as of backup");
    snapshot.close();

    // --- restore into a fresh file; row counts match the SNAPSHOT ---
    const restoredPath = path.join(dir, "restored.db");
    restoreBackup(backupPath, restoredPath);
    const restored = new DatabaseSync(restoredPath, { readOnly: true });
    assert.equal(countUsers(restored), 25, "restore reproduces the snapshot's row count");
    restored.close();
    assert.equal(countUsers(src), 35, "restore never modified the live source");

    // Safety rails: never clobber, never invent a source.
    assert.throws(() => restoreBackup(backupPath, restoredPath), /already exists/);
    assert.throws(() => backupTo(srcPath, backupPath), /already exists/);
    assert.throws(() => backupTo(path.join(dir, "missing.db"), path.join(dir, "x.db")), /not found/);
    // A corrupt backup fails the restore instead of being copied into place.
    const corrupt = path.join(dir, "corrupt.db");
    fs.writeFileSync(corrupt, "this is not a database");
    assert.throws(() => restoreBackup(corrupt, path.join(dir, "from-corrupt.db")));
    assert.ok(!fs.existsSync(path.join(dir, "from-corrupt.db")), "no partial file left behind");

    // --- prune: newest 7 of 9 kept, strangers untouched ---
    const pdir = path.join(dir, "prune");
    fs.mkdirSync(pdir);
    const names: string[] = [];
    for (let i = 0; i < 9; i += 1) {
      const name = backupFileName(new Date(Date.UTC(2026, 0, 1 + i, 2, 0, 0)));
      fs.writeFileSync(path.join(pdir, name), "x");
      names.push(name);
    }
    fs.writeFileSync(path.join(pdir, "matchday-manual-copy.db"), "hand-placed, no timestamp");
    fs.writeFileSync(path.join(pdir, "unrelated.db"), "stranger");

    const pruned = pruneBackups(pdir, 7);
    assert.equal(pruned.length, 2, "exactly the two oldest are pruned");
    assert.equal(listBackups(pdir).length, 7, "seven managed backups remain");
    assert.ok(!fs.existsSync(path.join(pdir, names[0]!)), "oldest (Jan 1) deleted");
    assert.ok(!fs.existsSync(path.join(pdir, names[1]!)), "second oldest (Jan 2) deleted");
    assert.ok(fs.existsSync(path.join(pdir, names[8]!)), "newest (Jan 9) kept");
    assert.ok(fs.existsSync(path.join(pdir, "matchday-manual-copy.db")), "prune ignores non-matching names");
    assert.ok(fs.existsSync(path.join(pdir, "unrelated.db")), "prune ignores strangers");
    assert.throws(() => pruneBackups(pdir, 0), /positive integer/);

    src.close();
    console.log("  backup: live snapshot, restore row counts, prune safety OK");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
