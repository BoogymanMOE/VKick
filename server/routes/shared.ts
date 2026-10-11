/**
 * Route-module shared plumbing: the auth gate, the identity helpers and the
 * tiny response helpers every route module uses. Split out of the old
 * monolithic server/index.ts — behavior unchanged.
 */
import type { Request, Response, NextFunction } from "express";
import { getDb, get, run } from "../db/index.js";
import { SESSION_TTL_MS } from "../db/retention.js";
import { verifyInitData, verifyDevToken, type TelegramUser } from "../telegram/verify.js";
import { newSessionToken } from "../auth/session.js";

const db = getDb();

/* ------------------------------------------------------------ env reads */

export function botToken(): string {
  return process.env.TELEGRAM_BOT_TOKEN ?? "";
}

export function devSecret(): string | undefined {
  const s = process.env.DEV_AUTH_SECRET;
  return s && s.trim() ? s.trim() : undefined;
}

/* ------------------------------------------------------------ identity */

export interface AuthedUser {
  id: number;
  telegram_id: string;
  display_name: string;
}

export type AuthMode = "session" | "telegram" | "dev";

/**
 * `requireUser` attaches these before any handler runs. Declaring them on
 * Express's own Request interface (rather than casting through `any` at every
 * use) gives every route module a typed `req.user` / `req.authMode`, and makes
 * reading them before the gate runs a compile error instead of a silent
 * `undefined`.
 */
declare module "express-serve-static-core" {
  interface Request {
    user?: AuthedUser;
    authMode?: AuthMode;
  }
}

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
export function requireUser(req: Request, res: Response, next: NextFunction): void {
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
    req.user = { id: row.id, telegram_id: row.telegram_id, display_name: row.display_name };
    req.authMode = "session";
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
    // Always log initData verification failures so the exact reason is visible
    // in server logs, even when the caller falls through to the dev token path.
    console.log(
      `[auth:requireUser] initData VERIFICATION FAILED reason=${real.reason ?? "unknown"} ` +
        `botToken=${botToken() ? "set" : "MISSING"}`,
    );
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
  req.user = user;
  req.authMode = mode;
  next();
}

export function currentUser(req: Request): AuthedUser {
  // Set by requireUser, which every route using this reads behind.
  return req.user as AuthedUser;
}

export function isAdmin(req: Request): boolean {
  const ids = (process.env.ADMIN_TELEGRAM_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (ids.length === 0) return false;
  return ids.includes(currentUser(req).telegram_id);
}

/**
 * The caller's user id when a valid token is present, else undefined — the
 * non-failing sibling of `requireUser`, for endpoints that accept anonymous
 * callers but want to attach an identity when they have one (client-errors,
 * leaderboards). All verification is the same; a bad or absent token simply
 * yields undefined instead of a 401.
 */
export function optionalUserId(req: Request): number | undefined {
  try {
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) return undefined;
    if (token.startsWith("mg_")) {
      const row = get<{ user_id: number; last_used_at: string }>(
        db,
        "SELECT user_id, last_used_at FROM user_sessions WHERE token = ?",
        [token],
      );
      if (!row) return undefined;
      if (Date.now() - new Date(row.last_used_at).getTime() > SESSION_TTL_MS) return undefined;
      return row.user_id;
    }
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
    /* anonymous */
  }
  return undefined;
}

/** Create a session row and return its bearer token (mg_ prefix). */
export function issueSession(userId: number): string {
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

export function upsertUser(telegramId: string, displayName: string): AuthedUser {
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

/** Display names: collapse runs of whitespace, cap at the client's 40 chars. */
export function cleanDisplayName(raw: unknown): string {
  return String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
}

/** Machine-readable error body — the client maps these codes to i18n keys. */
export function bad(res: Response, message: string, code = 400): void {
  res.status(code).json({ error: message });
}

/** The device-id shape /api/auth/guest accepts (and mergeIfGuest re-checks). */
export const DEVICE_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

/** Followed-league cap, shared by the leagues endpoints and the guest merge. */
export const MAX_LEAGUES = 5;
