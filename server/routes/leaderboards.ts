/**
 * Season leaderboards over the points ledger (scoring-rules.md):
 *   global           — every award, all matches + streak bonuses
 *   league:<slug>    — prediction awards on matches in one league
 *   club:<teamId>    — prediction awards on matches involving one club
 * Maintained incrementally in user_point_totals by server/scoring/ledger.ts;
 * these endpoints are pure reads. Streak bonuses feed global only.
 * Ratings and comments never contribute (the ledger has no path from them).
 * Tiebreaker: reached_total_at — the timestamp of the award that pushed the
 * user to their current total, recorded at award time, earlier wins.
 */
import express, { type Request } from "express";
import { getDb, get } from "../db/index.js";
import { readLeaderboard, readViewerRank } from "../scoring/ledger.js";
import { activeSeason } from "../scoring/season.js";
import { verifyInitData, verifyDevToken } from "../telegram/verify.js";
import { botToken, devSecret } from "./shared.js";

const db = getDb();

const LEADERBOARD_LIMIT = 100;

export const leaderboardsRouter = express.Router();

/*
 * Boards are public but viewer-aware: when a valid Authorization header is
 * present the caller's row is flagged `is_you` so the client can highlight
 * it ("your rank surfaced" from the roadmap). Anonymous reads render the
 * same board without any highlighted row.
 */
function optionalViewerId(req: Request): number | undefined {
  try {
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) return undefined;
    if (token.startsWith("mg_")) {
      return get<{ user_id: number }>(db, "SELECT user_id FROM user_sessions WHERE token = ?", [token])
        ?.user_id;
    }
    // initData / dev tokens verify through the same helper requireUser uses;
    // keep it light: reuse requireUser's verification without failing the
    // request when absent.
    const real = botToken() ? verifyInitData(token, botToken()) : { ok: false as const };
    if (real.ok) {
      return get<{ id: number }>(db, "SELECT id FROM users WHERE telegram_id = ?", [String(real.user.id)])
        ?.id;
    }
    const dev = verifyDevToken(token, devSecret());
    if (dev.ok) {
      return get<{ id: number }>(db, "SELECT id FROM users WHERE telegram_id = ?", [String(dev.user.id)])?.id;
    }
  } catch {
    /* anonymous read */
  }
  return undefined;
}

function boardPayload(scope: string, req: Request) {
  const viewerId = optionalViewerId(req);
  // Data-driven season (scoring-rules.md §8): the label follows the most
  // recent tracked-league kickoff, so boards close when the last league
  // finishes and open at the next one's first kickoff — not on a calendar date.
  const season = activeSeason(db);
  return {
    board: readLeaderboard(db, scope, season, LEADERBOARD_LIMIT, viewerId).map((r) => ({
      rank: r.rank,
      display_name: r.display_name,
      username: r.username,
      is_you: r.is_you,
      total: r.total,
      last_award: r.reached_total_at,
    })),
    // The viewer's own rank when it sits below the page limit (null when they
    // haven't scored, or are already visible on the board).
    you: viewerId !== undefined ? readViewerRank(db, scope, season, viewerId) : null,
  };
}

leaderboardsRouter.get("/api/leaderboards/global", (req, res) => {
  res.json(boardPayload("global", req));
});

leaderboardsRouter.get("/api/leaderboards/league/:league", (req, res) => {
  res.json(boardPayload(`league:${String(req.params.league)}`, req));
});

leaderboardsRouter.get("/api/leaderboards/club/:teamId", (req, res) => {
  res.json(boardPayload(`club:${String(req.params.teamId)}`, req));
});
