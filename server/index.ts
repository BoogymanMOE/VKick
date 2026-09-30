import express, { type Request, type Response, type NextFunction } from "express";
import crypto from "node:crypto";
import { getDb, all, get, run, tx, type BindValue } from "./db/index.js";
import { verifyInitData, verifyDevToken, type TelegramUser } from "./telegram/verify.js";
import { startSyncLoop, syncScoreboards, syncScoreboardWindow } from "./sync/service.js";
import { startBot } from "./bot/index.js";
import { COMPETITIONS, INTERNATIONALS, isCup } from "./espn/types.js";
import { EXTRA_COMPETITIONS } from "./espn/extra.js";
import { newSessionToken } from "./auth/session.js";
import { hashPassword, passwordValid, verifyPassword } from "./auth/password.js";
import { authLimiter, credentialLimiter, writeLimiter } from "./auth/rateLimit.js";
import { validatePayload, type Mechanic } from "./predictions/validate.js";
// Canonical season label (scoring-rules.md season boundary) + board reads.
import { readLeaderboard, currentSeasonLabel, award } from "./scoring/ledger.js";
import { foldForm, type FormMatchRow } from "./standings/form.js";
import { evaluateStreakForUser } from "./scoring/streak.js";
import { POINTS as SCORING_POINTS } from "./scoring/predictionScore.js";
import { startResolverLoop } from "./predictions/resolver.js";

/** Streak thresholds + bonus sizes mirrored from the scoring module (doc parity). */
const STREAK_THRESHOLDS = SCORING_POINTS.streakThresholds;
const STREAK_BONUS = SCORING_POINTS.streak as Record<number, number>;

const MECHANICS: Mechanic[] = ["lineup", "shot_predict", "sub", "player_watch", "versus"];

const app = express();
const db = getDb();

// Behind the vite dev proxy / a reverse proxy, so req.ip is the client.
app.set("trust proxy", true);
// 64KB body cap: far above any legit prediction/comment payload, well below
// abuse size. (default was 100KB; explicit + smaller now that payloads are validated)
app.use(express.json({ limit: "64kb" }));

/* --------------------------------------------------------------- ops */

/**
 * Liveness probe. Unauthenticated and dependency-light: it says whether the
 * process is up and the database answers, which is all an uptime monitor or a
 * proxy health check needs. 503 on a broken DB so the check can actually fail.
 */
app.get("/health", (_req, res) => {
  try {
    get<{ ok: number }>(db, "SELECT 1 AS ok", []);
    res.json({ ok: true, uptime: Math.round(process.uptime()) });
  } catch (err) {
    res.status(503).json({ ok: false, error: String(err) });
  }
});

/* ------------------------------------------------------------ sessions */

const SESSION_TTL_MS = 30 * 24 * 3_600_000; // 30 days

/** Delete sessions older than the TTL. Called on boot and daily. */
function pruneSessions(): number {
  const cutoff = new Date(Date.now() - SESSION_TTL_MS).toISOString();
  const before =
    get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM user_sessions WHERE last_used_at < ?", [cutoff])?.n ??
    0;
  if (before > 0) run(db, "DELETE FROM user_sessions WHERE last_used_at < ?", [cutoff]);
  return before;
}

/* ------------------------------------------------------------ helpers */

function botToken(): string {
  return process.env.TELEGRAM_BOT_TOKEN ?? "";
}

function devSecret(): string | undefined {
  const s = process.env.DEV_AUTH_SECRET;
  return s && s.trim() ? s.trim() : undefined;
}

interface AuthedUser {
  id: number;
  telegram_id: string;
  display_name: string;
}

type AuthMode = "session" | "telegram" | "dev";

/**
 * Require a valid identity; attaches req.user + req.authMode.
 *
 * Two token families:
 *  - `mg_<hex>` — opaque sessions issued by /api/auth/login|register (the
 *    username path). Looked up in user_sessions; logout deletes the
 *    row, which invalidates the token everywhere.
 *  - raw Telegram initData / `dev:<id>` — verified inline like before. These
 *    can't be revoked server-side (initData re-arrives on every app launch),
 *    so they keep the pre-session behaviour.
 */
function requireUser(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) {
    res.status(401).json({ error: "missing token" });
    return;
  }

  if (token.startsWith("mg_")) {
    const row = get<AuthedUser & { token: string }>(
      db,
      `SELECT u.id, u.telegram_id, u.display_name, s.token
       FROM user_sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ?`,
      [token],
    );
    if (!row) {
      res.status(401).json({ error: "session expired" });
      return;
    }
    // TTL: sessions die 30 days after their last use (sliding expiry).
    const lastUsed = get<{ last_used_at: string }>(
      db,
      "SELECT last_used_at FROM user_sessions WHERE token = ?",
      [token],
    );
    if (lastUsed && Date.now() - new Date(lastUsed.last_used_at).getTime() > SESSION_TTL_MS) {
      run(db, "DELETE FROM user_sessions WHERE token = ?", [token]);
      res.status(401).json({ error: "session expired" });
      return;
    }
    run(db, "UPDATE user_sessions SET last_used_at = ? WHERE token = ?", [new Date().toISOString(), token]);
    (req as any).user = { id: row.id, telegram_id: row.telegram_id, display_name: row.display_name };
    (req as any).authMode = "session" satisfies AuthMode;
    next();
    return;
  }

  let tg: TelegramUser | null = null;
  let mode: AuthMode = "telegram";
  const real = botToken()
    ? verifyInitData(token, botToken())
    : { ok: false as const, reason: "no bot token configured" };
  if (real.ok) {
    tg = real.user;
  } else {
    const dev = verifyDevToken(token, devSecret());
    if (dev.ok) {
      tg = dev.user;
      mode = "dev";
    }
  }
  if (!tg) {
    res.status(401).json({ error: "invalid token" });
    return;
  }
  const telegramId = String(tg.id);
  const displayName =
    [tg.first_name, tg.last_name].filter(Boolean).join(" ") || tg.username || `User ${tg.id}`;
  // Upsert (not select-then-insert): two rapid first requests from the same
  // Telegram client race the SELECT, and the loser used to hit UNIQUE -> 500.
  const user = upsertUser(telegramId, displayName);
  (req as any).user = user;
  (req as any).authMode = mode;
  next();
}

function currentUser(req: Request): AuthedUser {
  return (req as any).user as AuthedUser;
}

function isAdmin(req: Request): boolean {
  const ids = (process.env.ADMIN_TELEGRAM_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (ids.length === 0) return false;
  return ids.includes(currentUser(req).telegram_id);
}

/** Create a session row and return its bearer token (mg_ prefix). */
function issueSession(userId: number): string {
  const token = `mg_${newSessionToken()}`;
  const now = new Date().toISOString();
  run(db, "INSERT INTO user_sessions (token, user_id, created_at, last_used_at) VALUES (?, ?, ?, ?)", [
    token,
    userId,
    now,
    now,
  ]);
  return token;
}

const USERNAME_RE = /^[a-zA-Z0-9_.]{3,24}$/;

/**
 * Well-formed scrypt hash of a random secret, used ONLY to equalize login
 * timing for unknown usernames (one scrypt verification either way). It
 * matches nothing; it is not a credential and never leaves this module.
 */
const DUMMY_PASSWORD_HASH = hashPassword(crypto.randomBytes(16).toString("hex"));

/**
 * Username accounts (username + scrypt password). telegram_id stays UNIQUE
 * NOT NULL in the users table, so these accounts are parked under a
 * `pwd:<username>` synthetic id (legacy prefix, kept so existing accounts
 * keep their identity); they never receive Telegram pushes.
 */
function findUserByUsername(username: string): AuthedUser | undefined {
  // Usernames are case-insensitive (NOCASE unique on user_credentials), so
  // the lookup states the collation explicitly rather than relying on it.
  return get<AuthedUser>(
    db,
    `SELECT u.id, u.telegram_id, u.display_name
     FROM users u JOIN user_credentials c ON c.user_id = u.id
     WHERE c.username = ? COLLATE NOCASE`,
    [username],
  );
}

function publicUser(u: { id: number; display_name: string }) {
  return { id: u.id, display_name: u.display_name };
}

/** Display names: collapse runs of whitespace, cap at the client's 40 chars. */
function cleanDisplayName(raw: unknown): string {
  return String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
}

function bad(res: Response, message: string, code = 400): void {
  res.status(code).json({ error: message });
}

/* ------------------------------------------------------------ auth */

// Client posts the Telegram initData here to exchange it for... itself.
// We validate and return the profile; the initData string itself is the
// bearer token for subsequent calls.
app.post("/api/auth/login", authLimiter, credentialLimiter, (req, res) => {
  const initData = String(req.body?.initData ?? "");

  // Username login: { username, password } instead of initData. The password
  // is verified with scrypt; unknown usernames and wrong passwords return the
  // SAME 401 (INVALID_CREDENTIALS) so login never reveals which usernames
  // exist. Any request carrying a username key is a username attempt (Telegram
  // and guest logins never send one), so shape violations are BAD_USERNAME,
  // not a fall-through into the Telegram/dev path whose verify reasons
  // ("missing hash", "no bot token") have no user-facing meaning here.
  if (!initData && req.body?.username !== undefined && req.body?.username !== null) {
    const username = String(req.body.username).trim();
    if (!USERNAME_RE.test(username)) {
      bad(res, "BAD_USERNAME");
      return;
    }
    // Non-string / missing passwords simply fail verification below — the
    // response stays INVALID_CREDENTIALS either way.
    const password = typeof req.body.password === "string" ? (req.body.password as string) : "";
    const user = findUserByUsername(username);
    const stored = user
      ? (get<{ password_hash: string | null }>(
          db,
          "SELECT password_hash FROM user_credentials WHERE user_id = ?",
          [user.id],
        )?.password_hash ?? null)
      : null;
    // Equalize timing: unknown users still cost one scrypt verification
    // (against a dummy hash) so response time doesn't oracle existence.
    // Neither branch logs or returns anything password-derived.
    const ok = stored
      ? verifyPassword(password, stored)
      : (verifyPassword(password, DUMMY_PASSWORD_HASH), false);
    if (!user || !ok) {
      bad(res, "INVALID_CREDENTIALS", 401);
      return;
    }
    // Same-device guest upgrade: fold the guest's picks into this account.
    mergeIfGuest(req, user);
    const token = issueSession(user.id);
    res.json({ ok: true, mode: "session", token, user: publicUser(user) });
    return;
  }

  const dev = verifyDevToken(initData, devSecret());
  if (dev.ok) {
    // Upsert the dev user too, so dev sessions behave exactly like Telegram ones.
    const user = upsertUser(String(dev.user.id), dev.user.first_name ?? `User ${dev.user.id}`);
    mergeIfGuest(req, user);
    const token = issueSession(user.id);
    res.json({ ok: true, mode: "dev", token, user: publicUser(user) });
    return;
  }
  const result = botToken()
    ? verifyInitData(initData, botToken())
    : { ok: false as const, reason: "no bot token" };
  if (!result.ok) {
    bad(res, result.reason, 401);
    return;
  }
  const user = upsertUser(
    String(result.user.id),
    [result.user.first_name, result.user.last_name].filter(Boolean).join(" ") ||
      result.user.username ||
      `User ${result.user.id}`,
  );
  mergeIfGuest(req, user);
  // Telegram sessions get a server-side token too, so "log out" actually
  // revokes something (initData itself can't be revoked from our side).
  const token = issueSession(user.id);
  res.json({ ok: true, mode: "telegram", token, user: publicUser(user) });
});

/**
 * Silent entry (no sign-up screen): the client posts a stable random device id
 * (generated once, kept in localStorage) and gets a real user + session back.
 * The device id is the whole credential — same trust model as username-only
 * login — so it is NOT suitable as a strong identity, but it removes every
 * signup step while keeping favorites/predictions/ratings server-side.
 * If a Telegram initData rides along it is validated and preferred, so inside
 * the Mini App the guest row is immediately the Telegram identity.
 */
app.post("/api/auth/guest", authLimiter, (req, res) => {
  const deviceId = String(req.body?.deviceId ?? "").trim();
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(deviceId)) return bad(res, "BAD_DEVICE_ID");

  const initData = String(req.body?.initData ?? "");
  const verified = initData && botToken() ? verifyInitData(initData, botToken()) : null;

  // Telegram identity wins over the guest id, so reopening in the Mini App
  // merges straight into the Telegram account instead of a second profile.
  if (verified?.ok) {
    const user = upsertUser(
      String(verified.user.id),
      [verified.user.first_name, verified.user.last_name].filter(Boolean).join(" ") ||
        verified.user.username ||
        `User ${verified.user.id}`,
    );
    // Same device previously used the web guest path: bring its data along.
    mergeIfGuest(req, user);
    const token = issueSession(user.id);
    res.json({ ok: true, mode: "telegram", token, user: publicUser(user) });
    return;
  }

  const syntheticId = `guest:${deviceId.toLowerCase()}`;
  const existing = get<AuthedUser>(
    db,
    "SELECT id, telegram_id, display_name FROM users WHERE telegram_id = ?",
    [syntheticId],
  );
  const user = existing ?? upsertUser(syntheticId, `Guest ${deviceId.slice(0, 4)}`);
  const token = issueSession(user.id);
  res.json({ ok: true, mode: "session", token, user: publicUser(user) });
});

/** Register a username account (username + password). Logs the new user straight in. */
app.post("/api/auth/register", authLimiter, credentialLimiter, (req, res) => {
  const username = String(req.body?.username ?? "").trim();
  const display = cleanDisplayName(req.body?.displayName);

  if (!USERNAME_RE.test(username)) {
    return bad(res, "BAD_USERNAME");
  }
  // 8–72 chars, no composition rules. Validated before the taken-check so a
  // malformed request never touches the DB; the message is inline, not generic.
  if (!passwordValid(req.body?.password)) {
    return bad(res, "BAD_PASSWORD");
  }
  if (findUserByUsername(username)) {
    return bad(res, "USERNAME_TAKEN");
  }

  const syntheticId = `pwd:${username.toLowerCase()}`;
  try {
    const user = upsertUser(syntheticId, display || username);
    // The password is stored as scrypt (random per-user salt, params baked
    // into the hash) — never plaintext, never logged, never returned.
    run(
      db,
      "INSERT INTO user_credentials (user_id, username, password_hash, created_at) VALUES (?, ?, ?, ?)",
      [user.id, username, hashPassword(req.body.password as string), new Date().toISOString()],
    );
    // First-time registrants often picked favorites as a web guest first.
    mergeIfGuest(req, user);
    const token = issueSession(user.id);
    res.json({ ok: true, mode: "session", token, user: publicUser(user) });
  } catch (err) {
    // Check-then-insert race: two concurrent registers for the same name
    // (in any casing — the unique index is NOCASE) land here on the loser.
    if (String(err).includes("UNIQUE")) return bad(res, "USERNAME_TAKEN");
    throw err;
  }
});

/** Revoke the caller's session token. No-op for raw initData tokens. */
app.post("/api/auth/logout", requireUser, (req, res) => {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (token.startsWith("mg_")) {
    run(db, "DELETE FROM user_sessions WHERE token = ?", [token]);
  }
  res.json({ ok: true });
});

function upsertUser(telegramId: string, displayName: string): AuthedUser {
  // On conflict nothing is updated: the display name is user-owned from the
  // Profile rename onward, so a Telegram (or stale dev) name must not overwrite
  // what the user chose. Fresh rows still seed from the Telegram profile.
  run(
    db,
    `INSERT INTO users (telegram_id, display_name, created_at) VALUES (?, ?, ?)
     ON CONFLICT(telegram_id) DO NOTHING`,
    [telegramId, displayName, new Date().toISOString()],
  );
  return get<AuthedUser>(db, "SELECT id, telegram_id, display_name FROM users WHERE telegram_id = ?", [
    telegramId,
  ]) as AuthedUser;
}

const DEVICE_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * Guest upgrade path. A browser guest owns rows keyed to the synthetic
 * `guest:<deviceId>` user; when that same device later signs in as a real
 * identity (username, Telegram, dev), its data moves across so the guest
 * isn't orphaned — and clearing browser data doesn't silently lose picks.
 *
 * Merge rules per table:
 *  - favorite_teams: copied while the product cap allows (max 5; clubs the
 *    target already follows are skipped). The guest's anchor club seeds the
 *    target's anchor only if the target has none yet.
 *  - followed_leagues: copied while the cap allows (max 5; duplicates skipped).
 *  - crowd_ratings / predictions: INSERT OR IGNORE — the UNIQUE constraints
 *    make "target's existing row wins" the whole implementation.
 *  - timeline_comments: content, so authorship moves to the target.
 *  - leftovers die with the guest row (cascade-free tables deleted first).
 */
function mergeGuestIntoUser(deviceId: string, target: AuthedUser): void {
  const guest = get<{ id: number }>(db, "SELECT id FROM users WHERE telegram_id = ?", [
    `guest:${deviceId.toLowerCase()}`,
  ]);
  if (!guest || guest.id === target.id) return;

  tx(db, () => {
    // Favorites: respect the cap while copying (the POST /favorites rules).
    const targetFavs = all<{ team_id: string; is_favorite: number }>(
      db,
      `SELECT team_id, is_favorite FROM favorite_teams WHERE user_id = ?`,
      [target.id],
    );
    const guestFavs = all<{ team_id: string; is_favorite: number }>(
      db,
      `SELECT team_id, is_favorite FROM favorite_teams WHERE user_id = ?`,
      [guest.id],
    );
    for (const f of guestFavs) {
      if (targetFavs.length >= MAX_FAVORITES) break;
      if (targetFavs.some((e) => e.team_id === f.team_id)) continue;
      run(
        db,
        "INSERT OR IGNORE INTO favorite_teams (user_id, team_id, is_favorite, created_at) VALUES (?, ?, ?, ?)",
        [target.id, f.team_id, 0, new Date().toISOString()],
      );
      targetFavs.push({ team_id: f.team_id, is_favorite: 0 });
    }
    // Guest's anchor seeds the target's anchor only when none exists yet.
    if (!targetFavs.some((e) => e.is_favorite === 1)) {
      const guestAnchor = guestFavs.find((e) => e.is_favorite === 1) ?? guestFavs[0];
      if (guestAnchor) {
        run(db, "UPDATE favorite_teams SET is_favorite = 1 WHERE user_id = ? AND team_id = ?", [
          target.id,
          guestAnchor.team_id,
        ]);
      }
    }

    // Followed leagues: same cap-respecting copy.
    const targetLeagues = all<{ league: string }>(
      db,
      "SELECT league FROM followed_leagues WHERE user_id = ?",
      [target.id],
    );
    const guestLeagues = all<{ league: string }>(
      db,
      "SELECT league FROM followed_leagues WHERE user_id = ?",
      [guest.id],
    );
    for (const l of guestLeagues) {
      if (targetLeagues.length >= MAX_LEAGUES) break;
      if (targetLeagues.some((e) => e.league === l.league)) continue;
      run(db, "INSERT OR IGNORE INTO followed_leagues (user_id, league, created_at) VALUES (?, ?, ?)", [
        target.id,
        l.league,
        new Date().toISOString(),
      ]);
      targetLeagues.push(l);
    }

    // Ratings + predictions: conflict-free copy, target wins on UNIQUE hits.
    run(
      db,
      `INSERT OR IGNORE INTO crowd_ratings (user_id, player_id, match_id, rating, comment, created_at)
       SELECT ?, player_id, match_id, rating, comment, created_at FROM crowd_ratings WHERE user_id = ?`,
      [target.id, guest.id],
    );
    run(
      db,
      `INSERT OR IGNORE INTO predictions
         (user_id, match_id, mechanic, payload, locked_at, status, points_awarded, breakdown, resolved_at)
       SELECT ?, match_id, mechanic, payload, locked_at, status, points_awarded, breakdown, resolved_at
       FROM predictions WHERE user_id = ?`,
      [target.id, guest.id],
    );

    // Scoring-rules.md ledger: points live in point_ledger, keyed by the
    // (target-owned) prediction ids. Re-award every resolved, point-scoring
    // prediction that has no ledger row yet — that picks up exactly the rows
    // the copy brought over. award() is idempotent per (source, source_id).
    const copied = all<{ id: number; match_id: string; mechanic: string; points_awarded: number }>(
      db,
      `SELECT p.id, p.match_id, p.mechanic, p.points_awarded
       FROM predictions p
       WHERE p.user_id = ? AND p.points_awarded > 0
         AND NOT EXISTS (
           SELECT 1 FROM point_ledger l
           WHERE l.source = 'prediction' AND l.source_id = p.id AND l.user_id = p.user_id
         )`,
      [target.id],
    );
    for (const row of copied) {
      const m = get<{ league: string; home_team_id: string; away_team_id: string }>(
        db,
        "SELECT league, home_team_id, away_team_id FROM matches WHERE id = ?",
        [row.match_id],
      );
      award(db, {
        userId: target.id,
        matchId: row.match_id,
        source: "prediction",
        mechanic: row.mechanic,
        points: row.points_awarded,
        sourceId: row.id,
        league: m?.league ?? null,
        teamIds: m ? [m.home_team_id, m.away_team_id] : [],
      });
    }
    // Guest streak state is not transferred (the streak belongs to a favorite
    // club; the target's club and history are their own). New awards on
    // already-evaluated matches cannot retro-flip those evaluations.

    // Comments are content: they follow the author into the target account.
    run(db, "UPDATE timeline_comments SET user_id = ? WHERE user_id = ?", [target.id, guest.id]);

    // Drop the guest entirely: uncopied conflict rows, scoring rows (FK
    // targets users.id), sessions, then the row.
    run(db, "DELETE FROM favorite_teams WHERE user_id = ?", [guest.id]);
    run(db, "DELETE FROM followed_leagues WHERE user_id = ?", [guest.id]);
    run(db, "DELETE FROM crowd_ratings WHERE user_id = ?", [guest.id]);
    run(db, "DELETE FROM predictions WHERE user_id = ?", [guest.id]);
    run(db, "DELETE FROM point_ledger WHERE user_id = ?", [guest.id]);
    run(db, "DELETE FROM user_point_totals WHERE user_id = ?", [guest.id]);
    run(db, "DELETE FROM user_streaks WHERE user_id = ?", [guest.id]);
    run(db, "DELETE FROM streak_evaluations WHERE user_id = ?", [guest.id]);
    run(db, "DELETE FROM user_sessions WHERE user_id = ?", [guest.id]);
    run(db, "DELETE FROM users WHERE id = ?", [guest.id]);
  });
}

/** Merge this device's guest (if any) into `user` when the body carries the id. */
function mergeIfGuest(req: Request, user: AuthedUser): void {
  const deviceId = String(req.body?.deviceId ?? "").trim();
  if (DEVICE_ID_RE.test(deviceId)) mergeGuestIntoUser(deviceId, user);
}

// The signed-in user's profile (shared by Profile screen and header).
app.get("/api/me", requireUser, (req, res) => {
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
app.post("/api/me/display-name", requireUser, writeLimiter, (req, res) => {
  const displayName = cleanDisplayName(req.body?.displayName);
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
app.post("/api/me/language", requireUser, writeLimiter, (req, res) => {
  const language = String(req.body?.language ?? "");
  if (language !== "en" && language !== "fa") return bad(res, "BAD_LANGUAGE");
  run(db, "UPDATE users SET language = ? WHERE id = ?", [language, currentUser(req).id]);
  res.json({ ok: true, language });
});

/* ------------------------------------------------------------ my teams & leagues */

const MAX_FAVORITES = 5;
const MAX_LEAGUES = 5;

app.get("/api/me/favorites", requireUser, (req, res) => {
  const rows = all(
    db,
    `SELECT t.id, t.name, t.short_name, t.abbreviation, t.color, t.logo_url, t.league,
            f.is_favorite, f.created_at
     FROM favorite_teams f JOIN teams t ON t.id = f.team_id
     WHERE f.user_id = ?
     ORDER BY f.is_favorite DESC, f.created_at ASC`,
    [currentUser(req).id],
  );
  res.json({ favorites: rows });
});

app.post("/api/me/favorites", requireUser, (req, res) => {
  const teamId = String(req.body?.teamId ?? "");
  if (!teamId) return bad(res, "teamId required");
  const team = get<{ id: string; league: string; name: string }>(
    db,
    "SELECT id, league, name FROM teams WHERE id = ?",
    [teamId],
  );
  if (!team) return bad(res, "unknown team", 404);
  // Every side we know is followable, not just the big five. Cup-only clubs
  // (Ajax, Benfica, Celtic) and national teams carry no domestic league —
  // `league` is '' for them — and rejecting those here was what made Europe
  // unwatchable-to-follow: you could see Benfica play and not favorite them.
  // The club picker groups them instead (see GET /api/teams's `group_key`).

  const userId = currentUser(req).id;

  // Check-then-insert must be atomic: two rapid taps both read count < 5 and
  // both insert unless the caps are enforced inside one transaction. The
  // UNIQUE(user_id, team_id) constraint backs the duplicate case at the
  // storage layer; the cap check rides in the same tx.
  try {
    tx(db, () => {
      const existing = all<{ team_id: string }>(db, `SELECT team_id FROM favorite_teams WHERE user_id = ?`, [
        userId,
      ]);

      if (existing.some((e) => e.team_id === teamId)) throw new Error("ALREADY_FOLLOWING");
      if (existing.length >= MAX_FAVORITES) throw new Error("MAX_CLUBS");

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
        : msg.includes("UNIQUE")
          ? "ALREADY_FOLLOWING" // storage-level duplicate guard
          : null;
    if (code) return bad(res, code);
    throw err;
  }
  res.json({ ok: true });
});

app.delete("/api/me/favorites/:teamId", requireUser, (req, res) => {
  run(db, "DELETE FROM favorite_teams WHERE user_id = ? AND team_id = ?", [
    currentUser(req).id,
    String(req.params.teamId),
  ]);
  res.json({ ok: true });
});

/** Set (or move) the anchor club — the one shown first everywhere. */
app.put("/api/me/favorites/:teamId/anchor", requireUser, (req, res) => {
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

app.get("/api/me/leagues", requireUser, (req, res) => {
  const rows = all(
    db,
    `SELECT l.league, c.name, c.kind, l.created_at
     FROM followed_leagues l LEFT JOIN competitions c ON c.slug = l.league
     WHERE l.user_id = ? ORDER BY l.created_at ASC`,
    [currentUser(req).id],
  );
  res.json({ leagues: rows });
});

app.post("/api/me/leagues", requireUser, (req, res) => {
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

app.delete("/api/me/leagues/:league", requireUser, (req, res) => {
  run(db, "DELETE FROM followed_leagues WHERE user_id = ? AND league = ?", [
    currentUser(req).id,
    String(req.params.league),
  ]);
  res.json({ ok: true });
});

/* ------------------------------------------------------------ teams & players */

/*
 * All teams, optionally filtered by league — feeds the My Teams picker from
 * real data.
 *
 * `group_key` is the picker tab each side belongs under, and it is NOT the same
 * thing as `league`: cup-only clubs and national teams have an empty league, so
 * the client would otherwise have no bucket to show them in. Domestic clubs
 * group under their own league slug; sides that turn up in an international
 * tournament are national teams ("international"); the rest are clubs we know
 * only through cup football ("other" — Ajax, Benfica, the European long tail).
 */
app.get("/api/teams", (req, res) => {
  const league = req.query.league ? String(req.query.league) : null;
  if (league) {
    res.json({
      teams: all(
        db,
        "SELECT *, CASE WHEN league != '' THEN league ELSE 'other' END AS group_key FROM teams WHERE league = ? ORDER BY name ASC",
        [league],
      ),
    });
    return;
  }
  const placeholders = INTERNATIONALS.map(() => "?").join(", ");
  const rows = all(
    db,
    `SELECT t.*,
       CASE
         WHEN t.league != '' THEN t.league
         WHEN EXISTS (
           SELECT 1 FROM matches m
           WHERE (m.home_team_id = t.id OR m.away_team_id = t.id)
             AND m.league IN (${placeholders})
         ) THEN 'international'
         ELSE 'other'
       END AS group_key
     FROM teams t
     ORDER BY t.league ASC, t.name ASC`,
    [...INTERNATIONALS],
  );
  res.json({ teams: rows });
});

// A single team with its season stat line.
app.get("/api/teams/:id", (req, res) => {
  const teamId = String(req.params.id);
  const team = get(db, "SELECT * FROM teams WHERE id = ?", [teamId]);
  if (!team) return bad(res, "not found", 404);
  const seasonStats = get(
    db,
    `SELECT * FROM team_season_stats WHERE team_id = ? ORDER BY season DESC LIMIT 1`,
    [teamId],
  );
  // Results (latest 7) then upcoming fixtures (soonest 7). One DESC query
  // filled the list with the whole rest-of-season backlog instead of the
  // games nearest the club's next kickoff.
  const played = all(
    db,
    `SELECT m.*, th.short_name AS home_short, ta.short_name AS away_short
     FROM matches m JOIN teams th ON th.id = m.home_team_id JOIN teams ta ON ta.id = m.away_team_id
     WHERE (m.home_team_id = ? OR m.away_team_id = ?) AND m.status = 'finished'
     ORDER BY m.kickoff_at DESC LIMIT 7`,
    [teamId, teamId],
  );
  const upcoming = all(
    db,
    `SELECT m.*, th.short_name AS home_short, ta.short_name AS away_short
     FROM matches m JOIN teams th ON th.id = m.home_team_id JOIN teams ta ON ta.id = m.away_team_id
     WHERE (m.home_team_id = ? OR m.away_team_id = ?) AND m.status != 'finished'
     ORDER BY m.kickoff_at ASC LIMIT 7`,
    [teamId, teamId],
  );
  // Same flat shape the client already consumes; newest results first,
  // then upcoming in chronological order.
  const fixtures = [...played.slice().reverse(), ...upcoming];
  res.json({ team, seasonStats: seasonStats ?? null, fixtures });
});

// Season player stats per league — sortable leaderboard (the "most assists and
// goals and… everything" tables).
app.get("/api/leagues/:league/players", (req, res) => {
  const league = String(req.params.league);
  const sort = String(req.query.sort ?? "goals");
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "50"), 10) || 50));
  const sortable = new Set([
    "goals",
    "assists",
    "appearances",
    "minutes",
    "shots",
    "shots_on_target",
    "yellow_cards",
    "red_cards",
    "saves",
    "goals_conceded",
    "fouls_committed",
    "own_goals",
    "stat_score_total",
    "stat_score_avg",
  ]);
  const col = sortable.has(sort) ? sort : "goals";
  const season = getSeasonKeyDb(league);
  const rows = all(
    db,
    `SELECT s.*, p.full_name, p.short_name, p.position, p.headshot_url, p.jersey_number,
            t.name AS team_name, t.short_name AS team_short, t.color AS team_color, t.logo_url AS team_logo
     FROM player_season_stats s
     JOIN players p ON p.id = s.player_id
     JOIN teams t ON t.id = s.team_id
     WHERE s.league = ? AND s.season = ?
     ORDER BY s.${col} DESC, s.goals DESC, s.assists DESC
     LIMIT ?`,
    [league, season, limit],
  );
  res.json({ season, sort: col, players: rows });
});

// Season team stats table per league.
app.get("/api/leagues/:league/teams", (req, res) => {
  const league = String(req.params.league);
  const season = getSeasonKeyDb(league);
  const rows = all(
    db,
    `SELECT s.*, t.name, t.short_name, t.abbreviation, t.color, t.logo_url
     FROM team_season_stats s JOIN teams t ON t.id = s.team_id
     WHERE s.league = ? AND s.season = ?
     ORDER BY s.goals_for DESC`,
    [league, season],
  );
  res.json({ season, teams: rows });
});

function getSeasonKeyDb(league: string): string {
  const row = get<{ season: string }>(
    db,
    "SELECT season FROM standings WHERE league = ? ORDER BY season DESC LIMIT 1",
    [league],
  );
  if (row) return row.season;
  const now = new Date();
  const y = now.getUTCFullYear();
  const start = now.getUTCMonth() >= 7 ? y : y - 1;
  return `${start}-${String(start + 1).slice(2)}`;
}

// All players who appeared in a given match (the match stats table).
app.get("/api/matches/:id/players", (req, res) => {
  const matchId = String(req.params.id);
  const rows = all(
    db,
    `SELECT s.*, p.full_name, p.short_name, p.position, p.jersey_number, p.headshot_url,
            t.name AS team_name, t.short_name AS team_short
     FROM match_player_stats s
     JOIN players p ON p.id = s.player_id
     JOIN teams t ON t.id = s.team_id
     WHERE s.match_id = ?
     ORDER BY s.team_id, s.started DESC, s.minutes_played DESC`,
    [matchId],
  );
  res.json({ players: rows });
});

/* ------------------------------------------------------------ auth */

function matchWithTeams(id: string): unknown {
  return get(
    db,
    `SELECT m.*, 
       th.name AS home_name, th.short_name AS home_short, th.abbreviation AS home_abbr, th.color AS home_color, th.logo_url AS home_logo,
       ta.name AS away_name, ta.short_name AS away_short, ta.abbreviation AS away_abbr, ta.color AS away_color, ta.logo_url AS away_logo
     FROM matches m
     JOIN teams th ON th.id = m.home_team_id
     JOIN teams ta ON ta.id = m.away_team_id
     WHERE m.id = ?`,
    [id],
  );
}

// Public (no auth): fixtures are readable without login, keeps the web preview working.
/** All competitions: synced ones plus extra ESPN ones marked coming-soon. */
app.get("/api/competitions", (_req, res) => {
  res.json({
    competitions: [
      ...COMPETITIONS.map((c) => ({
        slug: c.slug,
        name: c.name,
        kind: c.kind,
        hasTable: !isCup(c.slug),
        comingSoon: false,
      })),
      ...EXTRA_COMPETITIONS.map((c) => ({
        slug: c.slug,
        name: c.name,
        kind: c.kind,
        hasTable: false,
        comingSoon: true,
      })),
    ],
  });
});

app.get("/api/matches", (req, res) => {
  const league = req.query.league ? String(req.query.league) : null;
  const date = req.query.date ? String(req.query.date) : null; // YYYY-MM-DD
  const params: BindValue[] = [];
  let where = "1=1";
  if (league) {
    where += " AND m.league = ?";
    params.push(league);
  }
  if (date) {
    where += " AND substr(m.kickoff_at, 1, 10) = ?";
    params.push(date);
  }
  const rows = all(
    db,
    `SELECT m.*,
       th.name AS home_name, th.short_name AS home_short, th.abbreviation AS home_abbr, th.color AS home_color, th.logo_url AS home_logo,
       ta.name AS away_name, ta.short_name AS away_short, ta.abbreviation AS away_abbr, ta.color AS away_color, ta.logo_url AS away_logo
     FROM matches m
     JOIN teams th ON th.id = m.home_team_id
     JOIN teams ta ON ta.id = m.away_team_id
     WHERE ${where}
     ORDER BY m.kickoff_at ASC
     LIMIT 300`,
    params,
  );
  res.json({ matches: rows });
});

app.get("/api/matches/:id", (req, res) => {
  const match = matchWithTeams(String(req.params.id));
  if (!match) return bad(res, "not found", 404);
  res.json({ match });
});

/* ------------------------------------------------------------ replay */

/**
 * Everything the 2D replay pitch needs in one payload: key events (with shot
 * coordinates when ESPN published them), the full commentary track, and the
 * per-side team stats (possession for the momentum legend).
 */
app.get("/api/matches/:id/replay", (req, res) => {
  const matchId = String(req.params.id);
  const match = matchWithTeams(matchId);
  if (!match) return bad(res, "not found", 404);
  const events = all(
    db,
    `SELECT e.*,
       (SELECT COUNT(*) FROM timeline_comments c WHERE c.event_id = e.id) AS comment_count
     FROM timeline_events e WHERE e.match_id = ?
     ORDER BY e.minute_seconds ASC`,
    [matchId],
  );
  const commentary = all(
    db,
    "SELECT sequence, minute_display, minute_seconds, text FROM match_commentary WHERE match_id = ? ORDER BY sequence ASC",
    [matchId],
  );
  const teamStats = all(
    db,
    "SELECT team_id, possession_pct, shots, shots_on_target, corners, fouls FROM match_team_stats WHERE match_id = ?",
    [matchId],
  );
  // Per-match expected goals (Understat). Empty for clubs outside the big
  // five or a fixture the matcher couldn't pair — the client renders "no data"
  // rather than a zero.
  const xg = all(db, "SELECT team_id, xg, xga FROM match_understat_stats WHERE match_id = ?", [matchId]);
  res.json({
    match,
    events: events.map((e: any) => ({ ...e, participants: safeArr(e.participants) })),
    commentary,
    teamStats,
    xg,
  });
});

/** Full minute-by-minute commentary for one match (blow-by-blow tab). */
app.get("/api/matches/:id/commentary", (req, res) => {
  const lines = all(
    db,
    "SELECT sequence, minute_display, minute_seconds, text FROM match_commentary WHERE match_id = ? ORDER BY sequence ASC",
    [String(req.params.id)],
  );
  res.json({ commentary: lines });
});

/** Full squad for one club, position-grouped and shirt-number ordered. */
app.get("/api/teams/:id/players", (req, res) => {
  const teamId = String(req.params.id);
  const team = get<{ league: string }>(db, "SELECT league FROM teams WHERE id = ?", [teamId]);
  if (!team) return bad(res, "not found", 404);
  const seasonRow = get<{ season: string }>(
    db,
    "SELECT season FROM player_season_stats WHERE league = ? ORDER BY season DESC LIMIT 1",
    [team.league],
  );
  const season = seasonRow?.season ?? currentSeasonLabel();
  const rows = all(
    db,
    `SELECT p.id, p.full_name, p.short_name, p.position, p.espn_position, p.jersey_number, p.headshot_url,
            s.appearances, s.goals AS season_goals, s.assists AS season_assists
     FROM players p
     LEFT JOIN player_season_stats s ON s.player_id = p.id AND s.league = ? AND s.season = ?
     WHERE p.team_id = ? AND p.active = 1
     ORDER BY CASE p.position WHEN 'GK' THEN 0 WHEN 'DEF' THEN 1 WHEN 'MID' THEN 2 ELSE 3 END,
              p.jersey_number ASC, p.full_name ASC`,
    [team.league, season, teamId],
  );
  const coach = get<{ name: string }>(db, "SELECT name FROM team_coaches WHERE team_id = ?", [teamId]);
  res.json({ season, players: rows, coach: coach?.name ?? null });
});

/** Understat xG/xA data for a team (season-aggregated). */
app.get("/api/teams/:id/understat", requireUser, (req, res) => {
  const teamId = String(req.params.id);
  const season = Number(req.query.season ?? 2026);

  const players = all(
    db,
    `SELECT p.id, p.full_name AS name, p.position, p.jersey_number AS jersey, p.headshot_url AS headshot,
           u.xg, u.xa, u.xg90, u.xa90, u.sh90, u.kp90,
           u.apps, u.minutes, u.goals, u.assists
    FROM player_understat_stats u
    JOIN players p ON p.id = u.player_id
    WHERE u.team_id = ? AND u.season = ?
    ORDER BY u.xg DESC`,
    [teamId, season],
  );

  const teamStats = get(
    db,
    `SELECT xg, xga, xpts, ppda, deep FROM team_understat_stats
     WHERE team_id = ? AND season = ?`,
    [teamId, season],
  );

  const situations = all(
    db,
    `SELECT situation, shots, goals, shots_against, goals_against, xg, xga
    FROM team_shot_situations WHERE team_id = ? AND season = ?
    ORDER BY xg DESC`,
    [teamId, season],
  );

  res.json({ players, teamStats, situations });
});

app.get("/api/matches/:id/lineups", (req, res) => {
  const matchId = String(req.params.id);
  const match = get<{
    home_team_id: string;
    away_team_id: string;
    home_formation: string | null;
    away_formation: string | null;
    status: string;
  }>(
    db,
    "SELECT home_team_id, away_team_id, home_formation, away_formation, status FROM matches WHERE id = ?",
    [matchId],
  );
  if (!match) return bad(res, "not found", 404);
  const rows = all(
    db,
    `SELECT s.*, p.full_name, p.short_name, p.position, p.jersey_number, p.headshot_url,
            p.espn_position
     FROM match_player_stats s JOIN players p ON p.id = s.player_id
     WHERE s.match_id = ?
     ORDER BY s.started DESC, s.minutes_played DESC, p.jersey_number ASC`,
    [matchId],
  );
  res.json({
    home: { formation: match.home_formation },
    away: { formation: match.away_formation },
    players: rows,
  });
});

/* ------------------------------------------------------------ standings */

app.get("/api/standings/:league", (req, res) => {
  const league = String(req.params.league);
  // Cup competitions have no league table (knockout brackets are a later
  // feature) — an explicit error beats an empty table.
  if (isCup(league)) return bad(res, "NO_TABLE_FOR_CUP", 404);
  const season = req.query.season ? String(req.query.season) : latestSeason(league);
  // xPts heads the expected-points view, so it rides along with the table
  // itself rather than costing a request per club. Left join: only the clubs
  // Understat actually covers have a row, and the client renders the rest as
  // "no data" (never an error) — the scraper never sees cups or the long tail.
  const rows = all(
    db,
    `SELECT s.*, t.name, t.short_name, t.abbreviation, t.color, t.logo_url,
            u.xpts AS xpts, u.xg AS xg, u.xga AS xga
     FROM standings s JOIN teams t ON t.id = s.team_id
     LEFT JOIN team_understat_stats u
       ON u.team_id = s.team_id
      AND u.league = s.league
      AND u.season = (SELECT MAX(season) FROM team_understat_stats WHERE team_id = s.team_id)
     WHERE s.league = ? AND s.season = ?
     ORDER BY s.rank ASC`,
    [league, season],
  );
  // Form rides along with the table for the same reason xPts does: it is a
  // per-row attribute of a table the client already asks for. Folded from our
  // own finished matches, so it stays right even for clubs the xG scraper
  // doesn't reach.
  const formRows = all(
    db,
    `SELECT home_team_id, away_team_id, home_score, away_score
     FROM matches
     WHERE league = ? AND status = 'finished'
       AND home_score IS NOT NULL AND away_score IS NOT NULL
     ORDER BY kickoff_at DESC`,
    [league],
  ) as FormMatchRow[];
  const form = foldForm(formRows);
  res.json({
    season,
    standings: rows.map((row) => ({
      ...row,
      form: form[(row as { team_id: string }).team_id] ?? null,
    })),
  });
});

function latestSeason(league: string): string {
  const row = get<{ season: string }>(
    db,
    "SELECT season FROM standings WHERE league = ? ORDER BY season DESC LIMIT 1",
    [league],
  );
  return row?.season ?? currentSeasonLabel();
}

/* ------------------------------------------------------------ ratings */

const MIN_VOTES_TO_SHOW = 3;
/** The 3-card rule: each user rates exactly 3 players of their choice per match. */
const MAX_RATINGS_PER_MATCH = 3;

app.get("/api/matches/:id/ratings", requireUser, (req, res) => {
  const matchId = String(req.params.id);
  const userId = currentUser(req).id;
  const rows = all(
    db,
    `SELECT s.player_id, p.full_name AS name, p.short_name, s.team_id, p.position,
            s.stat_score, s.stat_breakdown, s.started, s.minutes_played,
            AVG(r.rating) AS avg_rating, COUNT(r.rating) AS votes,
            (SELECT rating FROM crowd_ratings WHERE user_id = ? AND player_id = s.player_id AND match_id = s.match_id) AS my_rating,
            (SELECT comment FROM crowd_ratings WHERE user_id = ? AND player_id = s.player_id AND match_id = s.match_id) AS my_comment,
            (SELECT c.text FROM crowd_ratings rc JOIN users c ON c.id = rc.user_id
              WHERE rc.player_id = s.player_id AND rc.match_id = s.match_id AND rc.comment IS NOT NULL
              ORDER BY rc.created_at DESC LIMIT 1) AS latest_comment
     FROM match_player_stats s
     JOIN players p ON p.id = s.player_id
     LEFT JOIN crowd_ratings r ON r.player_id = s.player_id AND r.match_id = s.match_id
     WHERE s.match_id = ? AND s.minutes_played > 0
     GROUP BY s.player_id
     ORDER BY s.team_id, s.started DESC, s.minutes_played DESC`,
    [userId, userId, matchId],
  );
  const withRatings = rows.map((r: any) => ({
    ...r,
    crowd_rating: r.votes >= MIN_VOTES_TO_SHOW ? Math.round(r.avg_rating * 10) / 10 : null,
  }));
  const used = get<{ n: number }>(
    db,
    "SELECT COUNT(*) AS n FROM crowd_ratings WHERE user_id = ? AND match_id = ?",
    [userId, matchId],
  );
  res.json({
    players: withRatings,
    minVotes: MIN_VOTES_TO_SHOW,
    cardsUsed: used?.n ?? 0,
    cardsMax: MAX_RATINGS_PER_MATCH,
  });
});

app.post("/api/matches/:id/ratings", requireUser, (req, res) => {
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

/* ------------------------------------------------------------ timeline */

app.get("/api/matches/:id/timeline", (req, res) => {
  const matchId = String(req.params.id);
  const events = all(
    db,
    `SELECT e.*,
       (SELECT COUNT(*) FROM timeline_comments c WHERE c.event_id = e.id) AS comment_count
     FROM timeline_events e WHERE e.match_id = ?
     ORDER BY e.minute_seconds ASC`,
    [matchId],
  );
  res.json({ events: events.map((e: any) => ({ ...e, participants: safeArr(e.participants) })) });
});

app.get("/api/matches/:id/comments", requireUser, (req, res) => {
  const matchId = String(req.params.id);
  const rows = all(
    db,
    `SELECT c.*, u.display_name AS author
     FROM timeline_comments c JOIN users u ON u.id = c.user_id
     WHERE c.match_id = ? ORDER BY c.minute_seconds ASC, c.created_at ASC`,
    [matchId],
  );
  res.json({ comments: rows });
});

app.post("/api/matches/:id/comments", requireUser, (req, res) => {
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

function safeArr(s: unknown): unknown[] {
  if (typeof s !== "string") return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------ predictions */

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

app.get("/api/matches/:id/predictions", requireUser, (req, res) => {
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

app.post("/api/matches/:id/predictions", requireUser, writeLimiter, (req, res) => {
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

app.get("/api/me/predictions", requireUser, (req, res) => {
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
app.get("/api/me/streak", requireUser, (req, res) => {
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

app.get("/api/me/notification-prefs", requireUser, (req, res) => {
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

app.put("/api/me/notification-prefs", requireUser, writeLimiter, (req, res) => {
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

/* ------------------------------------------------------------ leaderboards */

/*
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

const LEADERBOARD_LIMIT = 100;

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

app.get("/api/leaderboards/global", (req, res) => {
  const viewerId = optionalViewerId(req);
  res.json({
    board: readLeaderboard(db, "global", currentSeasonLabel(), LEADERBOARD_LIMIT, viewerId).map((r) => ({
      rank: r.rank,
      display_name: r.display_name,
      username: r.username,
      is_you: r.is_you,
      total: r.total,
      last_award: r.reached_total_at,
    })),
  });
});

app.get("/api/leaderboards/league/:league", (req, res) => {
  const viewerId = optionalViewerId(req);
  res.json({
    board: readLeaderboard(
      db,
      `league:${String(req.params.league)}`,
      currentSeasonLabel(),
      LEADERBOARD_LIMIT,
      viewerId,
    ).map((r) => ({
      rank: r.rank,
      display_name: r.display_name,
      username: r.username,
      is_you: r.is_you,
      total: r.total,
      last_award: r.reached_total_at,
    })),
  });
});

app.get("/api/leaderboards/club/:teamId", (req, res) => {
  const viewerId = optionalViewerId(req);
  res.json({
    board: readLeaderboard(
      db,
      `club:${String(req.params.teamId)}`,
      currentSeasonLabel(),
      LEADERBOARD_LIMIT,
      viewerId,
    ).map((r) => ({
      rank: r.rank,
      display_name: r.display_name,
      username: r.username,
      is_you: r.is_you,
      total: r.total,
      last_award: r.reached_total_at,
    })),
  });
});

/* ------------------------------------------------------------ admin */

app.post("/api/admin/sync", requireUser, (req, res) => {
  if (!isAdmin(req)) return bad(res, "admin only", 403);
  void syncScoreboards().then(() => res.json({ ok: true }));
});

/** Manually pull a fixture window (days back/forward) — backfills future fixtures. */
app.post("/api/admin/sync-window", requireUser, (req, res) => {
  if (!isAdmin(req)) return bad(res, "admin only", 403);
  const back = Math.min(7, Math.max(0, Number(req.body?.back ?? 0)));
  const fwd = Math.min(14, Math.max(1, Number(req.body?.forward ?? 7)));
  void syncScoreboardWindow(back, fwd)
    .then(() => res.json({ ok: true }))
    .catch((err) => bad(res, `sync failed: ${String(err).slice(0, 120)}`, 500));
});

app.post("/api/admin/notify", requireUser, (req, res) => {
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

/* ------------------------------------------------------------ errors */

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[api] unhandled:", err);
  if (!res.headersSent) bad(res, "internal error", 500);
});

const PORT = parseInt(process.env.PORT ?? "8787", 10);

const server = app.listen(PORT, () => {
  // Print what was actually bound, not what we asked for: an unbound or
  // IPv6-only listener looks identical from the outside until something tries
  // to connect, and "listening" alone has already cost a debugging session.
  const addr = server.address();
  const bound = typeof addr === "object" && addr ? `${addr.address}:${addr.port}` : String(PORT);
  console.log(`[api] listening on http://${bound}`);
  console.log(`[api] reachable at http://localhost:${PORT} and http://127.0.0.1:${PORT}`);
  if (!botToken()) console.warn("[api] TELEGRAM_BOT_TOKEN not set — Telegram auth disabled");
  const pruned = pruneSessions();
  if (pruned > 0) console.log(`[api] pruned ${pruned} expired session(s)`);
  if (process.env.SKIP_CRON === "1") {
    console.log("[api] SKIP_CRON=1 — sync/resolver cron loops disabled (dev fixtures stay put)");
  } else {
    startSyncLoop();
    startResolverLoop();
    startBot(botToken());
  }
});

// A bind failure (port taken) is otherwise an unhandled 'error' event.
server.on("error", (err) => {
  console.error("[api] listen failed:", String(err));
  process.exit(1);
});

// Sweep expired sessions daily; stop accepting new work on SIGINT/SIGTERM.
setInterval(() => {
  const n = pruneSessions();
  if (n > 0) console.log(`[api] pruned ${n} expired session(s)`);
}, 24 * 3_600_000).unref();

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.once(sig, () => {
    console.log(`[api] ${sig} — closing server`);
    // Drop keep-alives first: `close()` alone waits for them, and the vite
    // proxy holds some open, which used to leave a process alive with a closed
    // listener — the API looked started and answered nothing.
    server.closeAllConnections?.();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3_000);
  });
}
