/**
 * Season boundary (scoring-rules.md §8) — the streak half of it.
 *
 * The roadmap flagged this as untested: a user whose streak row still carries
 * the previous season's label must get a fresh streak the next time their
 * favorite club resolves, and a user already on the current label must be left
 * alone. `rollSeasonIfNeeded` is the one function that does it, lazily, so the
 * test boots a real (temp) database and drives it directly.
 */
import { strict as assert } from "node:assert";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { migrate } from "../server/db/schema.js";
import { currentSeasonLabel, rollSeasonIfNeeded } from "../server/scoring/ledger.js";

interface StreakRow {
  current: number;
  season_hits: number;
  thresholds_paid: string;
  last_match_id: string | null;
  streak_active: number;
  scope_season: string;
}

function tempDb(): DatabaseSync {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "verdikick-season-")), "test.db");
  const db = new DatabaseSync(file);
  migrate(db);
  return db;
}

function addUser(db: DatabaseSync, telegramId: string, name: string): number {
  const info = db
    .prepare("INSERT INTO users (telegram_id, display_name, created_at) VALUES (?, ?, ?)")
    .run(telegramId, name, "2026-01-01T00:00:00.000Z");
  return Number(info.lastInsertRowid);
}

function streakOf(db: DatabaseSync, userId: number): StreakRow {
  return db.prepare("SELECT * FROM user_streaks WHERE user_id = ?").get(userId) as unknown as StreakRow;
}

/** A row stamped with a previous season is reset to a clean slate. */
function testRollsPreviousSeason(): void {
  const db = tempDb();
  const userId = addUser(db, "1", "Dev");
  db.prepare(
    `INSERT INTO user_streaks
       (user_id, current, season_hits, thresholds_paid, last_match_id, streak_active, scope_season, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(userId, 7, 9, "[3,5]", "m-old", 1, "2025-26", "2026-01-01T00:00:00.000Z");

  const season = currentSeasonLabel();
  assert.notEqual(season, "2025-26", "fixture season must predate the running season");

  assert.equal(rollSeasonIfNeeded(db, userId), season, "returns the current season label");

  const row = streakOf(db, userId);
  assert.equal(row.current, 0, "the streak counter resets");
  assert.equal(row.season_hits, 0, "season hits reset");
  assert.equal(row.thresholds_paid, "[]", "threshold bonuses are re-armed");
  assert.equal(row.last_match_id, null, "the last evaluated match is forgotten");
  assert.equal(row.streak_active, 0, "the streak is no longer active");
  assert.equal(row.scope_season, season, "the row is stamped with the new season");
}

/** A row already on the current season is left exactly as it was. */
function testCurrentSeasonUntouched(): void {
  const db = tempDb();
  const userId = addUser(db, "2", "Same season");
  const season = currentSeasonLabel();
  db.prepare(
    `INSERT INTO user_streaks
       (user_id, current, season_hits, thresholds_paid, last_match_id, streak_active, scope_season, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(userId, 4, 5, "[3]", "m-live", 1, season, "2026-01-01T00:00:00.000Z");

  rollSeasonIfNeeded(db, userId);

  const row = streakOf(db, userId);
  assert.equal(row.current, 4, "a live streak survives the check");
  assert.equal(row.season_hits, 5);
  assert.equal(row.thresholds_paid, "[3]");
  assert.equal(row.last_match_id, "m-live");
  assert.equal(row.scope_season, season);
}

/** No streak row yet: nothing to reset, no crash, the label still comes back. */
function testNoRow(): void {
  const db = tempDb();
  const userId = addUser(db, "3", "No streak");
  assert.equal(rollSeasonIfNeeded(db, userId), currentSeasonLabel());
  const count = db.prepare("SELECT COUNT(*) AS n FROM user_streaks").get() as { n: number };
  assert.equal(count.n, 0, "rollSeasonIfNeeded never invents a streak row");
}

export function runSeasonTests(): void {
  testRollsPreviousSeason();
  testCurrentSeasonUntouched();
  testNoRow();
  console.log("  season: previous-season streak reset, current-season no-op and no-row path OK");
}
