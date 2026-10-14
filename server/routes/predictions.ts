/**
 * Predictions: per-match read + submit with per-mechanic lock windows and
 * payload validation. Point math lives in server/scoring/, resolution in
 * server/predictions/resolver.ts — this module is the gate.
 */
import express from "express";
import { getDb, all, get, run } from "../db/index.js";
import { writeLimiter } from "../auth/rateLimit.js";
import { validatePayload, type Mechanic } from "../predictions/validate.js";
import { LINEUP_GATED, isLineupGated, lineupPublished, windowFor } from "../predictions/window.js";
import { bad, currentUser, requireUser } from "./shared.js";

const db = getDb();

const MECHANICS: Mechanic[] = ["lineup", "shot_predict", "sub", "player_watch", "versus"];

/**
 * Whether the match's official lineup has been published. The rule itself
 * (`home_formation`, with the starters fallback) lives in predictions/window.ts
 * so the history route reads the same signal.
 */
export function isLineupPublished(matchId: string): boolean {
  const row = get<{ home_formation: string | null }>(db, "SELECT home_formation FROM matches WHERE id = ?", [
    matchId,
  ]);
  const starters = get<{ teams: number }>(
    db,
    "SELECT COUNT(DISTINCT team_id) AS teams FROM match_player_stats WHERE match_id = ? AND started = 1",
    [matchId],
  );
  return lineupPublished(row?.home_formation, starters?.teams ?? 0);
}

export const predictionsRouter = express.Router();

predictionsRouter.get("/api/matches/:id/predictions", requireUser, (req, res) => {
  const matchId = String(req.params.id);
  const rows = all(db, "SELECT * FROM predictions WHERE user_id = ? AND match_id = ?", [
    currentUser(req).id,
    matchId,
  ]);
  // Window info per mechanic so the UI can render opens/locks honestly.
  const kickoffRow = get<{ kickoff_at: string; status: string }>(
    db,
    "SELECT kickoff_at, status FROM matches WHERE id = ?",
    [matchId],
  );
  const published = isLineupPublished(matchId);
  const windows = kickoffRow
    ? Object.fromEntries(MECHANICS.map((m) => [m, windowFor(m, kickoffRow.kickoff_at, published)]))
    : {};
  res.json({
    predictions: rows,
    windows,
    matchStatus: kickoffRow?.status ?? null,
    lineupPublished: published,
  });
});

predictionsRouter.post("/api/matches/:id/predictions", requireUser, writeLimiter, (req, res) => {
  const matchId = String(req.params.id);
  const { mechanic, payload } = req.body ?? {};
  if (!MECHANICS.includes(mechanic)) return bad(res, "unknown mechanic");

  // Schema-check the payload BEFORE anything touches the DB. Stored rows are
  // now guaranteed resolver-shaped (and users can't stash arbitrary blobs).
  const clean = validatePayload(mechanic as Mechanic, payload);
  if (!clean) return bad(res, "INVALID_PAYLOAD");

  const match = get<{ status: string; kickoff_at: string }>(
    db,
    "SELECT status, kickoff_at FROM matches WHERE id = ?",
    [matchId],
  );
  if (!match) return bad(res, "unknown match", 404);

  // The lineup-gated mechanics require the OFFICIAL lineup to be published —
  // the same signal the first-half Sub window opens on. No wall-clock proxy:
  // without ESPN's XI there is nothing to shoot/watch/duel against.
  if (isLineupGated(mechanic) && !isLineupPublished(matchId)) {
    return bad(res, "LINEUP_NOT_PUBLISHED");
  }

  const now = new Date();
  const published = isLineupPublished(matchId);
  const window = windowFor(mechanic, match.kickoff_at, published);

  // Lock enforcement per mechanic window (prediction-mechanics.md):
  // - lineup locks 2h before kickoff, the rest at kickoff; the sub window is
  //   status-driven (live match, first half) and half-time flips via the sync.
  if (mechanic !== "sub") {
    if (match.status !== "scheduled") return bad(res, "LOCKED_MATCH_STARTED");
    if (new Date(window.lockAt).getTime() < now.getTime()) return bad(res, "LOCKED_DEADLINE_PASSED");
  } else {
    // Sub Predictor window: opens with the lineup, open through scheduled
    // (board prep) + first-half live — LOCKED at halftime (real status from
    // the sync) and finished. The halftime status is what makes "editable
    // until half-time" a server rule instead of UI copy.
    if (match.status === "halftime" || match.status === "finished") {
      return bad(res, "SUB_LOCKED_HALFTIME");
    }
    if (match.status !== "live" && match.status !== "scheduled") return bad(res, "SUB_ONLY_DURING_LIVE");
    // windowFor nulls opensAt once the lineup is published, so the server
    // agrees with the client: no SUB_NOT_OPEN after publication.
    if (
      match.status === "scheduled" &&
      window.opensAt &&
      new Date(window.opensAt).getTime() > now.getTime()
    ) {
      return bad(res, "SUB_NOT_OPEN");
    }
  }

  const userId = currentUser(req).id;
  const lockedAt = now.toISOString();

  // One row per mechanic per match per user (UNIQUE constraint), upserted.
  // Sub Predictor edits stay live until half-time; everything else froze at
  // its lock above, so a plain upsert is correct for every mechanic.
  run(
    db,
    `INSERT INTO predictions (user_id, match_id, mechanic, payload, locked_at, status, points_awarded)
     VALUES (?, ?, ?, ?, ?, 'pending', 0)
     ON CONFLICT(user_id, match_id, mechanic) DO UPDATE SET
       payload = excluded.payload, locked_at = excluded.locked_at, status = 'pending'`,
    [userId, matchId, mechanic, JSON.stringify(clean), lockedAt],
  );
  res.json({ ok: true, lockAt: window.lockAt, opensAt: window.opensAt });
});

export { MECHANICS, LINEUP_GATED };
