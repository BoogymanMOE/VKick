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
import { currentSeasonLabel, rollSeasonIfNeeded, award } from "../server/scoring/ledger.js";
import { activeSeason, seasonLabelForDate, seasonWindow } from "../server/scoring/season.js";

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

/* -------------------------------------------- the data-driven boundary (§8) */

/** Insert a match row; kickoff drives the boundary, status does not. */
function addMatch(
  db: DatabaseSync,
  id: string,
  kickoff: string,
  league = "eng.1",
  status = "finished",
): void {
  // The matches FKs need real team rows; make them idempotent per test.
  const team = db.prepare("INSERT OR IGNORE INTO teams (id, name, league) VALUES (?, ?, ?)");
  team.run("57", "Home FC", league === "fifa.world" ? "" : league);
  team.run("64", "Away FC", league === "fifa.world" ? "" : league);
  db.prepare(
    `INSERT INTO matches (id, league, home_team_id, away_team_id, kickoff_at, status)
     VALUES (?, ?, '57', '64', ?, ?)`,
  ).run(id, league, kickoff, status);
}

/** The Aug–May mapping itself: Aug 1 flips, Jul 31 doesn't, January holds. */
function testSeasonLabelForDate(): void {
  assert.equal(seasonLabelForDate(new Date("2026-07-31T23:59:59Z")), "2025-26");
  assert.equal(seasonLabelForDate(new Date("2026-08-01T00:00:00Z")), "2026-27");
  assert.equal(seasonLabelForDate(new Date("2026-05-24T16:00:00Z")), "2025-26");
  assert.equal(seasonLabelForDate(new Date("2026-12-31T00:00:00Z")), "2026-27");
  assert.equal(seasonLabelForDate(new Date("2027-01-15T00:00:00Z")), "2026-27");
}

/**
 * The rule the roadmap flagged as missing: the label is driven by the last
 * tracked league's fixtures, not the calendar. Pinned against the exact case
 * where the two disagree — the summer gap after Aug 1 with no new fixtures yet.
 */
function testActiveSeasonIsDataDriven(): void {
  const db = tempDb();
  const aug10 = new Date("2026-08-10T00:00:00Z");

  // Fresh database: nothing to read — calendar fallback.
  assert.equal(activeSeason(db, aug10), seasonLabelForDate(aug10));

  // Last tracked match of the season: May 24. On Aug 10 the calendar rule
  // would already say "2026-27"; the data rule keeps "2025-26" open until
  // the new season actually kicks off.
  addMatch(db, "m-last", "2026-05-24T16:00:00.000Z");
  assert.equal(activeSeason(db, aug10), "2025-26", "summer gap keeps the finished season open");

  // Non-tracked matches (summer internationals) never flip the label.
  addMatch(db, "m-wc", "2026-07-05T16:00:00.000Z", "fifa.world");
  assert.equal(activeSeason(db, aug10), "2025-26", "internationals inherit, never drive");

  // The new season's first tracked kickoff IS the flip — and future fixtures
  // appearing early don't flip it before kickoff.
  addMatch(db, "m-new", "2026-08-22T11:30:00.000Z", "esp.1", "scheduled");
  assert.equal(activeSeason(db, new Date("2026-08-21T00:00:00Z")), "2025-26", "no early flip");
  assert.equal(activeSeason(db, new Date("2026-08-23T00:00:00Z")), "2026-27", "flips at first kickoff");
}

/** Awards stamp the ACTIVE season: a May fixture lands in the finished season even later. */
function testAwardStampsActiveSeason(): void {
  const db = tempDb();
  const userId = addUser(db, "10", "Scorer");
  addMatch(db, "m-may", "2026-05-24T16:00:00.000Z");

  const ledgerId = award(db, {
    userId,
    matchId: "m-may",
    source: "prediction",
    mechanic: "lineup",
    points: 5,
    sourceId: 1,
    league: "eng.1",
    teamIds: ["57", "64"],
  });
  assert.ok(ledgerId !== null, "award recorded");
  const row = db.prepare("SELECT scope_season FROM point_ledger WHERE id = ?").get(ledgerId) as {
    scope_season: string;
  };
  assert.equal(row.scope_season, "2025-26", "a May fixture stamps the season it belongs to");
}

/**
 * The synthetic boundary the roadmap asked for: a streak row stamped with the
 * finished season resets the moment the new season's first tracked match has
 * kicked off — verified against inserted fixtures, not the wall clock.
 */
function testRollAgainstSyntheticBoundary(): void {
  const db = tempDb();
  const userId = addUser(db, "11", "Boundary");
  addMatch(db, "m-old", "2026-05-24T16:00:00.000Z");
  addMatch(db, "m-new", "2026-08-22T11:30:00.000Z");
  db.prepare(
    `INSERT INTO user_streaks
       (user_id, current, season_hits, thresholds_paid, last_match_id, streak_active, scope_season, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(userId, 7, 9, "[3,5]", "m-old", 1, "2025-26", "2026-01-01T00:00:00.000Z");

  // With the new season's kickoff in the data, the active label is 2026-27.
  assert.equal(activeSeason(db), "2026-27");
  assert.equal(rollSeasonIfNeeded(db, userId), "2026-27", "rolls onto the data-driven label");
  const row = streakOf(db, userId);
  assert.equal(row.current, 0, "streak reset at the boundary");
  assert.equal(row.scope_season, "2026-27");
}

/**
 * The window a season label covers, used to keep derived tables (form, home and
 * away records) inside the season the standings row belongs to. A European
 * season starts on Aug 1; a calendar-year competition starts on Jan 1.
 */
function testSeasonWindow(): void {
  assert.deepEqual(seasonWindow("2026-27"), { from: "2026-08-01", to: "2027-08-01" });
  assert.deepEqual(seasonWindow("2025-26"), { from: "2025-08-01", to: "2026-08-01" });
  assert.deepEqual(seasonWindow("2026"), { from: "2026-01-01", to: "2027-01-01" });
  // A malformed label falls back to the current season rather than an open
  // window (which would quietly mix seasons together).
  const fallback = seasonWindow("garbage");
  assert.match(fallback.from, /^\d{4}-08-01$/);
  assert.match(fallback.to, /^\d{4}-08-01$/);
}

export function runSeasonTests(): void {
  testRollsPreviousSeason();
  testCurrentSeasonUntouched();
  testNoRow();
  testSeasonLabelForDate();
  testSeasonWindow();
  testActiveSeasonIsDataDriven();
  testAwardStampsActiveSeason();
  testRollAgainstSyntheticBoundary();
  console.log(
    "  season: previous-season streak reset, current-season no-op and no-row path, data-driven boundary (summer gap, first-kickoff flip, award stamps, synthetic roll) OK",
  );
}
