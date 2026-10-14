/**
 * Admin routes (ADMIN_TELEGRAM_IDS gate): manual sync triggers and the
 * single-recipient push. Behavior unchanged.
 */
import express from "express";
import { getDb, get, run, all } from "../db/index.js";
import { syncScoreboards, syncScoreboardWindow, syncStandings } from "../sync/service.js";
import { bad, isAdmin, requireUser } from "./shared.js";
import { getBot } from "../bot/index.js";

const db = getDb();

export const adminRouter = express.Router();

adminRouter.get("/api/admin/stats", requireUser, (_req, res) => {
  if (!isAdmin(_req)) return bad(res, "admin only", 403);
  const users = get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM users");
  const matches = get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM matches");
  const predictions = get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM predictions");
  const favorites = get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM favorite_teams");
  res.json({
    stats: {
      totalUsers: users?.n ?? 0,
      totalMatches: matches?.n ?? 0,
      totalPredictions: predictions?.n ?? 0,
      totalFavorites: favorites?.n ?? 0,
    },
  });
});

adminRouter.post("/api/admin/sync", requireUser, async (_req, res) => {
  if (!isAdmin(_req)) return bad(res, "admin only", 403);
  try {
    await Promise.all([syncScoreboards(), syncStandings()]);
    res.json({ ok: true });
  } catch (err) {
    bad(res, `sync failed: ${String(err).slice(0, 120)}`, 500);
  }
});

adminRouter.post("/api/admin/broadcast", requireUser, async (req, res) => {
  if (!isAdmin(req)) return bad(res, "admin only", 403);
  const message = String(req.body?.message ?? "").trim();
  if (!message) return bad(res, "message required");
  const users = all<{ telegram_id: string }>(
    db,
    "SELECT telegram_id FROM users WHERE telegram_id NOT LIKE 'guest:%' AND telegram_id NOT LIKE 'pwd:%' AND telegram_id NOT LIKE 'dev:%'",
  );
  let sent = 0;
  for (const u of users) {
    try {
      await getBot()?.api.sendMessage(u.telegram_id, message);
      sent++;
      await new Promise((r) => setTimeout(r, 50));
    } catch {
      // skip blocked/deactivated users
    }
  }
  res.json({ ok: true, sent });
});

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

adminRouter.post("/api/admin/sync-standings", requireUser, async (_req, res) => {
  if (!isAdmin(_req)) return bad(res, "admin only", 403);
  try {
    await syncStandings();
    res.json({ ok: true, message: "Standings sync complete" });
  } catch (err) {
    bad(res, `sync failed: ${String(err).slice(0, 120)}`, 500);
  }
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
