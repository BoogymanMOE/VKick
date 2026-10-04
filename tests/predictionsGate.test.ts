/**
 * The official-lineup gate on the prediction write path.
 *
 * Shot / Watch / Versus / the Sub board only open once ESPN's official lineup
 * is out — the same `matches.home_formation` signal the lineup-drop push uses,
 * not a wall-clock guess. This drives the REAL predictions router over HTTP so
 * the gate is proven at the handler, not in a reimplementation: before the
 * formation lands a gated write is refused with LINEUP_NOT_PUBLISHED, and the
 * Lineup Predictor — which exists precisely to be picked BEFORE release — still
 * goes through.
 *
 * WHY A CHILD PROCESS: the route modules call `getDb()` at module scope and
 * capture the handle in a module-level const, and ESM caches modules for the
 * life of the process. Two router-driving suites cannot coexist — the second
 * one to import gets the first one's already-closed handle (the same reason
 * `guestMerge.test.ts` runs in a child). So this suite re-invokes itself in a
 * child process and reports the child's verdict.
 */
import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { AddressInfo } from "node:net";
import express from "express";
import { closeDb, getDb, run, get } from "../server/db/index.js";

const CHILD_FLAG = "VKICK_PREDICTIONS_GATE_CHILD";
const SUMMARY =
  "  predictionsGate: shot/watch/versus/sub need the official lineup, lineup exempt OK";

interface Res {
  status: number;
  body: Record<string, unknown>;
}

/** Express's default error handler answers with HTML; keep that diagnosable. */
function parseBody(buf: string): Record<string, unknown> {
  if (!buf) return {};
  try {
    return JSON.parse(buf) as Record<string, unknown>;
  } catch {
    return { raw: buf.slice(0, 120) };
  }
}

async function request(
  port: number,
  method: "GET" | "POST",
  url: string,
  body: unknown,
  headers: Record<string, string>,
): Promise<Res> {
  const res = await fetch(`http://127.0.0.1:${port}${url}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: parseBody(await res.text()) };
}

/** The actual assertions, run inside the child process. */
async function suite(): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vkick-gate-"));
  const previousDb = process.env.SQLITE_PATH;
  // getDb() caches one handle for the process — close it before repointing.
  closeDb();
  process.env.SQLITE_PATH = path.join(dir, "gate.db");
  try {
    // Imported AFTER SQLITE_PATH is set: the router calls getDb() at module
    // scope, so a stale path here would point the suite at the dev database.
    const { predictionsRouter } = await import("../server/routes/predictions.js");
    const { meRouter } = await import("../server/routes/me.js");

    const app = express();
    app.use(express.json());
    app.use(predictionsRouter);
    app.use(meRouter);
    const server = app.listen(0);
    await new Promise<void>((r) => server.once("listening", () => r()));
    const port = (server.address() as AddressInfo).port;

    try {
      const db = getDb();
      const now = new Date().toISOString();
      run(db, "INSERT INTO users (telegram_id, display_name, created_at) VALUES ('555001', 'Gate Test', ?)", [
        now,
      ]);
      const user = get<{ id: number }>(db, "SELECT id FROM users WHERE telegram_id = '555001'");
      assert.ok(user, "test user created");
      const token = "mg_lineup_gate_test";
      run(db, "INSERT INTO user_sessions (token, user_id, created_at, last_used_at) VALUES (?, ?, ?, ?)", [
        token,
        user!.id,
        now,
        now,
      ]);
      const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

      run(db, "INSERT INTO teams (id, name, league) VALUES ('T1', 'Home FC', 'eng.1')");
      run(db, "INSERT INTO teams (id, name, league) VALUES ('T2', 'Away FC', 'eng.1')");
      // Kickoff 3h out: the Lineup Predictor's 2h-before lock is still ahead.
      const kickoff = new Date(Date.now() + 3 * 3_600_000).toISOString();
      run(
        db,
        `INSERT INTO matches (id, league, home_team_id, away_team_id, kickoff_at, status)
         VALUES ('GATE1', 'eng.1', 'T1', 'T2', ?, 'scheduled')`,
        [kickoff],
      );

      const read = () => request(port, "GET", "/api/matches/GATE1/predictions", undefined, headers);
      const post = (mechanic: string, payload: unknown) =>
        request(port, "POST", "/api/matches/GATE1/predictions", { mechanic, payload }, headers);
      const shotPayload = { playerId: "1001", grid: { gridX: 0, gridY: 0 } };

      // Before the official lineup: nothing gated can be written.
      const before = await read();
      assert.equal(before.status, 200, `read failed: ${JSON.stringify(before.body)}`);
      assert.equal(before.body.lineupPublished, false, "no formation yet = not published");
      const beforeWindows = before.body.windows as Record<
        string,
        { opensAt: string | null; requires: string | null }
      >;
      assert.equal(typeof beforeWindows.shot_predict?.opensAt, "string", "pre-lineup window is clock-gated");
      assert.equal(beforeWindows.shot_predict?.requires, "lineup", "gated window is self-describing");
      assert.equal(beforeWindows.lineup?.requires, null, "lineup predictor window is clock-only");

      for (const [mechanic, payload] of [
        ["shot_predict", shotPayload],
        ["player_watch", { playerId: "1001" }],
        ["versus", { playerAId: "1001", playerBId: "1002" }],
        ["sub", { subs: [{ offId: "1001", onId: "1002" }] }],
      ] as const) {
        const res = await post(mechanic, payload);
        assert.equal(res.status, 400, `${mechanic}: refused before lineup`);
        assert.equal(res.body.error, "LINEUP_NOT_PUBLISHED", `${mechanic}: error code`);
      }

      // The Lineup Predictor is deliberately NOT gated — it is the pre-release pick.
      const lineup = await post("lineup", {
        playerIds: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"],
        formation: "4-3-3",
      });
      assert.equal(lineup.status, 200, `lineup must survive the gate: ${JSON.stringify(lineup.body)}`);

      // Official lineup published (the sync sets home_formation with the XI).
      run(db, "UPDATE matches SET home_formation = '4-3-3' WHERE id = 'GATE1'");
      const after = await read();
      assert.equal(after.body.lineupPublished, true, "formation present = published");
      const afterWindows = after.body.windows as Record<string, { opensAt: string | null }>;
      assert.equal(
        afterWindows.shot_predict?.opensAt,
        null,
        "published lineup opens shot now, not at the kickoff-1h estimate",
      );

      // Now the gated mechanics are accepted.
      const shot = await post("shot_predict", shotPayload);
      assert.equal(shot.status, 200, `shot open after lineup: ${JSON.stringify(shot.body)}`);
      const watch = await post("player_watch", { playerId: "1002" });
      assert.equal(watch.status, 200, `watch open after lineup: ${JSON.stringify(watch.body)}`);
      const versus = await post("versus", { playerAId: "1001", playerBId: "1002" });
      assert.equal(versus.status, 200, `versus open after lineup: ${JSON.stringify(versus.body)}`);

      // The history endpoint must surface the SAME window state the gate just
      // enforced — built from one definition, so it can't drift.
      const history = await request(port, "GET", "/api/me/predictions", undefined, headers);
      assert.equal(history.status, 200, `history read failed: ${JSON.stringify(history.body)}`);
      const hist = (history.body.predictions as Array<Record<string, unknown>>) ?? [];
      const shotRow = hist.find((r) => r.mechanic === "shot_predict");
      assert.ok(shotRow, "the shot pick appears in history");
      assert.equal(shotRow!.match_status, "scheduled", "history carries the match status");
      assert.equal(shotRow!.lineup_published, true, "history carries the published signal");
      const shotWindow = shotRow!.window as { opensAt: string | null; requires: string | null } | null;
      assert.equal(shotWindow?.requires, "lineup", "history window is self-describing");
      assert.equal(shotWindow?.opensAt, null, "published lineup opens the history window now");

      // Fallback: a competition that never writes a formation string must not
      // strand the gate. Once BOTH sides have a starter in match_player_stats,
      // the XI is de facto public and the gated mechanics open.
      run(db, "INSERT INTO players (id, team_id, full_name) VALUES ('9001', 'T1', 'Home Starter')");
      run(db, "INSERT INTO players (id, team_id, full_name) VALUES ('9002', 'T2', 'Away Starter')");
      run(
        db,
        `INSERT INTO matches (id, league, home_team_id, away_team_id, kickoff_at, status)
         VALUES ('GATE2', 'eng.1', 'T1', 'T2', ?, 'scheduled')`,
        [kickoff],
      );
      run(
        db,
        "INSERT INTO match_player_stats (match_id, player_id, team_id, started) VALUES ('GATE2', '9001', 'T1', 1)",
      );
      run(
        db,
        "INSERT INTO match_player_stats (match_id, player_id, team_id, started) VALUES ('GATE2', '9002', 'T2', 1)",
      );
      const fallback = await request(port, "GET", "/api/matches/GATE2/predictions", undefined, headers);
      assert.equal(
        fallback.body.lineupPublished,
        true,
        "starters on both sides count as published without a formation",
      );
      const fallbackPost = await request(
        port,
        "POST",
        "/api/matches/GATE2/predictions",
        { mechanic: "player_watch", payload: { playerId: "9001" } },
        headers,
      );
      assert.equal(fallbackPost.status, 200, "gated write accepted via the starters fallback");
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  } finally {
    if (previousDb === undefined) delete process.env.SQLITE_PATH;
    else process.env.SQLITE_PATH = previousDb;
    // Windows refuses to delete an open file: close the handle first, then sweep.
    closeDb();
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      /* a leftover temp dir must not fail a passing suite */
    }
  }
}

export async function runPredictionsGateTests(): Promise<void> {
  if (process.env[CHILD_FLAG] === "1") {
    await suite();
    return;
  }

  // Parent: hand the whole suite to a child process and adopt its verdict.
  const result = spawnSync(process.execPath, ["--import", "tsx", fileURLToPath(import.meta.url)], {
    stdio: "inherit",
    env: { ...process.env, [CHILD_FLAG]: "1" },
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `predictionsGate child process failed (exit ${result.status})`);
  console.log(SUMMARY);
}

// Run ONLY when this file is the process entry point — i.e. the child spawned
// above. Importing it from tests/run.ts must not fire the suite a second time.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await runPredictionsGateTests();
}
