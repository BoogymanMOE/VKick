/**
 * Tests for the dev-only demo seed.
 *
 * The pure helpers are tested directly; the database half runs against a
 * throwaway SQLite file with a couple of hand-made fixtures, which is enough
 * to prove the important guarantee — that seeding a database with real matches
 * produces ledger rows through award() rather than hand-written totals.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "../server/db/schema.js";
import {
  DEMO_TELEGRAM_ID_BASE,
  DEMO_TELEGRAM_ID_END,
  DEMO_USER_MAX,
  assertNotProduction,
  correctStarterCount,
  demoRating,
  mixLineup,
  planDemoUsers,
  seedDemoData,
} from "../server/dev/seedDemoData.js";

export function runSeedDemoTests(): void {
  /* ---------------------------------------------------- production guard */

  assert.throws(
    () => assertNotProduction({ NODE_ENV: "production" }),
    /refuses to run/,
    "NODE_ENV=production must be refused",
  );
  assert.throws(() => assertNotProduction({ NODE_ENV: " prod " }), /refuses to run/);
  assert.throws(() => assertNotProduction({ NODE_ENV: "PROD" }), /refuses to run/);
  // Everything else is allowed through — a missing NODE_ENV is the common dev case.
  assert.doesNotThrow(() => assertNotProduction({}));
  assert.doesNotThrow(() => assertNotProduction({ NODE_ENV: "" }));
  assert.doesNotThrow(() => assertNotProduction({ NODE_ENV: "development" }));
  assert.doesNotThrow(() => assertNotProduction({ NODE_ENV: "staging" }));

  /* ---------------------------------------------------- cohort planning */

  const cohort = planDemoUsers(6);
  assert.equal(cohort.length, 6);
  assert.equal(cohort[0]?.telegramId, String(DEMO_TELEGRAM_ID_BASE));
  // Ids are unique and inside the range clearDemoData() sweeps.
  assert.equal(new Set(cohort.map((u) => u.telegramId)).size, 6);
  for (const u of cohort) {
    const n = Number(u.telegramId);
    assert.ok(Number.isInteger(n));
    assert.ok(n >= DEMO_TELEGRAM_ID_BASE && n < DEMO_TELEGRAM_ID_END);
    assert.match(u.displayName, /^Demo User \d+$/, "demo names must be obviously fake");
  }
  // Clamped, and rubbish input does not produce an empty or infinite cohort.
  assert.equal(planDemoUsers(0).length, 1);
  assert.equal(planDemoUsers(-5).length, 1);
  assert.equal(planDemoUsers(99999).length, DEMO_USER_MAX);
  assert.equal(planDemoUsers(Number.NaN).length, 1);
  // A cohort must be able to exceed one leaderboard page, or own-rank beyond
  // the top 100 can never be exercised with demo data.
  assert.ok(planDemoUsers(120).length === 120, "120 users must be seedable");
  assert.ok(
    Number(planDemoUsers(120).at(-1)!.telegramId) < DEMO_TELEGRAM_ID_END,
    "every demo id must fall inside the --reset range",
  );

  /* ---------------------------------------------------- lineup mixing */

  const starters = Array.from({ length: 11 }, (_, i) => `1000${i}`);
  const squad = [...starters, ...Array.from({ length: 12 }, (_, i) => `2000${i}`)];

  assert.equal(mixLineup(starters, squad, 11).length, 11);
  assert.equal(mixLineup(starters, squad, 0).length, 11);

  // Asking for 4 of the real 11 still yields a full, legal XI…
  const short = mixLineup(starters, squad, 4);
  assert.equal(short.length, 11);
  // …and never repeats a player, which validatePayload would reject outright.
  assert.equal(new Set(short).size, 11, "no duplicate player ids");
  // Exactly the requested number of actual starters made it in: padding runs
  // strictly through the bench and must not leak extra correct picks.
  assert.equal(short.filter((id) => starters.includes(id)).length, 4);

  // A squad that is nothing but starters cannot be padded to 11 — the caller
  // skips those fixtures rather than shipping an illegal payload.
  const noBench = mixLineup(starters, starters, 4);
  assert.equal(noBench.length, 4);
  // A full squad of 11 starters plus a bench does fill exactly 11.
  assert.equal(mixLineup(starters, squad, 11).length, 11);

  // Score ladder stays inside the 11 a lineup can be worth.
  for (let skill = 0; skill <= 1; skill += 0.25) {
    for (let seed = 0; seed < 50; seed++) {
      const rng = () => ((seed * 37) % 100) / 100;
      const n = correctStarterCount(skill, rng);
      assert.ok(Number.isInteger(n) && n >= 0 && n <= 11, `correctStarterCount out of range: ${n}`);
    }
  }
  // Endpoints of the ladder: skill sets the band, the rng can move it ±2.
  assert.equal(
    correctStarterCount(0, () => 0),
    2,
  ); // base 4, worst jitter
  assert.equal(
    correctStarterCount(0, () => 1),
    6,
  ); // base 4, best jitter
  assert.equal(
    correctStarterCount(1, () => 0),
    7,
  ); // base 9, worst jitter
  assert.equal(
    correctStarterCount(1, () => 1),
    11,
  ); // base 9, best jitter — capped
  // Out-of-range / junk skill degrades to the middle rather than going wild.
  assert.equal(
    correctStarterCount(Number.NaN, () => 0),
    2,
  );
  assert.equal(
    correctStarterCount(99, () => 1),
    11,
  );

  /* ---------------------------------------------------- rating histogram shape */

  {
    // The seed exists to make the rating histogram renderable, so it must not
    // collapse into a handful of buckets: the chart groups 1..10 and a seed
    // emitting only 6..9 leaves most of it permanently flat.
    const seen = new Set<number>();
    for (let i = 0; i < 4000; i++) seen.add(demoRating(mulberry(i)));
    assert.ok(seen.size >= 7, `rating pool too narrow: ${[...seen].sort((a, b) => a - b).join(",")}`);
    for (const v of seen) assert.ok(v >= 1 && v <= 10, `rating out of range: ${v}`);
    // Still bell-shaped: the middle of the scale must dominate.
    const mid = [...seen].filter((v) => v >= 6 && v <= 8).length;
    assert.ok(mid >= 3, "ratings should cluster in the middle of the scale");
    // Deterministic: the same seed reproduces the same board.
    assert.equal(demoRating(mulberry(7)), demoRating(mulberry(7)));
  }

  /* ---------------------------------------------------- end-to-end (temp db) */

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vkick-seed-"));
  const db = new DatabaseSync(path.join(dir, "seed.db"));
  try {
    migrate(db);
    seedFixture(db);

    const before = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      assert.throws(() => seedDemoData(db, { users: 2 }), /refuses to run/);
    } finally {
      if (before === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = before;
    }
    // The guard fired before any write.
    assert.equal(count(db, "users"), 0);
    assert.equal(count(db, "point_ledger"), 0);

    const report = seedDemoData(db, { users: 3, matches: 3 });
    assert.equal(report.users, 3);
    assert.equal(report.matchesUsed, 3);
    assert.ok(report.predictions >= 9, `expected >=9 predictions, got ${report.predictions}`);
    assert.ok(report.awards > 0, "seed must write ledger awards");
    assert.ok(report.totalPoints > 0);

    // Leaderboard totals came from award(), so they equal the ledger sum.
    const ledger = scalar(db, "SELECT COALESCE(SUM(points), 0) FROM point_ledger");
    const totals = scalar(db, "SELECT COALESCE(SUM(total), 0) FROM user_point_totals WHERE scope = 'global'");
    assert.equal(totals, ledger, "global totals must reconcile with the ledger");
    assert.equal(ledger, report.totalPoints);

    // Every prediction round-tripped the real validator.
    const bad = db.prepare("SELECT COUNT(*) FROM predictions WHERE json_valid(payload) = 0").get() as {
      "COUNT(*)": number;
    };
    assert.equal(Number(bad["COUNT(*)"]), 0);

    // No demo credentials: demo accounts must not be loggable-in.
    assert.equal(count(db, "user_credentials"), 0);
    assert.equal(count(db, "user_sessions"), 0);

    // Re-running must not double-pay (ledger UNIQUE(source, source_id)).
    seedDemoData(db, { users: 3, matches: 3 });
    assert.equal(scalar(db, "SELECT COALESCE(SUM(points), 0) FROM point_ledger"), ledger);

    // Reset wipes the cohort and only the cohort.
    seedDemoData(db, { users: 1, matches: 1, reset: true });
    assert.equal(count(db, "users"), 1);
    assert.ok(scalar(db, "SELECT COALESCE(SUM(points), 0) FROM point_ledger") > 0);
    assert.equal(count(db, "matches"), 4, "reset must not touch real synced data");
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }

  /* ---------------------------------------------------- empty database */

  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), "vkick-seed-empty-"));
  const db2 = new DatabaseSync(path.join(dir2, "seed.db"));
  try {
    migrate(db2);
    // No matches synced: fail loudly rather than inventing fixtures.
    assert.throws(() => seedDemoData(db2, {}), /no finished matches/);
  } finally {
    db2.close();
    fs.rmSync(dir2, { recursive: true, force: true });
  }

  console.log(
    "  seedDemo: production refusal, cohort clamps, lineups, ledger reconciliation, rating histogram, reset safety OK",
  );
}

/** Tiny deterministic RNG so the histogram assertions are reproducible. */
function mulberry(i: number): () => number {
  let a = i >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------ fixtures */

function count(db: DatabaseSync, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
  return Number(row.n);
}

function scalar(db: DatabaseSync, sql: string): number {
  const row = db.prepare(sql).get() as Record<string, number>;
  return Number(Object.values(row)[0] ?? 0);
}

/** Two teams, four fixtures (three finished, one upcoming), full squads. */
function seedFixture(db: DatabaseSync): void {
  db.exec(`
    INSERT INTO teams (id, name, league) VALUES
      ('t1', 'Alpha FC', 'eng.1'), ('t2', 'Beta United', 'eng.1');
  `);

  for (const match of [
    { id: "m1", ko: "2026-09-01T18:00:00Z", status: "finished" },
    { id: "m2", ko: "2026-09-08T18:00:00Z", status: "finished" },
    { id: "m3", ko: "2026-09-15T18:00:00Z", status: "finished" },
    { id: "m4", ko: "2030-01-01T18:00:00Z", status: "scheduled" },
  ]) {
    db.prepare(
      `INSERT INTO matches (id, league, home_team_id, away_team_id, kickoff_at, status, home_formation, away_formation)
         VALUES (?, 'eng.1', 't1', 't2', ?, ?, '4-3-3', '4-4-2')`,
    ).run(match.id, match.ko, match.status);
  }

  // 22 players a side: 11 starters recorded for the finished matches.
  for (let team = 1; team <= 2; team++) {
    for (let p = 1; p <= 22; p++) {
      db.prepare(`INSERT INTO players (id, team_id, full_name, position) VALUES (?, ?, ?, 'MID')`).run(
        `${team}${String(p).padStart(2, "0")}`,
        `t${team}`,
        `Player ${team}-${p}`,
      );
    }
  }

  const stmt = db.prepare(
    `INSERT INTO match_player_stats (match_id, player_id, team_id, started, goals, shots_on_target)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const matchId of ["m1", "m2", "m3"]) {
    for (let team = 1; team <= 2; team++) {
      for (let p = 1; p <= 11; p++) {
        stmt.run(
          matchId,
          `${team}${String(p).padStart(2, "0")}`,
          `t${team}`,
          1,
          p === 1 ? 1 : 0,
          p <= 4 ? 2 : 0,
        );
      }
    }
  }
}
