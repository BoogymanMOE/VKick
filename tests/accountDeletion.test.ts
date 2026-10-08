/**
 * Account deletion, driven over real HTTP against a throwaway database.
 *
 * The promise: `DELETE /api/me` removes EVERY row the caller owns, in one
 * transaction, and leaves everybody else alone. The zero-check is deliberately
 * TABLE-AGNOSTIC — it enumerates `sqlite_master` and, for each table, counts
 * rows whose owner column(s) name the user. No hard-coded table list means a
 * table added later cannot silently escape the sweep.
 *
 * The "victim" is seeded with rows in every table that carries an owner column,
 * and the test refuses to pass unless all of them were non-empty beforehand —
 * so a new owner table makes this suite fail loudly instead of vacuously.
 * A second user's counts are compared before/after to prove isolation, and the
 * referral graph is exercised in BOTH directions (the victim as invitee and as
 * referrer).
 *
 * WHY A CHILD PROCESS: the route modules call `getDb()` at module scope and
 * capture the handle; ESM caches modules for the process, so router-driving
 * suites cannot share one process (see tests/guestMerge.test.ts).
 */
import { strict as assert } from "node:assert";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { AddressInfo } from "node:net";
import express from "express";
import { closeDb, getDb, run } from "../server/db/index.js";

const CHILD_FLAG = "VKICK_ACCOUNT_DELETE_CHILD";
const SUMMARY =
  "  accountDeletion: every owned table swept (sqlite_master-driven), second user untouched, both referral directions OK";

/** The four columns that can name a user, mirrored from accountDeletion.ts. */
const OWNER_COLUMNS = ["user_id", "referrer_user_id", "invitee_user_id", "telegram_id"] as const;

interface Res {
  status: number;
  body: Record<string, unknown> | null;
}

function listen(app: express.Express): Promise<{ port: number; close: () => Promise<void> }> {
  const server = app.listen(0);
  return new Promise((resolve) => {
    server.once("listening", () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ port, close: () => new Promise<void>((r) => server.close(() => r())) });
    });
  });
}

function parseBody(buf: string): Record<string, unknown> | null {
  if (!buf) return null;
  try {
    return JSON.parse(buf) as Record<string, unknown>;
  } catch {
    return { raw: buf.slice(0, 120) };
  }
}

function request(
  port: number,
  url: string,
  method: string,
  headers: Record<string, string> = {},
): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: url, method, headers }, (res) => {
      let buf = "";
      res.on("data", (c) => (buf += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: parseBody(buf) }));
    });
    req.on("error", reject);
    req.end();
  });
}

/** Tables carrying any owner column, excluding `users` itself. */
function ownerTables(db: ReturnType<typeof getDb>): string[] {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as Array<{ name: string }>;
  const out: string[] = [];
  for (const { name } of tables) {
    if (name === "users") continue;
    const cols = (db.prepare(`PRAGMA table_info(${name})`).all() as Array<{ name: string }>).map(
      (c) => c.name,
    );
    if (OWNER_COLUMNS.some((c) => cols.includes(c))) out.push(name);
  }
  return out.sort();
}

/** Rows owned by (userId | telegramId) in EVERY table that can name them. */
function ownedCounts(
  db: ReturnType<typeof getDb>,
  userId: number,
  telegramId: string,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const name of ownerTables(db)) {
    const cols = (db.prepare(`PRAGMA table_info(${name})`).all() as Array<{ name: string }>).map(
      (c) => c.name,
    );
    let n = 0;
    for (const col of OWNER_COLUMNS) {
      if (!cols.includes(col)) continue;
      const value = col === "telegram_id" ? telegramId : userId;
      n += (db.prepare(`SELECT COUNT(*) AS n FROM ${name} WHERE ${col} = ?`).get(value) as { n: number }).n;
    }
    counts[name] = n;
  }
  counts.users = (db.prepare("SELECT COUNT(*) AS n FROM users WHERE id = ?").get(userId) as { n: number }).n;
  return counts;
}

async function suite(): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vkick-del-"));
  const previousDb = process.env.SQLITE_PATH;
  closeDb();
  process.env.SQLITE_PATH = path.join(dir, "delete.db");
  try {
    const { meRouter } = await import("../server/routes/me.js");
    const db = getDb();
    const now = new Date().toISOString();

    // Minimal world: two teams, a player, a match and one timeline event.
    run(db, "INSERT INTO teams (id, name, league) VALUES ('359', 'Test FC', 'eng.1')");
    run(db, "INSERT INTO teams (id, name, league) VALUES ('364', 'Other FC', 'eng.1')");
    run(db, "INSERT INTO players (id, team_id, full_name) VALUES ('1001', '359', 'Test Player')");
    run(
      db,
      "INSERT INTO matches (id, league, home_team_id, away_team_id, kickoff_at, status) VALUES ('m1', 'eng.1', '359', '364', ?, 'finished')",
      [now],
    );
    run(
      db,
      "INSERT INTO timeline_events (match_id, minute_display, minute_seconds, type, description) VALUES ('m1', ?, 720, 'goal', 'Test goal')",
      ["12'"],
    );
    const eventId = (
      db.prepare("SELECT id FROM timeline_events WHERE match_id = 'm1'").get() as {
        id: number;
      }
    ).id;

    const mkUser = (telegramId: string, name: string): number => {
      run(db, "INSERT INTO users (telegram_id, display_name, created_at) VALUES (?, ?, ?)", [
        telegramId,
        name,
        now,
      ]);
      return (
        db.prepare("SELECT id FROM users WHERE telegram_id = ?").get(telegramId) as {
          id: number;
        }
      ).id;
    };
    const mkToken = (userId: number, token: string): void =>
      run(db, "INSERT INTO user_sessions (token, user_id, created_at, last_used_at) VALUES (?, ?, ?, ?)", [
        token,
        userId,
        now,
        now,
      ]);

    /** Every owner table, so the pre-delete non-empty assertion is meaningful. */
    const seedOwnedRows = (userId: number, telegramId: string): void => {
      run(
        db,
        "INSERT INTO favorite_teams (user_id, team_id, created_at, is_favorite) VALUES (?, '359', ?, 1)",
        [userId, now],
      );
      run(db, "INSERT INTO followed_leagues (user_id, league, created_at) VALUES (?, 'eng.1', ?)", [
        userId,
        now,
      ]);
      run(
        db,
        "INSERT INTO predictions (user_id, match_id, mechanic, payload, locked_at, status, points_awarded) VALUES (?, 'm1', 'lineup', '{}', ?, 'settled', 3)",
        [userId, now],
      );
      run(
        db,
        "INSERT INTO crowd_ratings (user_id, player_id, match_id, rating, created_at) VALUES (?, '1001', 'm1', 8, ?)",
        [userId, now],
      );
      run(
        db,
        "INSERT INTO timeline_comments (event_id, match_id, minute_display, minute_seconds, user_id, text, created_at) VALUES (?, 'm1', ?, 720, ?, 'hi', ?)",
        [eventId, "12'", userId, now],
      );
      run(
        db,
        "INSERT INTO point_ledger (user_id, match_id, source, mechanic, points, scope_season, awarded_at, source_id) VALUES (?, 'm1', 'prediction', 'lineup', 3, '2026-27', ?, ?)",
        [userId, now, userId * 10],
      );
      run(
        db,
        "INSERT INTO user_point_totals (user_id, scope, scope_season, total, reached_total_at) VALUES (?, 'global', '2026-27', 3, ?)",
        [userId, now],
      );
      run(
        db,
        "INSERT INTO user_streaks (user_id, current, season_hits, thresholds_paid, streak_active, scope_season, updated_at) VALUES (?, 1, 1, '[]', 1, '2026-27', ?)",
        [userId, now],
      );
      run(
        db,
        "INSERT INTO streak_evaluations (user_id, match_id, hit, bonus, evaluated_at) VALUES (?, 'm1', 1, 0, ?)",
        [userId, now],
      );
      run(
        db,
        "INSERT INTO user_credentials (user_id, username, password_hash, created_at) VALUES (?, ?, 'x', ?)",
        [userId, `u${userId}`, now],
      );
      run(
        db,
        "INSERT INTO user_notification_prefs (user_id, goals, deadline, ratings, updated_at) VALUES (?, 1, 1, 1, ?)",
        [userId, now],
      );
      run(db, "INSERT INTO referral_codes (code, user_id, created_at) VALUES (?, ?, ?)", [
        `CODE${userId}`,
        userId,
        now,
      ]);
      run(
        db,
        "INSERT INTO bot_push_queue (telegram_id, kind, text, created_at, attempts, next_attempt_at) VALUES (?, 'goal', 'hi', ?, 0, 0)",
        [telegramId, now],
      );
      run(
        db,
        "INSERT INTO match_notifications (telegram_id, match_id, stage, notified_at) VALUES (?, 'm1', 'kickoff', ?)",
        [telegramId, now],
      );
    };

    const victimId = mkUser("700001", "Victim");
    const victimToken = "mg_delete_victim";
    mkToken(victimId, victimToken);
    seedOwnedRows(victimId, "700001");

    // Referral graph both ways: the victim redeemed C's code, and D redeemed
    // the victim's code.
    const referrerId = mkUser("700002", "Referrer");
    const inviteeId = mkUser("700003", "Invitee");
    run(db, "INSERT INTO referral_codes (code, user_id, created_at) VALUES ('REFC', ?, ?)", [
      referrerId,
      now,
    ]);
    run(db, "INSERT INTO referral_codes (code, user_id, created_at) VALUES ('REFD', ?, ?)", [inviteeId, now]);
    run(
      db,
      "INSERT INTO referral_redemptions (code, referrer_user_id, invitee_user_id, rewarded, created_at) VALUES ('REFC', ?, ?, 1, ?)",
      [referrerId, victimId, now],
    );
    run(
      db,
      "INSERT INTO referral_redemptions (code, referrer_user_id, invitee_user_id, rewarded, created_at) VALUES ('REFD', ?, ?, 1, ?)",
      [victimId, inviteeId, now],
    );

    // The bystander: no referral link to the victim, so it must be untouched.
    const bystanderId = mkUser("700004", "Bystander");
    mkToken(bystanderId, "mg_delete_bystander");
    seedOwnedRows(bystanderId, "700004");

    const before = ownedCounts(db, victimId, "700001");
    const bystanderBefore = ownedCounts(db, bystanderId, "700004");

    // Every owner table must have been seeded for the victim, or the zero-check
    // below would be vacuous for that table.
    for (const table of ownerTables(db)) {
      assert.ok(before[table]! > 0, `seed is incomplete: no victim rows in ${table}`);
    }

    const app = express();
    app.use(express.json());
    app.use(meRouter);
    const { port, close } = await listen(app);

    try {
      // Auth is required.
      const anon = await request(port, "/api/me", "DELETE");
      assert.equal(anon.status, 401, "deletion without a token is 401");

      const del = await request(port, "/api/me", "DELETE", { authorization: `Bearer ${victimToken}` });
      assert.equal(del.status, 200, `delete must succeed (got ${JSON.stringify(del.body)})`);
      assert.equal(del.body?.ok, true);

      const after = ownedCounts(db, victimId, "700001");
      for (const [table, n] of Object.entries(after)) {
        assert.equal(n, 0, `victim still has ${n} row(s) in ${table}`);
      }
      assert.equal(after.users, 0, "the users row is gone");

      // Both referral directions are gone; C's and D's own codes survive.
      const dangling = db
        .prepare(
          "SELECT COUNT(*) AS n FROM referral_redemptions WHERE referrer_user_id = ? OR invitee_user_id = ?",
        )
        .get(victimId, victimId) as { n: number };
      assert.equal(dangling.n, 0, "no redemption row names the deleted user");

      // The bystander's data is byte-for-byte the same shape.
      const bystanderAfter = ownedCounts(db, bystanderId, "700004");
      assert.deepEqual(bystanderAfter, bystanderBefore, "a second user's rows are untouched");

      // A later registrant can reuse nothing of the victim's identity.
      const reused = db.prepare("SELECT COUNT(*) AS n FROM users WHERE telegram_id = '700001'").get() as {
        n: number;
      };
      assert.equal(reused.n, 0);
    } finally {
      await close();
    }
  } finally {
    if (previousDb === undefined) delete process.env.SQLITE_PATH;
    else process.env.SQLITE_PATH = previousDb;
    closeDb();
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      /* a leftover temp dir must not fail a passing suite */
    }
  }
}

export async function runAccountDeletionTests(): Promise<void> {
  if (process.env[CHILD_FLAG] === "1") {
    await suite();
    return;
  }
  const result = spawnSync(process.execPath, ["--import", "tsx", fileURLToPath(import.meta.url)], {
    stdio: "inherit",
    env: { ...process.env, [CHILD_FLAG]: "1" },
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `accountDeletion child process failed (exit ${result.status})`);
  console.log(SUMMARY);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await runAccountDeletionTests();
}
