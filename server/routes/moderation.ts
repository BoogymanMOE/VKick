/**
 * Moderation: user-filed reports and the admin queue that acts on them.
 *
 *   POST   /api/reports                       report a timeline or rating comment
 *   GET    /api/admin/reports                 list the queue (admin only)
 *   DELETE /api/admin/comments/:type/:id       remove a comment (admin only)
 *   POST   /api/admin/users/:id/hide-comments  hide/unhide a user's comments
 *
 * Reports are one-per-user-per-comment (the UNIQUE index is the enforcement —
 * INSERT … ON CONFLICT DO NOTHING), rate-limited like other writes. Admin
 * endpoints share the ADMIN_TELEGRAM_IDS gate every /api/admin route uses and
 * answer 403 for anyone else.
 *
 * "Hiding" is non-destructive on purpose: hidden comments keep their row, they
 * just stop appearing in the public reads (GET comments / GET ratings both
 * filter them). A rating comment hides the COMMENT only — the rating number
 * stays part of the crowd average, because a report is about the words.
 */
import express from "express";
import { getDb, all, get } from "../db/index.js";
import { reportLimiter } from "../auth/rateLimit.js";
import { bad, currentUser, isAdmin, requireUser } from "./shared.js";

const db = getDb();

export const moderationRouter = express.Router();

const COMMENT_TYPES = new Set(["timeline", "rating"]);

/** Does the referenced comment exist? (A rating only counts when it has text.) */
function commentExists(type: string, id: number): boolean {
  if (type === "timeline") {
    return Boolean(get(db, "SELECT 1 FROM timeline_comments WHERE id = ?", [id]));
  }
  return Boolean(get(db, "SELECT 1 FROM crowd_ratings WHERE id = ? AND comment IS NOT NULL", [id]));
}

/* ------------------------------------------------------------ reports */

moderationRouter.post("/api/reports", requireUser, reportLimiter, (req, res) => {
  const commentType = String(req.body?.commentType ?? "");
  const commentId = Number(req.body?.commentId);
  if (!COMMENT_TYPES.has(commentType) || !Number.isInteger(commentId) || commentId <= 0) {
    return bad(res, "commentType and commentId required");
  }
  if (!commentExists(commentType, commentId)) return bad(res, "unknown comment", 404);
  const reason = String(req.body?.reason ?? "")
    .trim()
    .slice(0, 280);
  const info = db
    .prepare(
      `INSERT INTO comment_reports (comment_type, comment_id, reporter_user_id, reason, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(reporter_user_id, comment_type, comment_id) DO NOTHING`,
    )
    .run(commentType, commentId, currentUser(req).id, reason || null, new Date().toISOString());
  // A repeat report is a no-op, not an error: the second tap means "still bad".
  res.json({ ok: true, duplicate: Number(info.changes ?? 0) === 0 });
});

/* ------------------------------------------------------------ admin queue */

moderationRouter.get("/api/admin/reports", requireUser, (req, res) => {
  if (!isAdmin(req)) return bad(res, "admin only", 403);
  const reports = all(
    db,
    `SELECT r.id, r.comment_type, r.comment_id, r.reason, r.created_at,
            u.display_name AS reporter,
            CASE r.comment_type
              WHEN 'timeline' THEN (SELECT t.text FROM timeline_comments t WHERE t.id = r.comment_id)
              ELSE (SELECT c.comment FROM crowd_ratings c WHERE c.id = r.comment_id)
            END AS content,
            CASE r.comment_type
              WHEN 'timeline' THEN (SELECT t.user_id FROM timeline_comments t WHERE t.id = r.comment_id)
              ELSE (SELECT c.user_id FROM crowd_ratings c WHERE c.id = r.comment_id)
            END AS content_user_id,
            CASE r.comment_type
              WHEN 'timeline' THEN (SELECT t.hidden FROM timeline_comments t WHERE t.id = r.comment_id)
              ELSE (SELECT c.comment_hidden FROM crowd_ratings c WHERE c.id = r.comment_id)
            END AS content_hidden
       FROM comment_reports r
       JOIN users u ON u.id = r.reporter_user_id
      ORDER BY r.created_at DESC
      LIMIT 200`,
  );
  res.json({ reports });
});

/** Remove a reported comment and clear its queue entries. */
moderationRouter.delete("/api/admin/comments/:type/:id", requireUser, (req, res) => {
  if (!isAdmin(req)) return bad(res, "admin only", 403);
  const type = String(req.params.type);
  const id = Number(req.params.id);
  if (!COMMENT_TYPES.has(type) || !Number.isInteger(id)) return bad(res, "bad comment reference");

  let deleted = 0;
  if (type === "timeline") {
    deleted = Number(db.prepare("DELETE FROM timeline_comments WHERE id = ?").run(id).changes ?? 0);
  } else {
    deleted = Number(
      db
        .prepare(
          "UPDATE crowd_ratings SET comment = NULL, comment_hidden = 0 WHERE id = ? AND comment IS NOT NULL",
        )
        .run(id).changes ?? 0,
    );
  }
  db.prepare("DELETE FROM comment_reports WHERE comment_type = ? AND comment_id = ?").run(type, id);
  res.json({ ok: true, deleted });
});

/** Hide (or unhide) every comment a user has posted. Reversible. */
moderationRouter.post("/api/admin/users/:id/hide-comments", requireUser, (req, res) => {
  if (!isAdmin(req)) return bad(res, "admin only", 403);
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId)) return bad(res, "bad user id");
  const hidden = req.body?.hidden === undefined ? true : Boolean(req.body.hidden);
  const flag = hidden ? 1 : 0;
  const comments = db.prepare("UPDATE timeline_comments SET hidden = ? WHERE user_id = ?").run(flag, userId);
  const ratings = db
    .prepare("UPDATE crowd_ratings SET comment_hidden = ? WHERE user_id = ?")
    .run(flag, userId);
  res.json({
    ok: true,
    hidden,
    comments: Number(comments.changes ?? 0),
    ratings: Number(ratings.changes ?? 0),
  });
});
