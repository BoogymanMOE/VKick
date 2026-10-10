/**
 * Moderation, driven over real HTTP against a throwaway database.
 *
 * Covers the whole loop: a user reports a comment (once — a second report is a
 * no-op), the admin queue lists it, an admin removes it or hides the author's
 * comments, and hidden comments vanish from the PUBLIC reads while the rating
 * value itself survives. A non-admin gets 403 on every admin endpoint.
 *
 * WHY A CHILD PROCESS: route modules call `getDb()` at module scope and ESM
 * caches modules per process, so router-driving suites cannot share one (see
 * tests/guestMerge.test.ts).
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

const CHILD_FLAG = "VKICK_MODERATION_CHILD";
const SUMMARY =
  "  moderation: one report per user, admin queue/list/delete/hide, hidden comments gone from public reads, non-admin 403 OK";

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

function call(
  port: number,
  method: string,
  url: string,
  headers: Record<string, string> = {},
  body?: unknown,
): Promise<Res> {
  const raw = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: url,
        method,
        headers: {
          ...(raw ? { "content-type": "application/json", "content-length": Buffer.byteLength(raw) } : {}),
          ...headers,
        },
      },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: parseBody(buf) }));
      },
    );
    req.on("error", reject);
    req.end(raw);
  });
}

async function suite(): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vkick-mod-"));
  const previousDb = process.env.SQLITE_PATH;
  const previousAdmins = process.env.ADMIN_TELEGRAM_IDS;
  closeDb();
  process.env.SQLITE_PATH = path.join(dir, "mod.db");
  process.env.ADMIN_TELEGRAM_IDS = "777";
  try {
    const { moderationRouter } = await import("../server/routes/moderation.js");
    const { ratingsRouter } = await import("../server/routes/ratings.js");
    const db = getDb();
    const now = new Date().toISOString();

    run(db, "INSERT OR REPLACE INTO teams (id, name, league) VALUES ('359', 'Test FC', 'eng.1')");
    run(db, "INSERT OR REPLACE INTO teams (id, name, league) VALUES ('364', 'Other FC', 'eng.1')");
    run(
      db,
      "INSERT INTO players (id, team_id, full_name, position) VALUES ('1001', '359', 'Test Player', 'FWD')",
    );
    run(
      db,
      "INSERT INTO matches (id, league, home_team_id, away_team_id, kickoff_at, status) VALUES ('m1', 'eng.1', '359', '364', ?, 'finished')",
      [now],
    );
    run(
      db,
      "INSERT INTO timeline_events (match_id, minute_display, minute_seconds, type, description) VALUES ('m1', '12''', 720, 'goal', 'Test goal')",
    );
    const eventId = (
      db.prepare("SELECT id FROM timeline_events WHERE match_id = 'm1'").get() as { id: number }
    ).id;
    run(
      db,
      "INSERT INTO match_player_stats (match_id, player_id, team_id, started, minutes_played) VALUES ('m1', '1001', '359', 1, 90)",
    );

    const mkUser = (telegramId: string, name: string): number => {
      run(db, "INSERT INTO users (telegram_id, display_name, created_at) VALUES (?, ?, ?)", [
        telegramId,
        name,
        now,
      ]);
      return (db.prepare("SELECT id FROM users WHERE telegram_id = ?").get(telegramId) as { id: number }).id;
    };
    const mkSession = (userId: number, token: string): void =>
      run(db, "INSERT INTO user_sessions (token, user_id, created_at, last_used_at) VALUES (?, ?, ?, ?)", [
        token,
        userId,
        now,
        now,
      ]);

    const authorId = mkUser("700010", "Author");
    const reporterId = mkUser("700011", "Reporter");
    const adminId = mkUser("777", "Admin");
    mkSession(authorId, "mg_mod_author");
    mkSession(reporterId, "mg_mod_reporter");
    mkSession(adminId, "mg_mod_admin");
    const reporter = { authorization: "Bearer mg_mod_reporter" };
    const admin = { authorization: "Bearer mg_mod_admin" };

    // Two timeline comments by the author, and one rating comment.
    const addComment = (text: string): number => {
      const info = db
        .prepare(
          "INSERT INTO timeline_comments (event_id, match_id, minute_display, minute_seconds, user_id, text, created_at) VALUES (?, 'm1', '12''', 720, ?, ?, ?)",
        )
        .run(eventId, authorId, text, now);
      return Number(info.lastInsertRowid);
    };
    const c1 = addComment("first comment");
    addComment("second comment");
    const ratingInfo = db
      .prepare(
        "INSERT INTO crowd_ratings (user_id, player_id, match_id, rating, comment, created_at) VALUES (?, '1001', 'm1', 9, 'rating comment', ?)",
      )
      .run(authorId, now);
    const ratingId = Number(ratingInfo.lastInsertRowid);

    const app = express();
    app.use(express.json());
    app.use(moderationRouter);
    app.use(ratingsRouter);
    const { port, close } = await listen(app);
    const publicComments = async (): Promise<Array<{ id: number; text: string }>> => {
      const res = await call(port, "GET", "/api/matches/m1/comments", reporter);
      return (res.body?.comments as Array<{ id: number; text: string }>) ?? [];
    };
    const ratingsBody = async (): Promise<Record<string, unknown>> =>
      (await call(port, "GET", "/api/matches/m1/ratings", reporter)).body ?? {};

    try {
      /* ---------------------------------------------------- reporting */
      const first = await call(port, "POST", "/api/reports", reporter, {
        commentType: "timeline",
        commentId: c1,
        reason: "spam",
      });
      assert.equal(first.status, 200, `report accepted (got ${JSON.stringify(first.body)})`);
      assert.equal(first.body?.duplicate, false);

      const second = await call(port, "POST", "/api/reports", reporter, {
        commentType: "timeline",
        commentId: c1,
      });
      assert.equal(second.status, 200);
      assert.equal(second.body?.duplicate, true, "a repeat report is a no-op");
      const reportRows = db
        .prepare("SELECT COUNT(*) AS n FROM comment_reports WHERE comment_id = ?")
        .get(c1) as {
        n: number;
      };
      assert.equal(reportRows.n, 1, "one report per user per comment");

      const unknown = await call(port, "POST", "/api/reports", reporter, {
        commentType: "timeline",
        commentId: 999999,
      });
      assert.equal(unknown.status, 404, "reporting a nonexistent comment is refused");

      /* ---------------------------------------------------- admin gate */
      assert.equal((await call(port, "GET", "/api/admin/reports", reporter)).status, 403);
      assert.equal(
        (await call(port, "POST", `/api/admin/users/${authorId}/hide-comments`, reporter)).status,
        403,
      );
      assert.equal((await call(port, "DELETE", `/api/admin/comments/timeline/${c1}`, reporter)).status, 403);

      /* ---------------------------------------------------- the queue */
      const queue = await call(port, "GET", "/api/admin/reports", admin);
      assert.equal(queue.status, 200);
      const reports = queue.body?.reports as Array<Record<string, unknown>>;
      assert.ok(Array.isArray(reports) && reports.length >= 1, "the admin sees the report");
      const row = reports.find((r) => r.comment_id === c1);
      assert.ok(row, "the reported comment is listed");
      assert.equal(row.content, "first comment", "the queue carries the content");
      assert.equal(row.reporter, "Reporter", "and the reporter");

      /* ---------------------------------------------------- delete */
      assert.ok(
        (await publicComments()).some((c) => c.id === c1),
        "the comment is public before moderation",
      );
      const del = await call(port, "DELETE", `/api/admin/comments/timeline/${c1}`, admin);
      assert.equal(del.status, 200);
      assert.equal(del.body?.deleted, 1);
      assert.ok(
        !(await publicComments()).some((c) => c.id === c1),
        "a deleted comment is gone from the public feed",
      );
      const cleared = db
        .prepare("SELECT COUNT(*) AS n FROM comment_reports WHERE comment_id = ?")
        .get(c1) as {
        n: number;
      };
      assert.equal(cleared.n, 0, "the queue entry is cleared with the comment");

      /* ---------------------------------------------------- hide a user */
      const ratingBefore = (await ratingsBody()) as { players: Array<Record<string, unknown>> };
      const playerBefore = ratingBefore.players.find((p) => p.player_id === "1001");
      assert.equal(playerBefore?.latest_comment, "rating comment", "the rating comment is public first");

      const hide = await call(port, "POST", `/api/admin/users/${authorId}/hide-comments`, admin, {});
      assert.equal(hide.status, 200);
      assert.ok(Number(hide.body?.comments) >= 1, "timeline comments hidden");

      const afterComments = await publicComments();
      assert.equal(afterComments.length, 0, "every comment by the hidden user disappeared");

      const ratingAfter = (await ratingsBody()) as { players: Array<Record<string, unknown>> };
      const playerAfter = ratingAfter.players.find((p) => p.player_id === "1001");
      assert.equal(playerAfter?.latest_comment, null, "the hidden rating comment is not returned");
      assert.equal(playerAfter?.latest_comment_id, null, "nor is its id");
      const hiddenRow = db
        .prepare("SELECT rating, comment, comment_hidden FROM crowd_ratings WHERE id = ?")
        .get(ratingId) as { rating: number; comment: string | null; comment_hidden: number };
      assert.equal(hiddenRow.rating, 9, "the rating VALUE still stands");
      assert.equal(hiddenRow.comment, "rating comment", "hiding keeps the text (reversible)");
      assert.equal(hiddenRow.comment_hidden, 1);

      // Reversible: unhiding brings the author's comments back.
      const unhide = await call(port, "POST", `/api/admin/users/${authorId}/hide-comments`, admin, {
        hidden: false,
      });
      assert.equal(unhide.status, 200);
      assert.equal((await publicComments()).length, 1, "unhiding restores the remaining comment");

      /* ---------------------------------------------------- delete a rating comment */
      const delRating = await call(port, "DELETE", `/api/admin/comments/rating/${ratingId}`, admin);
      assert.equal(delRating.status, 200);
      const ratingGone = (await ratingsBody()) as { players: Array<Record<string, unknown>> };
      const playerGone = ratingGone.players.find((p) => p.player_id === "1001");
      assert.equal(playerGone?.latest_comment, null, "a deleted rating comment is gone");
      const goneRow = db.prepare("SELECT rating, comment FROM crowd_ratings WHERE id = ?").get(ratingId) as {
        rating: number;
        comment: string | null;
      };
      assert.equal(goneRow.rating, 9, "but the rating itself remains");
      assert.equal(goneRow.comment, null, "the text is gone");
    } finally {
      await close();
    }
  } finally {
    if (previousDb === undefined) delete process.env.SQLITE_PATH;
    else process.env.SQLITE_PATH = previousDb;
    if (previousAdmins === undefined) delete process.env.ADMIN_TELEGRAM_IDS;
    else process.env.ADMIN_TELEGRAM_IDS = previousAdmins;
    closeDb();
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      /* a leftover temp dir must not fail a passing suite */
    }
  }
}

export async function runModerationTests(): Promise<void> {
  if (process.env[CHILD_FLAG] === "1") {
    await suite();
    return;
  }
  const result = spawnSync(process.execPath, ["--import", "tsx", fileURLToPath(import.meta.url)], {
    stdio: "inherit",
    env: { ...process.env, [CHILD_FLAG]: "1" },
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `moderation child process failed (exit ${result.status})`);
  console.log(SUMMARY);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await runModerationTests();
}
