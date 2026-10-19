/**
 * GET /api/matches/:id/team-stats, driven over real HTTP against the real
 * router with a real (temp) SQLite database.
 *
 * The three contracts the Stats comparison view rides on:
 *  1. a match with synced box-score rows answers both teams' stat objects
 *     (percentages rounded to whole numbers, goals taken off the matches row);
 *  2. a match whose stats have not synced yet answers { home: null, away: null
 *     } with 200 — the match exists, the numbers just aren't in, and 404 would
 *     read as "this match is gone";
 *  3. a match whose league is outside the big-five allowlist answers 404,
 *     exactly like every other match-detail endpoint.
 *
 * WHY A CHILD PROCESS: `matchesRouter` reads `getDb()` at module scope, and
 * that handle closes (and its temp file is deleted) when the suite finishes —
 * ESM caches the module per process, so the shared runner would keep a closed
 * handle and every later router suite would serve stale errors. A child
 * process (same pattern as guestMerge/errors) owns its own module graph.
 * The temp SQLITE_PATH is set inside the child before the dynamic import.
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

const CHILD_FLAG = "VKICK_TEAMSTATS_CHILD";

const SUMMARY =
  "  teamStats: synced box score as home/away objects, unsynced match answers nulls, non-allowlist league 404 OK";

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

function get(port: number, url: string): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: url, method: "GET" }, (res) => {
      let buf = "";
      res.on("data", (c) => (buf += c));
      res.on("end", () => {
        let body: Record<string, unknown> | null = null;
        try {
          body = JSON.parse(buf) as Record<string, unknown>;
        } catch {
          body = { raw: buf.slice(0, 120) };
        }
        resolve({ status: res.statusCode ?? 0, body });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

async function suite(): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vkick-teamstats-"));
  const previousDb = process.env.SQLITE_PATH;
  closeDb();
  process.env.SQLITE_PATH = path.join(dir, "teamstats.db");
  try {
    const { matchesRouter } = await import(
      pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), "../server/routes/football.js")).href
    );

    const db = getDb();
    // Teams + matches: one finished big-five match, one scheduled (by alignment)
    // big-five match, and one Turkish-league match outside the allowlist.
    run(
      db,
      `INSERT INTO teams (id, name, short_name, league) VALUES
         ('th1', 'Test Home', 'TH', 'eng.1'),
         ('ta1', 'Test Away', 'TA', 'eng.1'),
         ('th2', 'Test Home 2', 'T2', 'eng.1'),
         ('ta2', 'Test Away 2', 'A2', 'eng.1'),
         ('th3', 'Turk Home', 'TR', 'tur.1'),
         ('ta3', 'Turk Away', 'TU', 'tur.1');`,
    );
    run(
      db,
      `INSERT INTO matches (id, league, home_team_id, away_team_id, kickoff_at, status, home_score, away_score)
       VALUES
         ('m_stats', 'eng.1', 'th1', 'ta1', '2026-10-18T15:00:00.000Z', 'finished', 2, 1),
         ('m_nostats', 'eng.1', 'th2', 'ta2', '2026-10-20T15:00:00.000Z', 'scheduled', NULL, NULL),
         ('m_turk', 'tur.1', 'th3', 'ta3', '2026-10-18T17:00:00.000Z', 'finished', 1, 1);`,
    );
    // Box score for the finished match only. The percentages arrive as REALs,
    // exactly as the ESPN sync writes them.
    run(
      db,
      `INSERT INTO match_team_stats
         (match_id, team_id, possession_pct, shots, shots_on_target, corners, fouls, offsides, saves, passes_total, passes_accurate, pass_accuracy_pct)
       VALUES
         ('m_stats', 'th1', 62.4, 14, 6, 5, 9, 2, 3, 540, 470, 87.0),
         ('m_stats', 'ta1', 37.6, 8, 3, 2, 12, 1, 4, 330, 271, 82.1);`,
    );

    const app = express();
    app.use(matchesRouter);
    const { port, close } = await listen(app);

    try {
      // 1. Synced: both sides, whole-number percentages, goals from the match.
      const synced = await get(port, "/api/matches/m_stats/team-stats");
      assert.equal(synced.status, 200);
      const home = synced.body?.home as Record<string, unknown> | null;
      const away = synced.body?.away as Record<string, unknown> | null;
      assert.ok(home && away, "both sides present when the box score synced");
      assert.deepEqual(
        home,
        {
          possession_pct: 62,
          corners: 5,
          pass_accuracy_pct: 87,
          shots: 14,
          shots_on_target: 6,
          fouls: 9,
          offsides: 2,
          saves: 3,
          goals: 2,
        },
        "home side carries the whole contract shape",
      );
      assert.equal(away.possession_pct, 38, "away percentage rounded");
      assert.equal(away.goals, 1, "away goals come off the matches row");
      assert.equal(synced.body?.home, home, "the JSON shape is { home, away } at the top level");

      // 2. Unsynced: the match exists, the stats don't — nulls with 200, never 404.
      const unsynced = await get(port, "/api/matches/m_nostats/team-stats");
      assert.equal(unsynced.status, 200, "missing stats are not an error");
      assert.deepEqual(unsynced.body, { home: null, away: null }, "both sides null before the box score syncs");

      // 3. Allowlist: a league outside the big five answers 404 like the rest.
      const turk = await get(port, "/api/matches/m_turk/team-stats");
      assert.equal(turk.status, 404, "non-allowlist league answers 404");
      assert.ok(turk.body, "the 404 is a JSON body, not HTML");

      // 4. Unknown match id: 404 as well.
      const missing = await get(port, "/api/matches/nope/team-stats");
      assert.equal(missing.status, 404, "unknown match answers 404");
    } finally {
      await close();
    }
  } finally {
    closeDb();
    if (previousDb === undefined) delete process.env.SQLITE_PATH;
    else process.env.SQLITE_PATH = previousDb;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Runs the suite in a child process so its closeDb() and module imports
    cannot poison the shared runner's cached router modules. */
export async function runTeamStatsTests(): Promise<void> {
  if (process.env[CHILD_FLAG] === "1") {
    await suite();
    return;
  }
  const result = spawnSync(process.execPath, ["--import", "tsx", fileURLToPath(import.meta.url)], {
    stdio: "inherit",
    env: { ...process.env, [CHILD_FLAG]: "1" },
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `teamStats child process failed (exit ${result.status})`);
  console.log(SUMMARY);
}

// Child or standalone execution: tsx tests/teamStats.test.ts — importing this
// module from tests/run.ts must never fire the suite directly.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await runTeamStatsTests();
}
