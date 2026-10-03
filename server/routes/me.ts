/**
 * /api/me routes: profile, display name, language, favorites (+anchor),
 * followed leagues, prediction history, streak, notification prefs.
 */
import express from "express";
import { getDb, all, get, run, tx } from "../db/index.js";
import { TEAM_GROUP_SQL, TEAM_GROUP_PARAMS, favoriteCapError } from "../db/teamGroups.js";
import { writeLimiter } from "../auth/rateLimit.js";
import { currentSeasonLabel } from "../scoring/ledger.js";
import { evaluateStreakForUser } from "../scoring/streak.js";
import { referralStats, redeemReferralCode } from "../scoring/referral.js";
import { POINTS as SCORING_POINTS } from "../scoring/predictionScore.js";
import { bad, currentUser, requireUser, MAX_LEAGUES } from "./shared.js";

const db = getDb();

/** Streak thresholds + bonus sizes mirrored from the scoring module (doc parity). */
const STREAK_THRESHOLDS = SCORING_POINTS.streakThresholds;
const STREAK_BONUS = SCORING_POINTS.streak as Record<number, number>;

export const meRouter = express.Router();

/* ------------------------------------------------------------ referrals */

// The caller's invite code (allocated on first ask) plus their redemption
// stats — Profile renders the share code and the honest paid-vs-cap count.
meRouter.get("/api/me/referral", requireUser, (_req, res) => {
  res.json({ referral: referralStats(db, currentUser(_req).id) });
});

// Redeem an invite code. One redemption per account, ever; the referrer is
// paid a fixed bonus (global board only) while their cap lasts — the
// connection is recorded either way. Rate-limited like every write.
meRouter.post("/api/me/referral/redeem", requireUser, writeLimiter, (req, res) => {
  const code = String(req.body?.code ?? "");
  const result = redeemReferralCode(db, currentUser(req).id, code);
  if (!result.ok) {
    return bad(res, result.error, result.error === "INVALID_CODE" ? 404 : 400);
  }
  res.json(result);
});

/* ------------------------------------------------------------ profile */

// The signed-in user's profile (shared by Profile screen and header).
meRouter.get("/api/me", requireUser, (req, res) => {
  const u = currentUser(req);
  const favCount = get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM favorite_teams WHERE user_id = ?", [
    u.id,
  ]);
  const leagueCount = get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM followed_leagues WHERE user_id = ?", [
    u.id,
  ]);
  const cred = get<{ username: string }>(db, "SELECT username FROM user_credentials WHERE user_id = ?", [
    u.id,
  ]);
  // The language the client last reported, so a fresh device can adopt it
  // rather than guessing from navigator.language.
  const prefs = get<{ language: string }>(db, "SELECT language FROM users WHERE id = ?", [u.id]);
  res.json({
    user: { ...u, username: cred?.username ?? null, language: prefs?.language ?? "en" },
    favorites: favCount?.n ?? 0,
    leagues: leagueCount?.n ?? 0,
    authMode: (req as any).authMode ?? "telegram",
  });
});

/**
 * Rename the caller's display name (Profile tab). User-owned from here on:
 * upsertUser never rewrites it afterwards, so the choice sticks across
 * Telegram sessions too.
 */
meRouter.post("/api/me/display-name", requireUser, writeLimiter, (req, res) => {
  const displayName = String(req.body?.displayName ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
  if (!displayName) return bad(res, "EMPTY_NAME");
  run(db, "UPDATE users SET display_name = ? WHERE id = ?", [displayName, currentUser(req).id]);
  res.json({ ok: true, displayName });
});

/**
 * The language this account reads the app in (`en` | `fa`).
 *
 * The CLIENT owns this value — it is a per-device choice made in Profile — and
 * reports it here so the bot can write pushes in the same language
 * (`server/messages.ts`). Deliberately not validated against anything but the
 * two supported tags: a bad value is a client bug, and BAD_LANGUAGE is a
 * machine-readable code like the favorites errors.
 */
meRouter.post("/api/me/language", requireUser, writeLimiter, (req, res) => {
  const language = String(req.body?.language ?? "");
  if (language !== "en" && language !== "fa") return bad(res, "BAD_LANGUAGE");
  run(db, "UPDATE users SET language = ? WHERE id = ?", [language, currentUser(req).id]);
  res.json({ ok: true, language });
});

/* ------------------------------------------------------------ my teams */

meRouter.get("/api/me/favorites", requireUser, (_req, res) => {
  const userId = currentUser(_req).id;
  const rows = all<{
    id: string;
    name: string;
    short_name: string | null;
    abbreviation: string | null;
    color: string | null;
    logo_url: string | null;
    league: string;
    group_key: string;
    is_favorite: number;
    created_at: string;
  }>(
    db,
    `SELECT t.id, t.name, t.short_name, t.abbreviation, t.color, t.logo_url, t.league,
            ${TEAM_GROUP_SQL} AS group_key, f.is_favorite, f.created_at
     FROM favorite_teams f JOIN teams t ON t.id = f.team_id
     WHERE f.user_id = ?
     ORDER BY f.is_favorite DESC, f.created_at ASC`,
    [...TEAM_GROUP_PARAMS, userId],
  );
  res.json({ favorites: rows });
});

meRouter.post("/api/me/favorites", requireUser, (req, res) => {
  const teamId = String(req.body?.teamId ?? "");
  if (!teamId) return bad(res, "teamId required");
  const team = get<{ id: string; league: string; name: string; group_key: string }>(
    db,
    `SELECT t.id, t.league, t.name, ${TEAM_GROUP_SQL} AS group_key FROM teams t WHERE t.id = ?`,
    [...TEAM_GROUP_PARAMS, teamId],
  );
  if (!team) return bad(res, "unknown team", 404);
  // Every side we know is followable — domestic clubs, cup-only clubs
  // (Ajax, Benfica, Celtic) and national teams. National teams get their own
  // OPTIONAL shelf: up to five of them on top of the five clubs, so a user
  // can follow Brazil alongside Barcelona without giving anything up. The
  // buckets come from the same group_key the picker tabs show, so the rule a
  // tap hits is exactly the tab it was made on (see server/db/teamGroups.ts).
  const userId = currentUser(req).id;

  // Check-then-insert must be atomic: two rapid taps both read a free slot
  // and both insert unless the caps are enforced inside one transaction. The
  // UNIQUE(user_id, team_id) constraint backs the duplicate case at the
  // storage layer; the cap check rides in the same tx.
  try {
    tx(db, () => {
      const existing = all<{ team_id: string; group_key: string }>(
        db,
        `SELECT f.team_id AS team_id, ${TEAM_GROUP_SQL} AS group_key
         FROM favorite_teams f JOIN teams t ON t.id = f.team_id
         WHERE f.user_id = ?`,
        [...TEAM_GROUP_PARAMS, userId],
      );

      if (existing.some((e) => e.team_id === teamId)) throw new Error("ALREADY_FOLLOWING");
      const capError = favoriteCapError(
        existing.map((e) => e.group_key),
        team.group_key,
      );
      if (capError) throw new Error(capError);

      run(db, "INSERT INTO favorite_teams (user_id, team_id, created_at) VALUES (?, ?, ?)", [
        userId,
        teamId,
        new Date().toISOString(),
      ]);
    });
  } catch (err) {
    const msg = String(err);
    const code = msg.includes("ALREADY_FOLLOWING")
      ? "ALREADY_FOLLOWING"
      : msg.includes("MAX_CLUBS")
        ? "MAX_CLUBS"
        : msg.includes("MAX_INTERNATIONALS")
          ? "MAX_INTERNATIONALS"
          : msg.includes("UNIQUE")
            ? "ALREADY_FOLLOWING" // storage-level duplicate guard
            : null;
    if (code) return bad(res, code);
    throw err;
  }
  res.json({ ok: true });
});

meRouter.delete("/api/me/favorites/:teamId", requireUser, (req, res) => {
  run(db, "DELETE FROM favorite_teams WHERE user_id = ? AND team_id = ?", [
    currentUser(req).id,
    String(req.params.teamId),
  ]);
  res.json({ ok: true });
});

/** Set (or move) the anchor club — the one shown first everywhere. */
meRouter.put("/api/me/favorites/:teamId/anchor", requireUser, (req, res) => {
  const teamId = String(req.params.teamId);
  const follows = get<{ n: number }>(
    db,
    "SELECT COUNT(*) AS n FROM favorite_teams WHERE user_id = ? AND team_id = ?",
    [currentUser(req).id, teamId],
  );
  if (!follows || follows.n === 0) return bad(res, "NOT_FOLLOWING", 404);
  tx(db, () => {
    run(db, "UPDATE favorite_teams SET is_favorite = 0 WHERE user_id = ?", [currentUser(req).id]);
    run(db, "UPDATE favorite_teams SET is_favorite = 1 WHERE user_id = ? AND team_id = ?", [
      currentUser(req).id,
      teamId,
    ]);
  });
  res.json({ ok: true });
});

/* ------------------------------------------------------------ followed leagues */

meRouter.get("/api/me/leagues", requireUser, (req, res) => {
  const rows = all(
    db,
    `SELECT l.league, c.name, c.kind, l.created_at
     FROM followed_leagues l LEFT JOIN competitions c ON c.slug = l.league
     WHERE l.user_id = ? ORDER BY l.created_at ASC`,
    [currentUser(req).id],
  );
  res.json({ leagues: rows });
});

meRouter.post("/api/me/leagues", requireUser, (req, res) => {
  const league = String(req.body?.league ?? "");
  if (!league) return bad(res, "league required");
  const known = get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM competitions WHERE slug = ?", [league]);
  if (!known || known.n === 0) return bad(res, "LEAGUE_NOT_COVERED", 404);

  const userId = currentUser(req).id;
  try {
    tx(db, () => {
      const existing = all<{ league: string }>(db, "SELECT league FROM followed_leagues WHERE user_id = ?", [
        userId,
      ]);
      if (existing.some((e) => e.league === league)) throw new Error("ALREADY_FOLLOWING");
      if (existing.length >= MAX_LEAGUES) throw new Error("MAX_LEAGUES");
      run(db, "INSERT INTO followed_leagues (user_id, league, created_at) VALUES (?, ?, ?)", [
        userId,
        league,
        new Date().toISOString(),
      ]);
    });
  } catch (err) {
    const msg = String(err);
    const code = msg.includes("ALREADY_FOLLOWING")
      ? "ALREADY_FOLLOWING"
      : msg.includes("MAX_LEAGUES")
        ? "MAX_LEAGUES"
        : msg.includes("UNIQUE")
          ? "ALREADY_FOLLOWING"
          : null;
    if (code) return bad(res, code);
    throw err;
  }
  res.json({ ok: true });
});

meRouter.delete("/api/me/leagues/:league", requireUser, (req, res) => {
  run(db, "DELETE FROM followed_leagues WHERE user_id = ? AND league = ?", [
    currentUser(req).id,
    String(req.params.league),
  ]);
  res.json({ ok: true });
});

/* ------------------------------------------------------------ prediction history */

meRouter.get("/api/me/predictions", requireUser, (req, res) => {
  const rows = all(
    db,
    `SELECT p.*, m.kickoff_at, m.home_score, m.away_score,
       th.short_name AS home_short, ta.short_name AS away_short
     FROM predictions p
     JOIN matches m ON m.id = p.match_id
     JOIN teams th ON th.id = m.home_team_id
     JOIN teams ta ON ta.id = m.away_team_id
     WHERE p.user_id = ? ORDER BY p.locked_at DESC LIMIT 100`,
    [currentUser(req).id],
  );
  res.json({ predictions: rows });
});

/* ------------------------------------------------------------ streak */

/*
 * The signed-in user's favorite-club streak (scoring-rules.md §6), read-only
 * for the UI. Finished favorite-club matches with unsettled predictions are
 * swept first (pending-gated, idempotent) so a just-finished match reflects
 * here without waiting for the resolver loop.
 */
meRouter.get("/api/me/streak", requireUser, (req, res) => {
  const user = currentUser(req);
  try {
    // Settle-then-read: catches up any favorite-club match whose predictions
    // resolved since the last sweep. Returns [] when there's no anchor club.
    const evaluated = evaluateStreakForUser(db, user.id);
    if (evaluated.length > 0) {
      // Reflection only — errors already logged inside the sweep.
    }
    void evaluated;
  } catch (err) {
    console.error(`[streak] GET /api/me/streak sweep failed:`, String(err).slice(0, 200));
  }

  const row = get<{ current: number; season_hits: number; thresholds_paid: string; streak_active: number }>(
    db,
    "SELECT current, season_hits, thresholds_paid, streak_active FROM user_streaks WHERE user_id = ?",
    [user.id],
  );
  const thresholdsPaid = JSON.parse(row?.thresholds_paid ?? "[]") as number[];
  const current = row?.current ?? 0;
  const next = STREAK_THRESHOLDS.find((n) => !thresholdsPaid.includes(n)) ?? null;

  res.json({
    streak: {
      current,
      active: (row?.streak_active ?? 0) === 1,
      seasonHits: row?.season_hits ?? 0,
      thresholdsPaid,
      nextThreshold: next,
      nextThresholdGap: next !== null ? Math.max(0, next - current) : null,
      nextBonus: next !== null ? (STREAK_BONUS[next] ?? 0) : null,
    },
  });
});

/* ------------------------------------------------------------ notification prefs */

/*
 * The Profile toggles, enforced server-side. The bot's push drain (and the
 * goal-alert queuer) check this table before sending, so a user who turns
 * off goal alerts actually stops receiving them. Absent row = all on.
 */

meRouter.get("/api/me/notification-prefs", requireUser, (req, res) => {
  const row = get<{ goals: number; deadline: number; ratings: number }>(
    db,
    "SELECT goals, deadline, ratings FROM user_notification_prefs WHERE user_id = ?",
    [currentUser(req).id],
  );
  res.json({
    prefs: {
      goals: row ? row.goals === 1 : true,
      deadline: row ? row.deadline === 1 : true,
      ratings: row ? row.ratings === 1 : true,
    },
  });
});

meRouter.put("/api/me/notification-prefs", requireUser, writeLimiter, (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const bool = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);
  // Read the current row first so a partial payload only flips what it names.
  const existing = get<{ goals: number; deadline: number; ratings: number }>(
    db,
    "SELECT goals, deadline, ratings FROM user_notification_prefs WHERE user_id = ?",
    [currentUser(req).id],
  );
  const goals = bool(body.goals, existing ? existing.goals === 1 : true);
  const deadline = bool(body.deadline, existing ? existing.deadline === 1 : true);
  const ratings = bool(body.ratings, existing ? existing.ratings === 1 : true);
  run(
    db,
    `INSERT INTO user_notification_prefs (user_id, goals, deadline, ratings, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       goals = excluded.goals, deadline = excluded.deadline, ratings = excluded.ratings,
       updated_at = excluded.updated_at`,
    [currentUser(req).id, goals ? 1 : 0, deadline ? 1 : 0, ratings ? 1 : 0, new Date().toISOString()],
  );
  res.json({ ok: true, prefs: { goals, deadline, ratings } });
});

export { currentSeasonLabel };
