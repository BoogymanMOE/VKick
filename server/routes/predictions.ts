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

/**
 * Mechanics that only open once ESPN's official lineup is out. The Lineup
 * Predictor is deliberately excluded — predicting the XI *before* release is
 * its whole point, and it runs on its own 2h-before-kickoff lock.
 */
const LINEUP_GATED: Mechanic[] = ["sub", "shot_predict", "player_watch", "versus"];

/**
 * Whether the match's official lineup has been published.
 *
 * Primary signal: `home_formation`, set by the summary sync exactly when ESPN
 * ships the starting XI + formation (the same flag the lineup-drop push and
 * the Sub window use — see notifications.ts). Not a wall-clock guess.
 *
 * Fallback: some competitions send the starting XI in `match_player_stats`
 * without ever writing a formation string, which would otherwise strand the
 * gated mechanics forever behind a signal that league never emits. Once BOTH
 * sides have at least one starter recorded, the XI is de facto public.
 */
export function isLineupPublished(matchId: string): boolean {
  const row = get<{ home_formation: string | null }>(
    db,
    "SELECT home_formation FROM matches WHERE id = ?",
    [matchId],
  );
  if (row?.home_formation) return true;
  const starters = get<{ teams: number }>(
    db,
    "SELECT COUNT(DISTINCT team_id) AS teams FROM match_player_stats WHERE match_id = ? AND started = 1",
    [matchId],
  );
  return (starters?.teams ?? 0) >= 2;
}

export const predictionsRouter = express.Router();

/**
 * Per-mechanic lock windows, relative to each match's kickoff
 * (`prediction-mechanics.md`). The old single gameweek deadline is gone.
 *
 *   lineup:       opens now (no scheduled open time), locks 2h before kickoff
 *                 — deliberately earlier than ESPN's ~1h XI release, because
 *                 predicting the XI before it is out is the whole game.
 *   shot_predict: opens once the OFFICIAL lineup is published (the GET path
 *   player_watch: clears `opensAt` then); the kickoff − 1h value here is only
 *   versus:       the pre-publication clock proxy. All three lock at kickoff.
 *   sub:          the same lineup gate opens it; the live first half keeps it
 *                 editable and half-time closes it (status-driven, not clock).
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
  const lineupPublished = isLineupPublished(matchId);
  const windows = kickoffRow
    ? Object.fromEntries(
        MECHANICS.map((m) => {
          const w = lockWindowFor(m, kickoffRow.kickoff_at);
          const gated = LINEUP_GATED.includes(m);
          // Self-describing: the client renders the gate from this flag rather
          // than carrying its own copy of the set. Gated mechanics open with
          // the OFFICIAL lineup, not the kickoff-1h estimate — once it is out
          // their window is open now (opensAt null = no scheduled open time),
          // which is what lets a pick land in the ~1h before kickoff even when
          // the earlier clock-proxy would still have it shut.
          return [
            m,
            {
              ...w,
              requires: gated ? ("lineup" as const) : null,
              ...(gated && lineupPublished ? { opensAt: null } : {}),
            },
          ];
        }),
      )
    : {};
  res.json({
    predictions: rows,
    windows,
    matchStatus: kickoffRow?.status ?? null,
    lineupPublished,
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
  if (LINEUP_GATED.includes(mechanic as Mechanic) && !isLineupPublished(matchId)) {
    return bad(res, "LINEUP_NOT_PUBLISHED");
  }

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

export { MECHANICS, LINEUP_GATED, lockWindowFor };
