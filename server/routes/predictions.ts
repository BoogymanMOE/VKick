/**
 * Predictions: per-match read + submit with per-mechanic lock windows and
 * payload validation. Point math lives in server/scoring/, resolution in
 * server/predictions/resolver.ts — this module is the gate.
 */
import express from "express";
import { getDb, all, get, run } from "../db/index.js";
import { writeLimiter } from "../auth/rateLimit.js";
import { validatePayload, type Mechanic } from "../predictions/validate.js";
import { bad, currentUser, requireUser } from "./shared.js";

const db = getDb();

const MECHANICS: Mechanic[] = ["lineup", "shot_predict", "sub", "player_watch", "versus"];

export const predictionsRouter = express.Router();

/**
 * Per-mechanic lock windows, relative to each match's kickoff
 * (`prediction-mechanics.md`). The old single gameweek deadline is gone.
 *   lineup:       2h before kickoff (deliberately earlier than ESPN's ~1h release)
 *   shot_predict: kickoff
 *   player_watch: kickoff
 *   versus:       kickoff
 *   sub:          handled separately — opens at lineup, locks at half-time
 */
function lockWindowFor(mechanic: string, kickoffAt: string): { lockAt: string; opensAt: string | null } {
  const kickoff = new Date(kickoffAt).getTime();
  if (mechanic === "lineup") {
    return { opensAt: null, lockAt: new Date(kickoff - 2 * 3_600_000).toISOString() };
  }
  if (mechanic === "sub") {
    // Opens when the official lineup drops (~1h before kickoff per ESPN); the
    // half-time lock is enforced by status, not by wall-clock.
    return {
      opensAt: new Date(kickoff - 3_600_000).toISOString(),
      lockAt: new Date(kickoff + 60 * 60_000).toISOString(),
    };
  }
  return { opensAt: new Date(kickoff - 3_600_000).toISOString(), lockAt: new Date(kickoff).toISOString() };
}

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
  const windows = kickoffRow
    ? Object.fromEntries(MECHANICS.map((m) => [m, lockWindowFor(m, kickoffRow.kickoff_at)]))
    : {};
  res.json({ predictions: rows, windows, matchStatus: kickoffRow?.status ?? null });
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

  const now = new Date();
  const window = lockWindowFor(mechanic, match.kickoff_at);

  // Lock enforcement per mechanic window (prediction-mechanics.md):
  // - lineup locks 2h before kickoff, the rest at kickoff; the sub window is
  //   status-driven (live match, first half) and half-time flips via the sync.
  if (mechanic !== "sub") {
    if (match.status !== "scheduled") return bad(res, "LOCKED_MATCH_STARTED");
    if (new Date(window.lockAt).getTime() < now.getTime()) return bad(res, "LOCKED_DEADLINE_PASSED");
  } else {
    // Sub Predictor window: opens with the lineup (~1h pre-kickoff), open
    // through scheduled (board prep) + first-half live — LOCKED at halftime
    // (real status from the sync) and finished. The halftime status is what
    // makes "editable until half-time" a server rule instead of UI copy.
    if (match.status === "halftime" || match.status === "finished") {
      return bad(res, "SUB_LOCKED_HALFTIME");
    }
    if (match.status !== "live" && match.status !== "scheduled") return bad(res, "SUB_ONLY_DURING_LIVE");
    if (match.status === "scheduled" && new Date(window.opensAt ?? "").getTime() > now.getTime()) {
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

export { MECHANICS, lockWindowFor };
