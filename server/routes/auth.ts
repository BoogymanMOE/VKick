/**
 * Auth routes: Telegram initData login, silent guest entry, username
 * register/login/logout, and the guest-merge upgrade path. Behavior is
 * unchanged from the pre-split server/index.ts.
 */
import express, { type Request } from "express";
import crypto from "node:crypto";
import { getDb, all, get, run, tx } from "../db/index.js";
import { TEAM_GROUP_SQL, TEAM_GROUP_PARAMS, favoriteCapError } from "../db/teamGroups.js";
import { hashPassword, passwordValid, verifyPassword } from "../auth/password.js";
import { authLimiter, credentialLimiter } from "../auth/rateLimit.js";
import { verifyInitData } from "../telegram/verify.js";
import { award } from "../scoring/ledger.js";
import {
  bad,
  botToken,
  cleanDisplayName,
  issueSession,
  requireUser,
  upsertUser,
  DEVICE_ID_RE,
  MAX_LEAGUES,
  type AuthedUser,
} from "./shared.js";

const db = getDb();

export const authRouter = express.Router();

const USERNAME_RE = /^[a-zA-Z0-9_.]{3,24}$/;

/* ---------------------------------------------------------------------------
 * Auth probe — logs every guest attempt so Telegram login failures are
 * visible in production Render logs. Logs initData KEY NAMES and booleans
 * only — never the initData string, never the hash, never the signature
 * value, never the bot token. Field names are not secrets and are what
 * actually matter here: whether the client sent `signature` decides which
 * check-string algorithm is correct.
 */
function authProbeGuest(
  initData: string,
  verified: { ok: true } | { ok: false; reason: string } | null,
  outcome: "telegram" | "guest",
): void {
  // Always log: the user needs to see why Telegram login fails in the Render logs.
  const keys = initData ? [...new URLSearchParams(initData).keys()].sort().join(",") : "";
  const hasSignature = initData ? new URLSearchParams(initData).has("signature") : false;
  const verdict = !initData
    ? "no-initData"
    : !botToken()
      ? "no-bot-token"
      : !verified
        ? "no-verdict"
        : verified.ok
          ? "pass"
          : `fail(${verified.reason})`;
  console.log(
    `[auth:guest] initData=${initData ? "yes" : "no"} verify=${verdict} ` +
      `signature=${hasSignature ? "yes" : "no"} outcome=${outcome} keys=[${keys}]`,
  );
}

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

// Client posts the Telegram initData here to exchange it for... itself.
// We validate and return the profile; the initData string itself is the
// bearer token for subsequent calls.
authRouter.post("/api/auth/login", authLimiter, credentialLimiter, (req, res) => {
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
      return bad(res, "BAD_USERNAME");
    }
    const user = findUserByUsername(username);
    const stored = user
      ? (get<{ password_hash: string | null }>(
          db,
          "SELECT password_hash FROM user_credentials WHERE user_id = ?",
          [user.id],
        )?.password_hash ?? null)
      : null;
    // A missing stored hash verifies against the dummy hash (fails, but burns
    // the same scrypt cost so response time doesn't oracle account existence).
    const ok = verifyPassword(req.body?.password, stored ?? DUMMY_PASSWORD_HASH);
    if (!user || !stored || !ok) {
      return bad(res, "INVALID_CREDENTIALS", 401);
    }
    const token = issueSession(user.id);
    return res.json({ ok: true, mode: "session", token, user: publicUser(user) });
  }

  // Telegram path: the initData IS the credential; verified inline.
  const verified = initData && botToken() ? verifyInitData(initData, botToken()) : null;
  if (!verified?.ok) {
    return bad(res, verified && !verified.ok ? verified.reason : "no bot token", 401);
  }
  const tg = verified.user;
  const displayName =
    [tg.first_name, tg.last_name].filter(Boolean).join(" ") || tg.username || `User ${tg.id}`;
  const user = upsertUser(String(tg.id), displayName);
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
authRouter.post("/api/auth/guest", authLimiter, (req, res) => {
  const deviceId = String(req.body?.deviceId ?? "").trim();
  if (!DEVICE_ID_RE.test(deviceId)) return bad(res, "BAD_DEVICE_ID");

  const initData = String(req.body?.initData ?? "");
  const verified = initData && botToken() ? verifyInitData(initData, botToken()) : null;

  // Log why initData verification failed (when initData was sent but didn't verify).
  // This is the key diagnostic for "why am I a guest inside Telegram" — without it
  // we only see successful telegram logins and guest logins with no initData, never
  // the middle case where the client sent initData but the server rejected it.
  // Always log: the user needs to see the exact failure reason in Render logs.
  if (initData && !verified?.ok) {
    console.log(
      `[auth:guest] initData VERIFICATION FAILED reason=${verified?.reason ?? "unknown"} ` +
        `botToken=${botToken() ? "set" : "MISSING"} keys=[${[...new URLSearchParams(initData).keys()].sort().join(",")}]`,
    );
  }

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
    authProbeGuest(initData, verified, "telegram"); // TEMP AUTH PROBE
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
  authProbeGuest(initData, verified, "guest"); // TEMP AUTH PROBE
  res.json({ ok: true, mode: "session", token, user: publicUser(user) });
});

/** Register a username account (username + password). Logs the new user straight in. */
authRouter.post("/api/auth/register", authLimiter, credentialLimiter, (req, res) => {
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
authRouter.post("/api/auth/logout", requireUser, (req, res) => {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (token.startsWith("mg_")) {
    run(db, "DELETE FROM user_sessions WHERE token = ?", [token]);
  }
  res.json({ ok: true });
});

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
 *  - referral_codes / referral_redemptions: MOVED to the target (see below).
 *  - leftovers die with the guest row (cascade-free tables deleted first).
 */
function mergeGuestIntoUser(deviceId: string, target: AuthedUser): void {
  const guest = get<{ id: number }>(db, "SELECT id FROM users WHERE telegram_id = ?", [
    `guest:${deviceId.toLowerCase()}`,
  ]);
  if (!guest || guest.id === target.id) return;

  tx(db, () => {
    // Favorites: respect the per-bucket caps while copying (the POST
    // /favorites rules) — five clubs and, separately, five international
    // sides, so a full club shelf doesn't orphan a guest's national team.
    const targetFavs = all<{ team_id: string; is_favorite: number; group_key: string }>(
      db,
      `SELECT f.team_id AS team_id, f.is_favorite, ${TEAM_GROUP_SQL} AS group_key
       FROM favorite_teams f JOIN teams t ON t.id = f.team_id
       WHERE f.user_id = ?`,
      [...TEAM_GROUP_PARAMS, target.id],
    );
    const guestFavs = all<{ team_id: string; is_favorite: number; group_key: string }>(
      db,
      `SELECT f.team_id AS team_id, f.is_favorite, ${TEAM_GROUP_SQL} AS group_key
       FROM favorite_teams f JOIN teams t ON t.id = f.team_id
       WHERE f.user_id = ?`,
      [...TEAM_GROUP_PARAMS, guest.id],
    );
    for (const f of guestFavs) {
      if (targetFavs.some((e) => e.team_id === f.team_id)) continue;
      // continue (not break): one full bucket must not block picks for the
      // other — same rule the POST endpoint enforces per tap.
      if (
        favoriteCapError(
          targetFavs.map((e) => e.group_key),
          f.group_key,
        )
      )
        continue;
      run(
        db,
        "INSERT OR IGNORE INTO favorite_teams (user_id, team_id, is_favorite, created_at) VALUES (?, ?, ?, ?)",
        [target.id, f.team_id, 0, new Date().toISOString()],
      );
      targetFavs.push({ team_id: f.team_id, is_favorite: 0, group_key: f.group_key });
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

    // Referral graph: BOTH tables reference users(id) with no ON DELETE
    // CASCADE, so these rows must move or go before the guest row is
    // deleted — leaving them behind is an FK violation that aborts the
    // whole merge. It is not an edge case: GET /api/me/referral mints the
    // guest's code lazily, so anyone who ever opened the Invite tab has
    // one, and their next upgrade attempt failed. Because tx() rolled the
    // merge back the guest row survived, so every retry threw again and
    // the account could never leave the guest profile.
    //
    // The invitee's redemption MOVES rather than being deleted: "one
    // redemption per account, ever" has to survive the upgrade, or the
    // same person redeems a second code as their new self. The target's
    // own redemption wins when it already has one (the invitee UNIQUE
    // would refuse the move). People the guest referred move with them —
    // the same human earned those connections — and the guest's code
    // moves too, so an invite link they already shared keeps resolving.
    const targetRedeemed = get<{ n: number }>(
      db,
      "SELECT COUNT(*) AS n FROM referral_redemptions WHERE invitee_user_id = ?",
      [target.id],
    );
    if ((targetRedeemed?.n ?? 0) > 0) {
      run(db, "DELETE FROM referral_redemptions WHERE invitee_user_id = ?", [guest.id]);
    } else {
      run(db, "UPDATE referral_redemptions SET invitee_user_id = ? WHERE invitee_user_id = ?", [
        target.id,
        guest.id,
      ]);
    }
    run(db, "UPDATE referral_redemptions SET referrer_user_id = ? WHERE referrer_user_id = ?", [
      target.id,
      guest.id,
    ]);
    const targetCode = get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM referral_codes WHERE user_id = ?", [
      target.id,
    ]);
    if ((targetCode?.n ?? 0) > 0) {
      run(db, "DELETE FROM referral_codes WHERE user_id = ?", [guest.id]);
    } else {
      run(db, "UPDATE referral_codes SET user_id = ? WHERE user_id = ?", [target.id, guest.id]);
    }

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

export { publicUser };
