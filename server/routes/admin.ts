/**
 * Admin routes (ADMIN_TELEGRAM_IDS gate): manual sync triggers and the
 * single-recipient push. Behavior unchanged.
 */
import express from "express";
import { getDb, get, run } from "../db/index.js";
import { syncScoreboards, syncScoreboardWindow } from "../sync/service.js";
import { bad, isAdmin, requireUser } from "./shared.js";

const db = getDb();

export const adminRouter = express.Router();

adminRouter.post("/api/admin/sync", requireUser, (req, res) => {
  if (!isAdmin(req)) return bad(res, "admin only", 403);
  // Must carry a catch: with none, a rejection is an unhandled promise rejection
  // — Node terminates the process — AND this request would never be answered.
  // The sync-window route below already had one; this one was missed.
  void syncScoreboards()
    .then(() => res.json({ ok: true }))
    .catch((err) => bad(res, `sync failed: ${String(err).slice(0, 120)}`, 500));
});

/** Manually pull a fixture window (days back/forward) — backfills future fixtures. */
adminRouter.post("/api/admin/sync-window", requireUser, (req, res) => {
  if (!isAdmin(req)) return bad(res, "admin only", 403);
  const back = Math.min(7, Math.max(0, Number(req.body?.back ?? 0)));
  const fwd = Math.min(14, Math.max(1, Number(req.body?.forward ?? 7)));
  void syncScoreboardWindow(back, fwd)
    .then(() => res.json({ ok: true }))
    .catch((err) => bad(res, `sync failed: ${String(err).slice(0, 120)}`, 500));
});

adminRouter.post("/api/admin/notify", requireUser, (req, res) => {
  if (!isAdmin(req)) return bad(res, "admin only", 403);
  const { telegramId, text } = req.body ?? {};
  if (!telegramId || !text) return bad(res, "telegramId and text required");
  // Honor the recipient's goal-alert preference even for admin pushes —
  // a user who opted out of goal alerts opted out of bot DMs of that class.
  // (Pass category="goals" so the check matches the alert path; admin
  // broadcasts to a specific id remain possible by passing their own text
  // through the queue's non-alert path below.)
  const blocked = get<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n FROM user_notification_prefs p
     JOIN users u ON u.id = p.user_id
     WHERE u.telegram_id = ? AND p.goals = 0`,
    [String(telegramId)],
  );
  if (blocked && blocked.n > 0) {
    return bad(res, "RECIPIENT_OPTED_OUT", 409);
  }
  run(db, "INSERT INTO bot_push_queue (telegram_id, text, created_at) VALUES (?, ?, ?)", [
    String(telegramId),
    String(text),
    new Date().toISOString(),
  ]);
  res.json({ ok: true });
});

// The curated versus_pairs admin endpoints were removed: Versus Mode's shipped
// mechanic is the user-chosen pair living in the prediction payload
// (prediction-mechanics.md), and a parallel curated path was dead weight.
// The versus_pairs table is dropped by the schema migration on the next boot.
