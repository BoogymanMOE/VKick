/**
 * Migration safety — boots `migrate()` against pre-anchor databases.
 *
 * Regression test: the anchor partial index (`idx_favorites_anchor ...
 * WHERE is_favorite = 1`) once lived in the main schema exec, before the
 * `is_favorite` column backfill. Any database created before the anchor flag
 * (no `is_favorite` column on `favorite_teams`) crashed the whole server at
 * boot with `no such column: is_favorite` — the exec aborted before
 * `point_ledger` / `user_notification_prefs` were created, so with the API
 * down every client call (including username login) fell back to the generic
 * `common.error`. The index is now created after the backfill, with duplicate
 * anchors deduped first so the UNIQUE index itself cannot fail boot either.
 */
import { strict as assert } from "node:assert";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { migrate } from "../server/db/schema.js";

function tempDb(): { db: DatabaseSync; file: string } {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "verdikick-migrate-")), "test.db");
  return { db: new DatabaseSync(file), file };
}

function tableNames(db: DatabaseSync): string[] {
  return (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{
      name: string;
    }>
  ).map((r) => r.name);
}

/** A pre-anchor database: no is_favorite, stale versus_pairs, no ledger tables. */
function testPreAnchorBoot() {
  const { db } = tempDb();
  db.exec(`
    CREATE TABLE users (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id  TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      created_at   TEXT NOT NULL
    );
    CREATE TABLE favorite_teams (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id),
      team_id     TEXT NOT NULL,
      created_at  TEXT NOT NULL,
      UNIQUE(user_id, team_id)
    );
    CREATE TABLE versus_pairs (id INTEGER PRIMARY KEY);
    INSERT INTO users (telegram_id, display_name, created_at) VALUES ('1', 'Dev', '2026-01-01T00:00:00.000Z');
    INSERT INTO favorite_teams (user_id, team_id, created_at) VALUES (1, '100', '2026-01-01T00:00:00.000Z');
  `);

  assert.doesNotThrow(() => migrate(db), "migrate must boot a pre-anchor database");

  const tables = tableNames(db);
  for (const t of [
    "point_ledger",
    "user_point_totals",
    "user_streaks",
    "streak_evaluations",
    "user_notification_prefs",
  ]) {
    assert.ok(tables.includes(t), `${t} created by migration`);
  }
  assert.ok(!tables.includes("versus_pairs"), "versus_pairs dropped by migration");

  const favCols = db.prepare("SELECT name FROM pragma_table_info('favorite_teams')").all() as Array<{
    name: string;
  }>;
  assert.ok(
    favCols.some((c) => c.name === "is_favorite"),
    "is_favorite backfilled",
  );

  const idx = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_favorites_anchor'")
    .get();
  assert.ok(idx, "anchor partial index exists after migration");

  // Idempotent: a second boot (the normal restart path) is a no-op.
  assert.doesNotThrow(() => migrate(db), "migrate is idempotent");
  db.close();
}

/** Usernames became case-insensitive: old case-sensitive tables rebuild to NOCASE. */
function testUsernameNocase() {
  const { db } = tempDb();
  db.exec(`
    CREATE TABLE users (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id  TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      created_at   TEXT NOT NULL
    );
    CREATE TABLE user_credentials (
      user_id       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      username      TEXT NOT NULL UNIQUE,
      password_hash TEXT,
      recovery_hash TEXT,
      recovery_note TEXT,
      created_at    TEXT NOT NULL
    );
    INSERT INTO users (telegram_id, display_name, created_at) VALUES
      ('pwd:striker10', 'Striker', '2026-01-01T00:00:00.000Z'),
      ('pwd:striker10x', 'striker', '2026-01-02T00:00:00.000Z');
    INSERT INTO user_credentials (user_id, username, password_hash, created_at) VALUES
      (1, 'Striker10', NULL, '2026-01-01T00:00:00.000Z'),
      (2, 'striker10', NULL, '2026-01-02T00:00:00.000Z');
  `);

  assert.doesNotThrow(() => migrate(db), "migrate must rebuild case-sensitive credentials");

  const ddl = (
    db.prepare("SELECT sql FROM sqlite_master WHERE name = 'user_credentials'").get() as { sql: string }
  ).sql;
  assert.ok(/collate\s+nocase/i.test(ddl), "rebuilt table carries NOCASE");

  // Collision: earliest row keeps the name, original casing preserved.
  const rows = db.prepare("SELECT user_id, username FROM user_credentials").all() as Array<{
    user_id: number;
    username: string;
  }>;
  assert.equal(rows.length, 1, "case-collision deduped to one credential row");
  assert.equal(rows[0]?.user_id, 1, "earliest keeps the name");
  assert.equal(rows[0]?.username, "Striker10", "original casing preserved");

  // Lookup is case-insensitive; a differently-cased insert is rejected.
  const found = db.prepare("SELECT user_id FROM user_credentials WHERE username = ?").get("sTrIkEr10") as
    { user_id: number } | undefined;
  assert.equal(found?.user_id, 1, "lookup matches regardless of casing");
  assert.throws(
    () =>
      db
        .prepare(
          "INSERT INTO user_credentials (user_id, username, created_at) VALUES (2, 'STRIKER10', '2026-01-03T00:00:00.000Z')",
        )
        .run(),
    /UNIQUE/i,
    "NOCASE unique rejects a differently-cased duplicate",
  );
  db.close();
}

/** Duplicate anchors from the unenforced era must not fail the UNIQUE index. */ function testDuplicateAnchorsDeduped() {
  const { db } = tempDb();
  db.exec(`
    CREATE TABLE users (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id  TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      created_at   TEXT NOT NULL
    );
    CREATE TABLE favorite_teams (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id),
      team_id     TEXT NOT NULL,
      created_at  TEXT NOT NULL,
      is_favorite INTEGER NOT NULL DEFAULT 0,
      UNIQUE(user_id, team_id)
    );
    INSERT INTO users (telegram_id, display_name, created_at) VALUES ('1', 'Dev', '2026-01-01T00:00:00.000Z');
    INSERT INTO favorite_teams (user_id, team_id, created_at, is_favorite) VALUES
      (1, '100', '2026-01-01T00:00:00.000Z', 1),
      (1, '101', '2026-01-02T00:00:00.000Z', 1);
  `);

  assert.doesNotThrow(() => migrate(db), "migrate must survive duplicate anchors");

  const anchors = db
    .prepare("SELECT COUNT(*) AS n FROM favorite_teams WHERE user_id = 1 AND is_favorite = 1")
    .get() as {
    n: number;
  };
  assert.equal(anchors.n, 1, "exactly one anchor per user after migration");
  const kept = db
    .prepare("SELECT team_id AS t FROM favorite_teams WHERE user_id = 1 AND is_favorite = 1")
    .get() as {
    t: string;
  };
  assert.equal(kept.t, "100", "earliest anchor row wins");
  db.close();
}

export async function runMigrateTests(): Promise<void> {
  testPreAnchorBoot();
  testDuplicateAnchorsDeduped();
  testUsernameNocase();
  console.log("  migrate: pre-anchor boot, versus drop, ledger creation, anchor dedupe OK");
  console.log("  migrate: username NOCASE rebuild, collision dedupe, case-insensitive lookup OK");
}
