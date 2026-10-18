/**
 * The staleness sentinel: the rules that keep a live-score feed honest.
 *
 * 1. Healthy data + a live loop send nothing — the silent no-op is the point.
 * 2. A live match untouched for 15+ minutes is stale, and stale triggers the
 *    alert exactly ONCE until the cooldown (30 min) has run its course: the
 *    hourly check must not spam a matchday with the same warning.
 * 3. A followed competition with no fixture within ±7 days is flagged as quiet.
 * 4. Pass bookkeeping: one completed pass clears a failure streak; failures
 *    accumulate until then.
 */
import { strict as assert } from "node:assert";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { migrate } from "../server/db/schema.js";
import {
  checkAndAlert,
  recordSyncPassFail,
  recordSyncPassOk,
  resetSentinelStateForTest,
  syncHealthSnapshot,
  syncPassHealth,
} from "../server/sync/sentinel.js";

const NOW = new Date("2026-10-18T18:00:00.000Z");

export function runSentinelTests(): void {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "verdikick-sentinel-")), "test.db");
  const db = new DatabaseSync(file);
  migrate(db);
  resetSentinelStateForTest();

  // Teams and users first: matches carries real foreign keys.
  db.exec(`
    INSERT INTO teams (id, name, short_name, league) VALUES ('H', 'Home FC', 'Home', 'eng.1'), ('A', 'Away FC', 'Away', 'eng.1');
    INSERT INTO users (id, telegram_id, display_name, created_at) VALUES (1, 'u1', 'One', '2026-01-01T00:00:00.000Z');
    INSERT INTO followed_leagues (user_id, league, created_at) VALUES (1, 'eng.1', '2026-01-01T00:00:00.000Z');
    INSERT INTO matches (id, league, home_team_id, away_team_id, kickoff_at, status, home_score, away_score, last_synced_at) VALUES
      ('m1', 'eng.1', 'H', 'A', '${new Date(NOW.getTime() + 60_000).toISOString()}', 'live', 1, 0, '${NOW.toISOString()}');
  `);

  const healthy = syncHealthSnapshot(db, NOW);
  assert.equal(healthy.staleLive, 0, "a freshly-synced live match is not stale");
  assert.equal(healthy.quietFollowedLeagues.length, 0, "a league with a fixture ±7d is not quiet");
  assert.ok(healthy.latestLastSyncedAt, "the ledger date is present");

  // Healthy check sends nothing.
  const sent: string[] = [];
  const quiet1 = checkAndAlert(db, (t) => sent.push(t), NOW);
  assert.equal(quiet1.alerted, false, "healthy data never alerts");
  assert.equal(quiet1.problem, null, "healthy data reports no problem");
  assert.equal(sent.length, 0, "no transport traffic when healthy");

  // A live row long past kickoff is stuck: the sentinel flags it as never
  // reconciled (the read-time fallback still serves it as finished).
  db.prepare(
    `INSERT INTO matches (id, league, home_team_id, away_team_id, kickoff_at, status, home_score, away_score, last_synced_at)
     VALUES ('m2', 'eng.1', 'H', 'A', ?, 'live', 1, 0, ?)`,
  ).run(new Date(NOW.getTime() - 6 * 3_600_000).toISOString(), NOW.toISOString());
  const stuck = syncHealthSnapshot(db, NOW);
  assert.equal(stuck.stuckLive, 1, "a live match 6h past kickoff is stuck");

  // The live row goes stale (sync stopped mid-match): one alert, then cooldown.
  db.prepare(
    "UPDATE matches SET last_synced_at = ? WHERE id = 'm1'",
  ).run(new Date(NOW.getTime() - 20 * 60_000).toISOString());
  const stale = syncHealthSnapshot(db, NOW);
  assert.equal(stale.staleLive, 1, "a live match 20 min untouched is stale");

  const alert1 = checkAndAlert(db, (t) => sent.push(t), NOW);
  assert.equal(alert1.alerted, true, "stale live matches alert");
  assert.match(sent[0] ?? "", /live match/i, "the alert names the finding");
  assert.ok(alert1.problem?.includes("live match"), `the problem line names staleness: ${alert1.problem}`);
  assert.match(alert1.problem ?? "", /reconciled/i, "the alert names the stuck live match");

  const alert2 = checkAndAlert(db, (t) => sent.push(t), new Date(NOW.getTime() + 60_000));
  assert.equal(alert2.alerted, false, "the cooldown suppresses repeat alerts");
  assert.equal(sent.length, 1, "exactly one transport send per cooldown window");
  assert.ok(alert2.problem, "the suppressed check still reports the problem for logs/ops");

  // Away from staleness, back to healthy → nothing further.
  db.prepare("UPDATE matches SET last_synced_at = ? WHERE id = 'm1'").run(NOW.toISOString());
  const before = sent.length;
  checkAndAlert(db, (t) => sent.push(t), new Date(NOW.getTime() + 120_000));
  assert.equal(sent.length, before, "recovered data stops the alerting");

  // Quiet followed league: eng.1 keeps its ±7d fixture, a second followed
  // league with nothing anywhere near the window is flagged.
  db.prepare(
    "INSERT INTO followed_leagues (user_id, league, created_at) VALUES (1, 'uefa.champions', '2026-01-01T00:00:00.000Z')",
  ).run();
  const snap2 = syncHealthSnapshot(db, NOW);
  assert.deepEqual(snap2.quietFollowedLeagues, ["uefa.champions"], "the empty competition is named");
  db.prepare("DELETE FROM followed_leagues WHERE league = 'uefa.champions'").run();

  // Pass bookkeeping: failures accumulate, one OK clears the streak.
  resetSentinelStateForTest();
  recordSyncPassFail();
  recordSyncPassFail();
  assert.equal(syncPassHealth().consecutiveFailures, 2, "failures accumulate");
  assert.equal(syncPassHealth().lastOkMs, null, "no completed pass so far");
  recordSyncPassOk();
  assert.equal(syncPassHealth().consecutiveFailures, 0, "a completed pass clears the streak");
  assert.ok(syncPassHealth().lastOkMs, "a completed pass stamps the ledger");

  db.close();
}
