/**
 * Ratings + timeline comments: the 3-card rating system (server-enforced cap,
 * real per-player histograms) and pinned match comments. Behavior unchanged.
 */
import express from "express";
import { getDb, all, get, run } from "../db/index.js";
import { writeLimiter } from "../auth/rateLimit.js";
import { bad, currentUser, requireUser } from "./shared.js";
import { localHeadshotUrl } from "./football.js";

const db = getDb();

export const ratingsRouter = express.Router();

const MIN_VOTES_TO_SHOW = 3;
/** The 3-card rule: each user rates exactly 3 players of their choice per match. */
const MAX_RATINGS_PER_MATCH = 3;

/**
 * The two aggregates this query computes. Everything else in the row is a
 * passthrough column, so the index signature keeps it available downstream
 * without restating the whole SELECT.
 */
type RatingAggRow = Record<string, unknown> & {
  votes: number;
  avg_rating: number | null;
};

ratingsRouter.get("/api/matches/:id/ratings", requireUser, (req, res) => {
  const matchId = String(req.params.id);
  const userId = currentUser(req).id;
  const rows = all<RatingAggRow>(
    db,
    `SELECT s.player_id, p.full_name AS name, p.short_name, s.team_id, p.position,
            p.headshot_url, s.stat_score, s.stat_breakdown, s.started, s.minutes_played,
            AVG(r.rating) AS avg_rating, COUNT(r.rating) AS votes,
            (SELECT rating FROM crowd_ratings WHERE user_id = ? AND player_id = s.player_id AND match_id = s.match_id) AS my_rating,
            (SELECT rc.comment FROM crowd_ratings rc
              WHERE rc.user_id = ? AND rc.player_id = s.player_id AND rc.match_id = s.match_id
                AND rc.comment_hidden = 0) AS my_comment,
            (SELECT rc.comment FROM crowd_ratings rc
              WHERE rc.player_id = s.player_id AND rc.match_id = s.match_id AND rc.comment IS NOT NULL
                AND rc.comment_hidden = 0
              ORDER BY rc.created_at DESC LIMIT 1) AS latest_comment,
            (SELECT rc.id FROM crowd_ratings rc
              WHERE rc.player_id = s.player_id AND rc.match_id = s.match_id AND rc.comment IS NOT NULL
                AND rc.comment_hidden = 0
              ORDER BY rc.created_at DESC LIMIT 1) AS latest_comment_id
     FROM match_player_stats s
     JOIN players p ON p.id = s.player_id
     LEFT JOIN crowd_ratings r ON r.player_id = s.player_id AND r.match_id = s.match_id
     WHERE s.match_id = ? AND s.minutes_played > 0
     GROUP BY s.player_id
     ORDER BY s.team_id, s.started DESC, s.minutes_played DESC`,
    [userId, userId, matchId],
  );
  const withRatings = rows.map((r) => ({
    ...r,
    avatarUrl: localHeadshotUrl(typeof r.headshot_url === "string" ? r.headshot_url : null, String(r.player_id)),
    // votes >= 3 implies avg_rating is non-null (COUNT and AVG see the same
    // NOT NULL rating column), so the null check only satisfies the compiler.
    crowd_rating:
      r.votes >= MIN_VOTES_TO_SHOW && r.avg_rating != null ? Math.round(r.avg_rating * 10) / 10 : null,
  }));
  const used = get<{ n: number }>(
    db,
    "SELECT COUNT(*) AS n FROM crowd_ratings WHERE user_id = ? AND match_id = ?",
    [userId, matchId],
  );
  // Real per-player histogram (10 integer buckets, index 0 = rating 1) for the
  // RateSheet chart. One GROUP BY, no N+1; absent key = no votes yet.
  const distRows = all<{ player_id: string; rating: number; n: number }>(
    db,
    "SELECT player_id, rating, COUNT(*) AS n FROM crowd_ratings WHERE match_id = ? GROUP BY player_id, rating",
    [matchId],
  );
  const distributions: Record<string, number[]> = {};
  for (const d of distRows) {
    const buckets = distributions[d.player_id] ?? Array.from({ length: 10 }, () => 0);
    if (Number.isInteger(d.rating) && d.rating >= 1 && d.rating <= 10) buckets[d.rating - 1] = d.n;
    distributions[d.player_id] = buckets;
  }
  res.json({
    players: withRatings,
    minVotes: MIN_VOTES_TO_SHOW,
    cardsUsed: used?.n ?? 0,
    cardsMax: MAX_RATINGS_PER_MATCH,
    distributions,
  });
});

ratingsRouter.post("/api/matches/:id/ratings", requireUser, writeLimiter, (req, res) => {
  const matchId = String(req.params.id);
  const { playerId, rating, comment } = req.body ?? {};
  const r = Number(rating);
  if (!playerId || !Number.isInteger(r) || r < 1 || r > 10) {
    return bad(res, "playerId and integer rating 1-10 required");
  }
  const commentText = typeof comment === "string" ? comment.trim().slice(0, 280) : "";
  const played = get<{ minutes_played: number }>(
    db,
    "SELECT minutes_played FROM match_player_stats WHERE match_id = ? AND player_id = ?",
    [matchId, String(playerId)],
  );
  if (!played || (played.minutes_played ?? 0) <= 0) {
    return bad(res, "player did not feature in this match");
  }
  const userId = currentUser(req).id;
  // If this player is already one of the user's 3 cards, it's an edit — the
  // upsert handles it. A NEW card must respect the 3-per-match cap.
  const existing = get<{ n: number }>(
    db,
    "SELECT COUNT(*) AS n FROM crowd_ratings WHERE user_id = ? AND match_id = ?",
    [userId, matchId],
  );
  const alreadyRated = get<{ n: number }>(
    db,
    "SELECT COUNT(*) AS n FROM crowd_ratings WHERE user_id = ? AND match_id = ? AND player_id = ?",
    [userId, matchId, String(playerId)],
  );
  if ((alreadyRated?.n ?? 0) === 0 && (existing?.n ?? 0) >= MAX_RATINGS_PER_MATCH) {
    return bad(res, "RATING_CAP_REACHED");
  }
  run(
    db,
    `INSERT INTO crowd_ratings (user_id, player_id, match_id, rating, comment, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, player_id, match_id) DO UPDATE SET
       rating = excluded.rating, comment = excluded.comment, created_at = excluded.created_at`,
    [userId, String(playerId), matchId, r, commentText || null, new Date().toISOString()],
  );
  res.json({
    ok: true,
    cardsUsed: Math.min(MAX_RATINGS_PER_MATCH, (existing?.n ?? 0) + ((alreadyRated?.n ?? 0) > 0 ? 0 : 1)),
  });
});

/* ------------------------------------------------------------ comments */

ratingsRouter.get("/api/matches/:id/comments", requireUser, (req, res) => {
  const matchId = String(req.params.id);
  const rows = all(
    db,
    `     SELECT c.*, u.display_name AS author
     FROM timeline_comments c JOIN users u ON u.id = c.user_id
     WHERE c.match_id = ? AND c.hidden = 0
     ORDER BY c.minute_seconds ASC, c.created_at ASC`,
    [matchId],
  );
  res.json({ comments: rows });
});

ratingsRouter.post("/api/matches/:id/comments", requireUser, writeLimiter, (req, res) => {
  const matchId = String(String(req.params.id));
  const { text, eventId, minuteDisplay, mediaLink } = req.body ?? {};
  const t = String(text ?? "").trim();
  if (!t) return bad(res, "text required");
  if (t.length > 500) return bad(res, "text too long (max 500)");
  if (mediaLink && !/^https:\/\//.test(String(mediaLink))) {
    return bad(res, "mediaLink must be an https URL");
  }
  let minuteSeconds: number | null = null;
  let minuteDisplayOut: string | null = null;
  let eventRow: { id: number; minute_display: string; minute_seconds: number } | undefined;

  if (eventId) {
    eventRow = get<{ id: number; minute_display: string; minute_seconds: number }>(
      db,
      "SELECT id, minute_display, minute_seconds FROM timeline_events WHERE id = ? AND match_id = ?",
      [Number(eventId), matchId],
    );
    if (!eventRow) return bad(res, "unknown event for this match");
    minuteSeconds = eventRow.minute_seconds;
    minuteDisplayOut = eventRow.minute_display;
  } else if (minuteDisplay) {
    const m = String(minuteDisplay).match(/^(\d+)/);
    minuteSeconds = m ? parseInt(m[1] as string, 10) * 60 : 0;
    minuteDisplayOut = String(minuteDisplay);
  } else {
    return bad(res, "eventId or minuteDisplay required");
  }

  const info = db
    .prepare(
      `INSERT INTO timeline_comments (event_id, match_id, minute_display, minute_seconds, user_id, text, media_link, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      eventRow?.id ?? null,
      matchId,
      minuteDisplayOut as string | null,
      minuteSeconds as number | null,
      currentUser(req).id,
      t,
      mediaLink ? String(mediaLink) : null,
      new Date().toISOString(),
    );
  res.json({ ok: true, id: info.lastInsertRowid });
});
