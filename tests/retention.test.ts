/**
 * Retention — the pruning rules that keep matchday.db from growing forever.
 * Real temp-file SQLite, real schema, real DELETEs: the point is to prove the
 * cutoff picks the right matches and the detail tables actually shrink while
 * the match rows, standings and predictions survive untouched.
 */
import { strict as assert } from "node:assert";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { migrate } from "../server/db/schema.js";
import {
  pruneFootballDetail,
  pruneSessions,
  SESSION_TTL_MS,
  RotatingLogger,
  logCapKb,
} from "../server/db/retention.js";

function tempDb(): { db: DatabaseSync; file: string } {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vkick-retention-")), "test.db");
  const db = new DatabaseSync(file);
  migrate(db);
  return { db, file };
}

const OLD = new Date(Date.now() - 200 * 24 * 3_600_000).toISOString(); // 200 days ago
const RECENT = new Date(Date.now() - 2 * 24 * 3_600_000).toISOString(); // 2 days ago

function seedMatch(db: DatabaseSync, id: string, kickoff: string, status = "finished"): void {
  db.prepare(
    `INSERT INTO teams (id, name, short_name, abbreviation, color, league) VALUES (?, ?, ?, '', '#000000', 'eng.1')`,
  ).run(`${id}h`, `Home ${id}`, id.toUpperCase());
  db.prepare(
    `INSERT INTO teams (id, name, short_name, abbreviation, color, league) VALUES (?, ?, ?, '', '#111111', 'eng.1')`,
  ).run(`${id}a`, `Away ${id}`, id.toUpperCase());
  db.prepare(
    `INSERT INTO matches (id, league, home_team_id, away_team_id, kickoff_at, status, home_score, away_score)
     VALUES (?, 'eng.1', ?, ?, ?, ?, 2, 1)`,
  ).run(id, `${id}h`, `${id}a`, kickoff, status);
}

function testPruneFootballDetail(): void {
  const { db } = tempDb();
  seedMatch(db, "old1", OLD);
  seedMatch(db, "new1", RECENT);
  seedMatch(db, "live1", OLD, "live"); // old but not finished: survives
  // A scheduled old match is also not a candidate (nothing to lose yet).
  seedMatch(db, "sched1", OLD, "scheduled");
  // One real player row (teams must exist first): match_player_stats
  // carries an FK to players(id), which itself references teams.
  db.prepare(
    `INSERT INTO players (id, team_id, full_name, short_name, position) VALUES ('p1', 'old1h', 'Test Player', 'TP', 'MID')`,
  ).run();

  for (const id of ["old1", "new1", "live1"]) {
    db.prepare(
      `INSERT INTO timeline_events (match_id, minute_display, minute_seconds, type, description)
       VALUES (?, '12:34', 754, 'goal', 'test event')`,
    ).run(id);
    db.prepare(
      `INSERT INTO match_commentary (match_id, sequence, minute_display, minute_seconds, text)
                VALUES (?, 1, '12', 720, 'line')`,
    ).run(id);
    db.prepare(`INSERT INTO match_team_stats (match_id, team_id, possession_pct) VALUES (?, ?, 55.0)`).run(
      id,
      `${id}h`,
    );
    db.prepare(
      `INSERT INTO match_player_stats (match_id, player_id, team_id, minutes_played) VALUES (?, 'p1', ?, 90)`,
    ).run(id, `${id}h`);
  }

  const result = pruneFootballDetail(db);
  assert.equal(result.candidates, 1, "only old finished matches are candidates");
  assert.equal(result.deleted.timeline_events, 1);
  assert.equal(result.deleted.match_commentary, 1);
  assert.equal(result.deleted.match_team_stats, 1);
  assert.equal(result.deleted.match_player_stats, 1);

  // Detail gone for the stale match…
  const oldDetail = db.prepare(`SELECT COUNT(*) AS n FROM timeline_events WHERE match_id = 'old1'`).get() as {
    n: number;
  };
  assert.equal(oldDetail.n, 0, "stale match detail pruned");

  // …untouched for everything else.
  const survivors = db.prepare(`SELECT COUNT(*) AS n FROM timeline_events`).get() as { n: number };
  assert.equal(survivors.n, 2, "recent + live match detail survives");

  // Core tables untouched: match rows, teams, and the scores stay readable.
  const matches = db.prepare(`SELECT COUNT(*) AS n FROM matches`).get() as { n: number };
  assert.equal(matches.n, 4, "match rows are never deleted");
  const oldMatch = db.prepare(`SELECT home_score, away_score FROM matches WHERE id = 'old1'`).get() as {
    home_score: number;
    away_score: number;
  };
  assert.deepEqual([oldMatch.home_score, oldMatch.away_score], [2, 1], "results stay queryable");

  // Idempotent: a second sweep finds nothing new.
  const again = pruneFootballDetail(db);
  assert.equal(again.candidates, 0);
}

function testPruneSessions(): void {
  const { db } = tempDb();
  const now = Date.now();
  const stale = new Date(now - SESSION_TTL_MS - 3_600_000).toISOString();
  const fresh = new Date(now - 3_600_000).toISOString();
  db.prepare(`INSERT INTO users (telegram_id, display_name, created_at) VALUES ('u1', 'U1', ?)`).run(stale);
  db.prepare(`INSERT INTO users (telegram_id, display_name, created_at) VALUES ('u2', 'U2', ?)`).run(fresh);
  db.prepare(
    `INSERT INTO user_sessions (token, user_id, created_at, last_used_at) VALUES ('mg_stale', 1, ?, ?)`,
  ).run(stale, stale);
  db.prepare(
    `INSERT INTO user_sessions (token, user_id, created_at, last_used_at) VALUES ('mg_fresh', 2, ?, ?)`,
  ).run(fresh, fresh);

  const pruned = pruneSessions(db, now);
  assert.equal(pruned, 1, "only sessions idle past the TTL go");
  const left = db.prepare(`SELECT token FROM user_sessions`).all() as Array<{ token: string }>;
  assert.deepEqual(
    left.map((r) => r.token),
    ["mg_fresh"],
    "the recently-used session survives",
  );
}

function testRetentionZeroDisables(): void {
  const { db } = tempDb();
  seedMatch(db, "old1", OLD);
  db.prepare(
    `INSERT INTO timeline_events (match_id, minute_display, minute_seconds, type, description)
     VALUES ('old1', '12:34', 754, 'goal', 'test event')`,
  ).run();

  const prev = process.env.RETENTION_DAYS;
  process.env.RETENTION_DAYS = "0";
  try {
    const result = pruneFootballDetail(db);
    assert.equal(result.candidates, 0, "days=0 keeps everything forever");
    const left = db.prepare(`SELECT COUNT(*) AS n FROM timeline_events`).get() as { n: number };
    assert.equal(left.n, 1);
  } finally {
    if (prev === undefined) delete process.env.RETENTION_DAYS;
    else process.env.RETENTION_DAYS = prev;
  }
}

function testRotatingLogger(): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vkick-log-"));
  const file = path.join(dir, "api.log");
  const log = new RotatingLogger(file, 1); // 1KB cap
  const line = "x".repeat(200) + "\n";
  for (let i = 0; i < 10; i += 1) log.append(line); // 2KB total → one rotation
  assert.ok(fs.existsSync(`${file}.1`), "the previous generation rotates to .1");
  const live = fs.statSync(file).size;
  assert.ok(live <= 1024 + 200, `live file stays near the cap (got ${live})`);
  const gen1 = fs.statSync(`${file}.1`).size;
  assert.ok(gen1 > 0, "the rotated generation has content");
}

function testLogCapKb(): void {
  const prev = process.env.RETENTION_LOG_KB;
  try {
    process.env.RETENTION_LOG_KB = "0";
    assert.equal(logCapKb(), 0, "0 disables the cap");
    process.env.RETENTION_LOG_KB = "junk";
    assert.equal(logCapKb(), 512, "junk falls back to the default");
    delete process.env.RETENTION_LOG_KB;
    assert.equal(logCapKb(), 512, "unset uses the default");
  } finally {
    if (prev === undefined) delete process.env.RETENTION_LOG_KB;
    else process.env.RETENTION_LOG_KB = prev;
  }
}

export function runRetentionTests(): void {
  testPruneFootballDetail();
  testPruneSessions();
  testRetentionZeroDisables();
  testRotatingLogger();
  testLogCapKb();
  console.log("  retention: cutoff windows, detail pruning, session sweep, log rotation OK");
}
