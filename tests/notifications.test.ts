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
import {
  asPushKind,
  isOptedOut,
  queueGoalAlerts,
  queueMatchdayAlerts,
  shouldSkipPredictionPush,
} from "../server/notifications.js";
import { predictionsEnabled, setPredictionsEnabledForTest } from "../server/features.js";
import { asPushLang, botCommandMenu, botStartText } from "../server/messages.js";

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
  extra: { lineup?: boolean; home?: number; away?: number; league?: string } = {},
): void {
  db.prepare(
    `INSERT INTO matches
       (id, league, home_team_id, away_team_id, kickoff_at, status, home_score, away_score, home_formation, away_formation)
     VALUES (?, ?, 'H', 'A', ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    extra.league ?? "eng.1",
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

/**
 * The lineup push fires on the SAME published signal the write gate uses: the
 * formation OR both sides having a starter. A competition that never emits a
 * formation still wakes its followers, and the copy names the mechanics that
 * just opened rather than only announcing the XI.
 */
function testLineupFallbackSignal() {
  const db = tempDb();
  seed(db);
  // No formation; both teams have a starter → published by the fallback.
  addMatch(db, "m_fb", "scheduled", minutesFromNow(60));
  db.exec(`
    INSERT INTO players (id, team_id, full_name) VALUES
      ('p1', 'H', 'Home Starter'), ('p2', 'A', 'Away Starter');
    INSERT INTO match_player_stats (match_id, player_id, team_id, started) VALUES
      ('m_fb', 'p1', 'H', 1), ('m_fb', 'p2', 'A', 1);
  `);
  assert.equal(queueMatchdayAlerts(db, NOW), 3, "fallback lineup push reaches every follower");
  assert.deepEqual(idsOf(db, "lineup"), ["u1", "u2", "u3"]);
  const text = queued(db).find((r) => r.kind === "lineup")?.text ?? "";
  assert.ok(text.includes("are open"), `copy names the opening set: ${text}`);

  // One side's starters alone must NOT open the gate.
  addMatch(db, "m_half", "scheduled", minutesFromNow(60));
  db.exec(
    "INSERT INTO match_player_stats (match_id, player_id, team_id, started) VALUES ('m_half', 'p1', 'H', 1)",
  );
  assert.equal(queueMatchdayAlerts(db, NOW), 0, "a single side's starters do not open the gate");
  db.close();
}

/**
 * Goal alerts fan out to followers of the scoring TEAM — club or national
 * side. The international favorites shelf stores national teams as ordinary
 * favorite_teams rows (a league-less team seen in e.g. fifa.world), so the
 * same producer must reach them: a user who favorited Brazil is woken by a
 * Brazil goal exactly like a Premier League follower, gated by the same
 * goals=0 switch and localized the same way.
 */
function testGoalAlertsCoverInternationalFavorites() {
  const db = tempDb();
  seed(db);
  // A national team: no domestic league, but a side in a fifa.world match —
  // the exact shape GET /api/teams files under the "international" shelf.
  db.exec(`
    INSERT INTO teams (id, name, short_name, league) VALUES
      ('N', 'National XI', 'NAT', '');
    INSERT INTO matches (id, league, home_team_id, away_team_id, kickoff_at, status, home_score, away_score)
      VALUES ('m_int', 'fifa.world', 'N', 'H', '2026-06-11T18:00:00.000Z', 'finished', 1, 0);
    INSERT INTO users (id, telegram_id, display_name, created_at) VALUES
      (4, 'u4', 'Four', '2026-01-01T00:00:00.000Z');
    INSERT INTO favorite_teams (user_id, team_id, is_favorite, created_at) VALUES
      (4, 'N', 1, '2026-01-01T00:00:00.000Z');
  `);
  // u2 follows the club H but muted goal alerts; u4 reads Persian.
  db.prepare(
    "INSERT INTO user_notification_prefs (user_id, goals, deadline, ratings, updated_at) VALUES (2, 0, 1, 1, ?)",
  ).run(NOW.toISOString());
  db.prepare("UPDATE users SET language = 'fa' WHERE id = 4").run();

  const queuedCount = queueGoalAlerts(db, [
    // The national team scores in its international fixture…
    { matchId: "m_int", scoringTeamId: "N", scorerName: "Neymar", minute: "23", homeScore: 1, awayScore: 0 },
    // …and the club scores in its league game.
    { matchId: "m_club", scoringTeamId: "H", scorerName: "Saka", minute: "55", homeScore: 2, awayScore: 1 },
  ]);

  const goals = queued(db).filter((r) => r.kind === "goal");
  assert.equal(queuedCount, goals.length, "the return value counts exactly the queued rows");

  const u1 = goals.find((r) => r.telegram_id === "u1");
  const u4 = goals.find((r) => r.telegram_id === "u4");
  assert.ok(u1, "the club follower gets the club goal");
  assert.ok(u4, "the international favorite gets the national-team goal");
  assert.ok(u1?.text.includes("GOAL 55'"), `club copy carries minute/score: ${u1?.text}`);
  assert.ok(u4?.text.includes("NAT"), `the national team's own name renders: ${u4?.text}`);
  assert.ok(u4?.text.includes("گل دقیقه"), `Persian reader gets Persian goal copy: ${u4?.text}`);

  // Queue-time gate: the muted follower never gets a row at all.
  assert.equal(
    goals.some((r) => r.telegram_id === "u2"),
    false,
    "goals=0 keeps the follower out of the queue entirely",
  );

  // A vanished team row (retention edge) is skipped without crashing.
  assert.equal(
    queueGoalAlerts(db, [
      { matchId: "x", scoringTeamId: "GHOST", scorerName: "?", minute: "1", homeScore: 0, awayScore: 0 },
    ]),
    0,
    "no followers of a missing team — no crash",
  );
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

/**
 * Following a COMPETITION (not just a club) subscribes to every match in it:
 * the matchday stages for any fixture the sync files under that slug, cups and
 * international tournaments included, and goals scored by clubs nobody follows.
 *
 * This is the "favorite leagues" promise from the Matches feed's picker. The
 * rules that matter are (a) a league follower needs no club favorite at all,
 * (b) a different league's fixtures never wake them, (c) a user who follows
 * BOTH the club and its league still gets exactly one push, and (d) the same
 * per-kind opt-out and deliverability gates apply.
 */
function testFollowedLeagueAlerts(): void {
  const db = tempDb();
  seed(db);
  db.exec(`
    -- The cup fixture is between two sides nobody follows, so any recipient
    -- below can only have come from the competition follow.
    INSERT INTO teams (id, name, short_name, league) VALUES
      ('C', 'Cup Home', 'CUP', ''), ('D', 'Cup Away', 'CUPA', '');
    INSERT INTO users (id, telegram_id, display_name, created_at) VALUES
      (5, 'u5', 'Five', '2026-01-01T00:00:00.000Z'),
      (6, 'u6', 'Six', '2026-01-01T00:00:00.000Z'),
      (7, 'u7', 'Seven', '2026-01-01T00:00:00.000Z'),
      (8, 'guest:league-guest', 'Guest', '2026-01-01T00:00:00.000Z');
    -- u5 follows the whole Premier League and no club; u6 follows a cup; u7 a
    -- different league entirely (the negative control); u8 is a browser guest.
    INSERT INTO followed_leagues (user_id, league, created_at) VALUES
      (5, 'eng.1', '2026-01-01T00:00:00.000Z'),
      (6, 'uefa.champions', '2026-01-01T00:00:00.000Z'),
      (7, 'esp.1', '2026-01-01T00:00:00.000Z'),
      (8, 'eng.1', '2026-01-01T00:00:00.000Z');
    INSERT INTO matches (id, league, home_team_id, away_team_id, kickoff_at, status, home_score, away_score)
      VALUES ('m_cup', 'uefa.champions', 'C', 'D', '2026-09-29T17:20:00.000Z', 'halftime', 1, 1);
  `);

  addMatch(db, "m_pool", "scheduled", minutesFromNow(90), { lineup: true });
  queueMatchdayAlerts(db, NOW);

  // (a) the league follower is reached for a fixture of the league they follow
  // on top of the three club followers of the fixture's sides;
  assert.deepEqual(
    idsOf(db, "lineup"),
    ["u1", "u2", "u3", "u5"],
    "eng.1 followers get the lineup push, with no club favorite in it",
  );
  // (b) a followed CUP behaves exactly like a league…
  const halftime = idsOf(db, "halftime");
  assert.ok(halftime.includes("u6"), "a followed CUP delivers its fixtures like any league");
  // …and (c) nobody else's follow leaks into that competition.
  assert.ok(!halftime.includes("u5"), "a league follower is not woken by another competition");
  assert.ok(!halftime.includes("u7"), "a different league's follower is left alone");
  assert.ok(!halftime.includes("u8"), "a browser guest never enters the queue");
  assert.ok(
    !halftime.includes("u1"),
    "club follows do not drag a user into an unfollowed competition's fixture",
  );
  db.close();
}

/** A followed league delivers goals in its matches, deduped against club follows. */
function testFollowedLeagueGoalAlerts(): void {
  const db = tempDb();
  seed(db);
  db.exec(`
    INSERT INTO teams (id, name, short_name, league) VALUES ('X', 'Xanthi', 'XAN', 'esp.1');
    INSERT INTO users (id, telegram_id, display_name, created_at) VALUES
      (5, 'u5', 'Five', '2026-01-01T00:00:00.000Z'),
      (6, 'u6', 'Six', '2026-01-01T00:00:00.000Z'),
      (7, 'u7', 'Seven', '2026-01-01T00:00:00.000Z'),
      (8, 'guest:league-guest', 'Guest', '2026-01-01T00:00:00.000Z');
    -- u5 follows esp.1 only; u6 follows esp.1 AND the scoring club X; u7 follows
    -- eng.1 (negative control); u8 is a browser guest following esp.1.
    INSERT INTO followed_leagues (user_id, league, created_at) VALUES
      (5, 'esp.1', '2026-01-01T00:00:00.000Z'),
      (6, 'esp.1', '2026-01-01T00:00:00.000Z'),
      (7, 'eng.1', '2026-01-01T00:00:00.000Z'),
      (8, 'esp.1', '2026-01-01T00:00:00.000Z');
    INSERT INTO favorite_teams (user_id, team_id, is_favorite, created_at) VALUES
      (6, 'X', 1, '2026-01-01T00:00:00.000Z');
    INSERT INTO user_notification_prefs (user_id, goals, deadline, ratings, updated_at) VALUES
      (7, 0, 1, 1, '2026-01-01T00:00:00.000Z');
    INSERT INTO matches (id, league, home_team_id, away_team_id, kickoff_at, status, home_score, away_score)
      VALUES ('m_esp', 'esp.1', 'X', 'H', '2026-09-29T17:00:00.000Z', 'live', 1, 0);
  `);

  const queuedCount = queueGoalAlerts(db, [
    { matchId: "m_esp", scoringTeamId: "X", scorerName: "Pione", minute: "12", homeScore: 1, awayScore: 0 },
  ]);

  const goals = queued(db).filter((r) => r.kind === "goal");
  const ids = goals.map((r) => r.telegram_id).sort();
  assert.equal(queuedCount, goals.length, "the return value counts exactly the queued rows");
  assert.ok(ids.includes("u5"), "a follower of the competition hears its goals without following a club");
  assert.ok(ids.includes("u6"), "a follower of the scoring club hears it too");
  assert.equal(ids.filter((id) => id === "u6").length, 1, "club + league follow is deduped to one push");
  assert.ok(!ids.includes("u7"), "an unrelated league's follower is left alone");
  assert.ok(!ids.includes("u8"), "a browser guest never enters the queue");
  assert.equal(
    goals.find((r) => r.telegram_id === "u5")?.text.includes("GOAL 12'"),
    true,
    "goal copy renders for the league follower",
  );

  // A goal whose match row is gone (retention edge) still fans out to the
  // scoring club's followers, and never crashes on the missing league.
  assert.equal(
    queueGoalAlerts(db, [
      { matchId: "gone", scoringTeamId: "X", scorerName: "P", minute: "60", homeScore: 2, awayScore: 0 },
    ]),
    1,
    "no match row means no league lookup — the club follower still hears it",
  );
  db.close();
}

/**
 * Accounts with no Telegram chat behind them never enter the queue. Browser
 * guests (`guest:<device>`), username accounts (`pwd:<name>`) and dev-token
 * users (`dev:<id>`) all live in `users` and can follow clubs — but a send to
 * those ids is a guaranteed failure (measured: every row ever queued in the dev
 * database targeted a guest, burned its retries, and landed in failed_at).
 */
function testDeliverabilityFilter() {
  const db = tempDb();
  seed(db);
  db.exec(`
    INSERT INTO users (id, telegram_id, display_name, created_at) VALUES
      (10, 'guest:device-a', 'Guest', '2026-01-01T00:00:00.000Z'),
      (11, 'pwd:alice', 'Alice', '2026-01-01T00:00:00.000Z'),
      (12, 'dev:900001', 'Dev', '2026-01-01T00:00:00.000Z');
    INSERT INTO favorite_teams (user_id, team_id, is_favorite, created_at) VALUES
      (10, 'H', 1, '2026-01-01T00:00:00.000Z'),
      (11, 'H', 0, '2026-01-01T00:00:00.000Z'),
      (12, 'H', 0, '2026-01-01T00:00:00.000Z');
  `);

  const queuedCount = queueGoalAlerts(db, [
    { matchId: "m_del", scoringTeamId: "H", scorerName: "Saka", minute: "55", homeScore: 2, awayScore: 1 },
  ]);

  assert.deepEqual(
    queued(db)
      .map((r) => r.telegram_id)
      .sort(),
    ["u1", "u2", "u3"],
    "only real Telegram chat ids are queued",
  );
  assert.equal(queuedCount, 3, "the count covers deliverable recipients only");
  db.close();
}

/**
 * PREDICTIONS_ENABLED=false retires the prediction lifecycle entirely: no
 * lineup/lock/half-time push is queued, a row already in the queue is skipped
 * at send time, and goal + ratings pushes keep working. Turning the flag back on
 * restores the old behaviour, which the tests above run under.
 */
function testPredictionPushesGatedOff() {
  const db = tempDb();
  seed(db);
  // One match in each prediction window: lineup published ~90 min out, lock
  // window at 30 min, and a match at half-time (the sub-board lock).
  addMatch(db, "m_lu", "scheduled", minutesFromNow(90), { lineup: true });
  addMatch(db, "m_lock", "scheduled", minutesFromNow(30));
  addMatch(db, "m_ht", "halftime", minutesFromNow(-50), { home: 1, away: 0 });
  // …plus a finished match for ratings and a scorer for goals.
  addMatch(db, "m_ft", "finished", minutesFromNow(-120), { home: 2, away: 1 });

  setPredictionsEnabledForTest(false);
  assert.equal(predictionsEnabled(), false, "test seam puts the flag off");

  // The finished fixture still produces its ratings push, so the sweep is not
  // silent — what must be missing is every prediction-lifecycle kind.
  assert.equal(queueMatchdayAlerts(db, NOW), 3, "flag off queues only the ratings push");
  assert.deepEqual(idsOf(db, "lineup"), [], "no lineup pushes");
  assert.deepEqual(idsOf(db, "lock"), [], "no lock pushes");
  assert.deepEqual(idsOf(db, "halftime"), [], "no half-time pushes");
  // Nothing was even claimed, so turning the flag back on can still send them.
  assert.deepEqual(idsOf(db, "ratings"), ["u1", "u2", "u3"], "ratings pushes still go out");

  const goalsOff = queueGoalAlerts(db, [
    { matchId: "m_ft", scoringTeamId: "H", scorerName: "Saka", minute: "55", homeScore: 2, awayScore: 1 },
  ]);
  assert.equal(goalsOff, 3, "goal alerts still deliver with predictions off");
  assert.deepEqual(idsOf(db, "goal"), ["u1", "u2", "u3"]);

  // Send-time gate: rows queued BEFORE the flag flipped (a previous deploy, or
  // the queue being filled while the flag was on) must not be delivered.
  assert.equal(shouldSkipPredictionPush("lineup"), true, "queued lineup rows are skipped when off");
  assert.equal(shouldSkipPredictionPush("lock"), true, "queued lock rows are skipped when off");
  assert.equal(shouldSkipPredictionPush("halftime"), true, "queued half-time rows are skipped when off");
  assert.equal(shouldSkipPredictionPush("goal"), false, "goal rows are never skipped");
  assert.equal(shouldSkipPredictionPush("ratings"), false, "ratings rows are never skipped");

  // Bot copy: no leaderboards command, and the welcome stops promising predictions.
  assert.deepEqual(
    botCommandMenu("en").map((c) => c.command),
    ["matches", "profile"],
    "leaderboards command hidden while predictions are off",
  );
  assert.ok(
    !/predict|leaderboard/i.test(botStartText("en")),
    `welcome must not promise predictions: ${botStartText("en")}`,
  );
  assert.ok(
    botStartText("fa").includes("نتایج زنده"),
    "Persian welcome reworded too",
  );

  // Flag on: the old behaviour returns for the same fixtures.
  setPredictionsEnabledForTest(true);
  assert.ok(queueMatchdayAlerts(db, NOW) > 0, "flag on queues the prediction lifecycle again");
  assert.deepEqual(idsOf(db, "lineup"), ["u1", "u2", "u3"], "lineup push is back");
  assert.deepEqual(idsOf(db, "lock"), ["u1", "u2", "u3"], "lock push is back");
  assert.deepEqual(idsOf(db, "halftime"), ["u1", "u2", "u3"], "half-time push is back");
  assert.equal(shouldSkipPredictionPush("lineup"), false, "send-time gate opens with the flag on");
  assert.ok(
    botCommandMenu("en").some((c) => c.command === "leaderboards"),
    "leaderboards command returns",
  );
  assert.ok(/predict lineups/.test(botStartText("en")), "original welcome returns");

  setPredictionsEnabledForTest(null);
  db.close();
}

export async function runNotificationTests(): Promise<void> {
  // The legacy-behaviour tests below assert that prediction pushes fire; they
  // run with the flag on, and testPredictionPushesGatedOff covers the off state.
  setPredictionsEnabledForTest(true);
  testDedupeAndBothClubs();
  testPreferenceGates();
  testWindowGates();
  testLineupFallbackSignal();
  testPerRecipientLanguage();
  testGoalAlertsCoverInternationalFavorites();
  testFollowedLeagueAlerts();
  testFollowedLeagueGoalAlerts();
  testKindColumnBackfill();
  testDeliverabilityFilter();
  testPredictionPushesGatedOff();
  console.log("  notifications: per-user dedupe, both-clubs dedupe, sweep idempotence OK");
  console.log("  notifications: per-kind queue + send-time gating, window gates OK");
  console.log("  notifications: per-recipient EN/FA copy, users.language backfill OK");
  console.log("  notifications: followed leagues deliver stages + goals, deduped against clubs OK");
  console.log("  notifications: guest/pwd/dev accounts never enter the push queue OK");
  console.log("  notifications: PREDICTIONS_ENABLED gates lineup/lock/halftime, goals+ratings survive OK");
}
