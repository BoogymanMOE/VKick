/**
 * The matchday feed window. This is the query that decides what a user sees
 * when they open the app, so it is tested against a REAL SQLite database with
 * the real schema and real rows — the generated SQL is executed, not just
 * string-matched.
 *
 * The bug it guards: the feed was `ORDER BY kickoff_at ASC LIMIT 300`, which
 * is not relevance, it is "the oldest 300 rows in the table". Once history
 * outgrew the cap, 2024 internationals sat at the top of the matchday screen
 * and the nearest fixtures were dropped entirely.
 */
import { strict as assert } from "node:assert";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { migrate } from "../server/db/schema.js";
import { buildFeedQuery, isoDayOffset, FEED_LIMIT } from "../server/matches/feed.js";

/** Fixed clock so the window never drifts with the wall clock. */
const NOW = new Date("2026-10-03T12:00:00.000Z");
const day = (offsetDays: number) => isoDayOffset(NOW, offsetDays);

function tempDb(): DatabaseSync {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vkick-feed-")), "test.db");
  const db = new DatabaseSync(file);
  migrate(db);
  return db;
}

function seed(db: DatabaseSync, id: string, kickoff: string, status: string, league = "eng.1"): void {
  db.prepare(
    `INSERT INTO teams (id, name, short_name, abbreviation, color, league) VALUES (?, ?, ?, '', '#000000', ?)`,
  ).run(`${id}h`, `Home ${id}`, id, league);
  db.prepare(
    `INSERT INTO teams (id, name, short_name, abbreviation, color, league) VALUES (?, ?, ?, '', '#111111', ?)`,
  ).run(`${id}a`, `Away ${id}`, id, league);
  db.prepare(
    `INSERT INTO matches (id, league, home_team_id, away_team_id, kickoff_at, status, home_score, away_score)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    league,
    `${id}h`,
    `${id}a`,
    kickoff,
    status,
    status === "scheduled" ? null : 2,
    status === "scheduled" ? null : 1,
  );
}

/** Runs the generated feed SQL exactly as the route does. */
function runFeed(
  db: DatabaseSync,
  q: Parameters<typeof buildFeedQuery>[0] = {},
): Array<{ id: string; status: string; kickoff_at: string }> {
  const feed = buildFeedQuery({ now: NOW, ...q });
  return db
    .prepare(
      `SELECT m.id, m.status, m.kickoff_at
       FROM matches m
       JOIN teams th ON th.id = m.home_team_id
       JOIN teams ta ON ta.id = m.away_team_id
       WHERE ${feed.where}
       ORDER BY ${feed.orderBy}
       LIMIT ?`,
    )
    .all(...feed.params, feed.limit) as Array<{ id: string; status: string; kickoff_at: string }>;
}

/** The window keeps what matters now and drops the archaeology. */
function testRelevanceWindow(): void {
  const db = tempDb();
  seed(db, "live1", `${day(0)}T15:00Z`, "live");
  seed(db, "ht1", `${day(0)}T16:00Z`, "halftime");
  seed(db, "recent", `${day(-1)}T15:00Z`, "finished");
  seed(db, "edge_old", `${day(-3)}T15:00Z`, "finished"); // exactly on the boundary
  seed(db, "too_old", `${day(-4)}T15:00Z`, "finished");
  seed(db, "soon", `${day(2)}T15:00Z`, "scheduled");
  seed(db, "edge_far", `${day(14)}T15:00Z`, "scheduled"); // exactly on the boundary
  seed(db, "too_far", `${day(15)}T15:00Z`, "scheduled");
  seed(db, "ancient", "2024-03-26T17:00Z", "finished"); // the old feed's top row

  const ids = runFeed(db).map((r) => r.id);

  assert.ok(ids.includes("live1"), "a live match is always in the feed");
  assert.ok(ids.includes("ht1"), "half-time counts as in progress");
  assert.ok(ids.includes("recent"), "yesterday's result is in the feed");
  assert.ok(ids.includes("edge_old"), "the lookback boundary day is inclusive");
  assert.ok(ids.includes("soon"), "the next fixture is in the feed");
  assert.ok(ids.includes("edge_far"), "the lookahead boundary day is inclusive");
  assert.ok(!ids.includes("too_old"), "4 days back is outside the window");
  assert.ok(!ids.includes("too_far"), "15 days ahead is outside the window");
  assert.ok(
    !ids.includes("ancient"),
    "2024 football is NOT at the top of the matchday feed any more — the regression",
  );
}

/**
 * Ordering has to put the live moment first (PRODUCT.md rule 1: the live match
 * owns the screen) and results newest-first.
 */
function testOrdering(): void {
  const db = tempDb();
  seed(db, "old_result", `${day(-2)}T15:00Z`, "finished");
  seed(db, "new_result", `${day(-1)}T15:00Z`, "finished");
  seed(db, "later_fixture", `${day(9)}T15:00Z`, "scheduled");
  seed(db, "sooner_fixture", `${day(1)}T15:00Z`, "scheduled");
  seed(db, "the_live_one", `${day(0)}T15:00Z`, "live");

  const rows = runFeed(db);
  const order = rows.map((r) => r.id);
  assert.equal(order[0], "the_live_one", "the live match leads, never buried under results");
  assert.equal(order[1], "sooner_fixture", "the next fixture is soonest");
  assert.equal(order[2], "later_fixture", "then the one further out");
  assert.deepEqual(order.slice(3), ["new_result", "old_result"], "results read newest-first");
}

/** An explicit from/to pair is an inclusive range and ignores status. */
function testExplicitRange(): void {
  const db = tempDb();
  seed(db, "before", `${day(-5)}T15:00Z`, "finished"); // outside the range
  seed(db, "start_day", `${day(-2)}T15:00Z`, "finished");
  seed(db, "middle", `${day(0)}T15:00Z`, "live");
  seed(db, "end_day", `${day(3)}T15:00Z`, "scheduled");
  seed(db, "after", `${day(9)}T15:00Z`, "scheduled"); // outside the range

  const ids = runFeed(db, { from: day(-2), to: day(3) }).map((r) => r.id);
  assert.deepEqual(ids.sort(), ["end_day", "middle", "start_day"], "both end days included");
}

/** A single `date` still means one specific day, whatever its status. */
function testSingleDay(): void {
  const db = tempDb();
  seed(db, "d0", `${day(0)}T15:00Z`, "live");
  seed(db, "d1", `${day(-1)}T15:00Z`, "finished");
  seed(db, "d2", `${day(-1)}T20:00Z`, "finished"); // same day as d1
  const ids = runFeed(db, { date: day(-1) }).map((r) => r.id);
  assert.deepEqual(ids.sort(), ["d1", "d2"], "a day query ignores the window entirely");
}

/** The league filter composes with the window rather than replacing it. */
function testLeagueFilter(): void {
  const db = tempDb();
  seed(db, "epl", `${day(0)}T15:00Z`, "live", "eng.1");
  seed(db, "laliga", `${day(0)}T17:00Z`, "live", "esp.1");
  seed(db, "stale_epl", `${day(-30)}T15:00Z`, "finished", "eng.1");
  const ids = runFeed(db, { league: "esp.1" }).map((r) => r.id);
  assert.deepEqual(ids, ["laliga"], "only the requested competition, window still applied");
}

/** The cap is honoured, clamped, and doesn't silently become unbounded. */
function testLimit(): void {
  const db = tempDb();
  for (let i = 0; i < 12; i += 1) seed(db, `m${i}`, `${day(1)}T1${i}:00Z`, "scheduled");
  assert.equal(runFeed(db).length, 12, "a small fixture set comes back whole");
  assert.equal(runFeed(db, { limit: "5" }).length, 5, "an explicit limit is applied");
  assert.equal(
    buildFeedQuery({ limit: "0" }).limit,
    FEED_LIMIT,
    "0 falls back to the default rather than meaning 'no rows'",
  );
  assert.equal(buildFeedQuery({ limit: "-4" }).limit, FEED_LIMIT, "a negative limit falls back too");
  assert.equal(buildFeedQuery({ limit: "abc" }).limit, FEED_LIMIT, "a non-numeric limit falls back");
  assert.equal(buildFeedQuery({ limit: "99999" }).limit, 500, "clamped at 500");
}

/**
 * The whole point of the fix: with more than the cap in the table, the NEAREST
 * fixtures must still be present. The old ASC+LIMIT query lost them.
 */
function testNearestFixturesSurviveTheCap(): void {
  const db = tempDb();
  // 400 results from long ago (as a season's worth of history would be) ...
  for (let i = 0; i < 400; i += 1) {
    const d = new Date(NOW.getTime());
    d.setUTCDate(d.getUTCDate() - (10 + i));
    seed(db, `hist${i}`, `${d.toISOString().slice(0, 10)}T15:00Z`, "finished");
  }
  // ... plus the tail that IS in the window, and tomorrow's fixture, which the
  // old ASC+LIMIT query pushed out entirely.
  seed(db, "recent1", `${day(-1)}T15:00Z`, "finished");
  seed(db, "recent2", `${day(-2)}T15:00Z`, "finished");
  seed(db, "tomorrow", `${day(1)}T15:00Z`, "scheduled");

  const ids = runFeed(db).map((r) => r.id);
  assert.ok(ids.includes("tomorrow"), "the next fixture survives 400 rows of history");
  assert.deepEqual(
    ids.filter((id) => id.startsWith("hist")),
    [],
    "all 400 deep-history results are excluded",
  );
  assert.deepEqual(
    ids.filter((id) => id.startsWith("recent")),
    ["recent1", "recent2"],
    "only the in-window tail of history survives",
  );
}

export function runFeedTests(): void {
  testRelevanceWindow();
  testOrdering();
  testExplicitRange();
  testSingleDay();
  testLeagueFilter();
  testLimit();
  testNearestFixturesSurviveTheCap();
  console.log("  feed: relevance window, ordering, range/day/league filters, cap OK");
}
