/**
 * Matchday pushes — the rules that are easy to lose by accident.
 *
 * 1. ONE push per (user, match, stage). The producer runs on the *minute* loop
 *    against matches that stay inside their window for up to two hours, so a
 *    missing dedupe means a user gets "kicks off in 40 minutes" forty times.
 * 2. Preferences gate twice — nothing is queued for an opt-out (queue time), and
 *    a toggle flipped after queueing still stops delivery (send time). Each kind
 *    maps to its own switch, so muting goals leaves lock reminders intact.
 * 3. Freshness windows. A first boot against a database full of historic
 *    fixtures must not queue months of reminders for matches long since over.
 */
import { strict as assert } from "node:assert";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { migrate } from "../server/db/schema.js";
import { asPushKind, isOptedOut, queueMatchdayAlerts } from "../server/notifications.js";
import { asPushLang } from "../server/messages.js";

/** Fixed clock: the producers take `now`, so every window is deterministic. */
const NOW = new Date("2026-09-29T18:00:00.000Z");

function minutesFromNow(mins: number): string {
  return new Date(NOW.getTime() + mins * 60_000).toISOString();
}

function tempDb(): DatabaseSync {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "verdikick-notif-")), "test.db");
  const db = new DatabaseSync(file);
  migrate(db);
  return db;
}

/** u1 + u2 follow HOME; u3 follows HOME *and* AWAY (the dedupe case). */
function seed(db: DatabaseSync): void {
  db.exec(`
    INSERT INTO teams (id, name, short_name, league) VALUES
      ('H', 'Home FC', 'Home', 'eng.1'),
      ('A', 'Away FC', 'Away', 'eng.1');
    INSERT INTO users (id, telegram_id, display_name, created_at) VALUES
      (1, 'u1', 'One', '2026-01-01T00:00:00.000Z'),
      (2, 'u2', 'Two', '2026-01-01T00:00:00.000Z'),
      (3, 'u3', 'Three', '2026-01-01T00:00:00.000Z');
    INSERT INTO favorite_teams (user_id, team_id, is_favorite, created_at) VALUES
      (1, 'H', 1, '2026-01-01T00:00:00.000Z'),
      (2, 'H', 0, '2026-01-01T00:00:00.000Z'),
      (3, 'H', 1, '2026-01-01T00:00:00.000Z'),
      (3, 'A', 0, '2026-01-01T00:00:00.000Z');
  `);
}

function addMatch(
  db: DatabaseSync,
  id: string,
  status: string,
  kickoffAt: string,
  extra: { lineup?: boolean; home?: number; away?: number } = {},
): void {
  db.prepare(
    `INSERT INTO matches
       (id, league, home_team_id, away_team_id, kickoff_at, status, home_score, away_score, home_formation, away_formation)
     VALUES (?, 'eng.1', 'H', 'A', ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    kickoffAt,
    status,
    extra.home ?? null,
    extra.away ?? null,
    extra.lineup ? "4-3-3" : null,
    extra.lineup ? "4-2-3-1" : null,
  );
}

interface QueuedRow {
  telegram_id: string;
  kind: string;
  text: string;
}

function queued(db: DatabaseSync): QueuedRow[] {
  return db
    .prepare("SELECT telegram_id, kind, text FROM bot_push_queue ORDER BY id")
    .all() as unknown as QueuedRow[];
}

function idsOf(db: DatabaseSync, kind: string): string[] {
  return queued(db)
    .filter((r) => r.kind === kind)
    .map((r) => r.telegram_id)
    .sort();
}

/** One push per user per stage, however many sweeps run, and never twice for a both-clubs follower. */
function testDedupeAndBothClubs() {
  const db = tempDb();
  seed(db);
  addMatch(db, "m_ht", "halftime", minutesFromNow(-50), { home: 1, away: 0 });

  assert.equal(queueMatchdayAlerts(db, NOW), 3, "one half-time push per follower");
  assert.deepEqual(idsOf(db, "halftime"), ["u1", "u2", "u3"]);

  // u3 follows BOTH clubs — still exactly one push, not two.
  assert.equal(queued(db).filter((r) => r.telegram_id === "u3").length, 1, "both-clubs follower deduped");

  // The whole point: the same match sits in the window for the next sweeps.
  assert.equal(queueMatchdayAlerts(db, NOW), 0, "a second sweep re-sends nothing");
  assert.equal(queueMatchdayAlerts(db, NOW), 0, "nor a third");
  assert.equal(queued(db).length, 3, "queue unchanged across sweeps");
  db.close();
}

/** Queue-time gating, per kind, plus the send-time gate behind it. */
function testPreferenceGates() {
  const db = tempDb();
  seed(db);
  // u2 muted prediction reminders; u1 muted rating-window alerts.
  db.prepare(
    "INSERT INTO user_notification_prefs (user_id, goals, deadline, ratings, updated_at) VALUES (2, 1, 0, 1, ?)",
  ).run(NOW.toISOString());
  db.prepare(
    "INSERT INTO user_notification_prefs (user_id, goals, deadline, ratings, updated_at) VALUES (1, 1, 1, 0, ?)",
  ).run(NOW.toISOString());

  addMatch(db, "m_lu", "scheduled", minutesFromNow(90), { lineup: true });
  addMatch(db, "m_ft", "finished", minutesFromNow(-180), { home: 2, away: 1 });
  queueMatchdayAlerts(db, NOW);

  assert.deepEqual(idsOf(db, "lineup"), ["u1", "u3"], "deadline=0 keeps u2 out of the lineup push");
  assert.deepEqual(idsOf(db, "ratings"), ["u2", "u3"], "ratings=0 keeps u1 out of the rating push");

  // Send-time gate: the drain re-checks, so a toggle flipped after queueing wins.
  assert.equal(isOptedOut(db, "u2", "lineup"), true, "u2 is opted out of lock reminders");
  assert.equal(isOptedOut(db, "u2", "goal"), false, "muting one kind leaves the others alone");
  assert.equal(isOptedOut(db, "u1", "ratings"), true, "u1 is opted out of rating alerts");
  assert.equal(isOptedOut(db, "u3", "ratings"), false, "no prefs row means on");
  db.close();
}

/** Nothing outside a stage's window fires — the first-boot flood guard. */
function testWindowGates() {
  const db = tempDb();
  seed(db);
  // Finished ten hours ago: outside the 6h rating window.
  addMatch(db, "m_old", "finished", minutesFromNow(-600), { home: 1, away: 1 });
  // Fare enough out that the lineup is not published yet.
  addMatch(db, "m_far", "scheduled", minutesFromNow(200), { lineup: true });
  // Inside the lineup window but no lineup has landed.
  addMatch(db, "m_nolineup", "scheduled", minutesFromNow(60));
  assert.equal(queueMatchdayAlerts(db, NOW), 0, "no stage in window means nothing queued");

  // The lock reminder carries the minutes, and fires once.
  addMatch(db, "m_lock", "scheduled", minutesFromNow(30));
  assert.equal(queueMatchdayAlerts(db, NOW), 3, "lock reminder for each follower");
  assert.deepEqual(idsOf(db, "lock"), ["u1", "u2", "u3"]);
  const lock = queued(db).find((r) => r.kind === "lock");
  assert.ok(lock?.text.includes("kicks off in 30"), `lock copy carries the countdown: ${lock?.text}`);

  // Unknown/NULL kinds (pre-migration rows) must behave as goal alerts, not crash.
  assert.equal(asPushKind("ratings"), "ratings");
  assert.equal(asPushKind(null), "goal");
  assert.equal(asPushKind("garbage"), "goal");
  db.close();
}

/**
 * Copy is rendered PER RECIPIENT, from `users.language`. Two followers of the
 * same club in the same match must each get their own wording — rendering once
 * per match and fanning it out is the bug this guards.
 */
function testPerRecipientLanguage() {
  const db = tempDb();
  seed(db);
  db.prepare("UPDATE users SET language = 'fa' WHERE id = 1").run();
  addMatch(db, "m_lu", "scheduled", minutesFromNow(90), { lineup: true });
  addMatch(db, "m_lock", "scheduled", minutesFromNow(20));
  addMatch(db, "m_ft", "finished", minutesFromNow(-120), { home: 1, away: 0 });
  queueMatchdayAlerts(db, NOW);

  // Same stage, same match, two languages — so compare the lineup row of each.
  const stageText = (id: string, kind: string): string | undefined =>
    queued(db).find((r) => r.telegram_id === id && r.kind === kind)?.text;
  assert.ok(
    stageText("u1", "lineup")?.includes("ترکیب اعلام شد"),
    `Persian reader gets Persian: ${stageText("u1", "lineup")}`,
  );
  assert.ok(
    stageText("u3", "lineup")?.includes("Lineup out"),
    `English reader gets English: ${stageText("u3", "lineup")}`,
  );

  // Every stage is localized, not just the first one asserted.
  const mine = queued(db).filter((r) => r.telegram_id === "u1");
  assert.ok(
    mine.some((r) => r.kind === "lock" && r.text.includes("دقیقه دیگر شروع")),
    "lock copy localized",
  );
  assert.ok(
    mine.some((r) => r.kind === "ratings" && r.text.includes("پایان بازی")),
    "ratings copy localized",
  );
  assert.ok(
    mine.every(
      (r) =>
        !r.text.includes("Lineup out") &&
        !r.text.includes("kicks off in") &&
        !r.text.includes("Rate the players"),
    ),
    "no English leaked into the Persian rows",
  );

  // Anything that is not `fa` reads as English, matching the column default.
  assert.equal(asPushLang("fa"), "fa");
  assert.equal(asPushLang("en"), "en");
  assert.equal(asPushLang(null), "en");
  assert.equal(asPushLang("de"), "en");
  db.close();
}

/** Existing databases gain the `kind` column, and old rows read as goal alerts. */
function testKindColumnBackfill() {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "verdikick-notif-")), "old.db");
  const db = new DatabaseSync(file);
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
    CREATE TABLE bot_push_queue (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id  TEXT NOT NULL,
      text         TEXT NOT NULL,
      created_at   TEXT NOT NULL,
      sent_at      TEXT,
      attempts     INTEGER NOT NULL DEFAULT 0,
      failed_at    TEXT
    );
    INSERT INTO users (telegram_id, display_name, created_at)
      VALUES ('u1', 'Legacy', '2026-01-01T00:00:00.000Z');
    INSERT INTO bot_push_queue (telegram_id, text, created_at)
      VALUES ('u1', '⚽ GOAL 12'' — Legacy', '2026-01-01T00:00:00.000Z');
  `);

  assert.doesNotThrow(() => migrate(db), "migrate must boot a pre-kind database");

  const cols = db.prepare("SELECT name FROM pragma_table_info('bot_push_queue')").all() as Array<{
    name: string;
  }>;
  assert.ok(
    cols.some((c) => c.name === "kind"),
    "kind column backfilled",
  );

  const legacy = db.prepare("SELECT kind FROM bot_push_queue").get() as { kind: string };
  assert.equal(legacy.kind, "goal", "a queued row predating the column reads as a goal alert");

  // Localized pushes need a language per account; pre-existing users read English.
  const userCols = db.prepare("SELECT name FROM pragma_table_info('users')").all() as Array<{ name: string }>;
  assert.ok(
    userCols.some((c) => c.name === "language"),
    "users.language backfilled",
  );
  const existingUser = db.prepare("SELECT language FROM users WHERE telegram_id = 'u1'").get() as {
    language: string;
  };
  assert.equal(existingUser.language, "en", "an account predating the column defaults to English");

  const tables = (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>
  ).map((r) => r.name);
  assert.ok(tables.includes("match_notifications"), "match_notifications created by migration");
  db.close();
}

export async function runNotificationTests(): Promise<void> {
  testDedupeAndBothClubs();
  testPreferenceGates();
  testWindowGates();
  testPerRecipientLanguage();
  testKindColumnBackfill();
  console.log("  notifications: per-user dedupe, both-clubs dedupe, sweep idempotence OK");
  console.log("  notifications: per-kind queue + send-time gating, window gates OK");
  console.log("  notifications: per-recipient EN/FA copy, users.language backfill OK");
}
