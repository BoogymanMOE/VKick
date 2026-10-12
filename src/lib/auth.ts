/**
 * Bearer token for the app's own API, with remember-me semantics.
 *
 * Two client-side token slots:
 *  - persistent  (localStorage, `matchday.session`)  — set when "Remember me"
 *    is ticked at login; survives closing the browser.
 *  - ephemeral   (sessionStorage, `matchday.session.session`) — set when it
 *    isn't; dies with the tab, so shared machines are safe by default.
 *
 * Priority: persistent > ephemeral > Telegram initData > dev fallback. Sessions
 * are the only revocable family; initData/dev tokens keep working as before so
 * the existing Telegram entry path is untouched. An explicit sign-out sets a
 * persistent flag (localStorage — it must survive tab close/reload, otherwise
 * the silent entry would sign the user straight back in) that suppresses the
 * fallbacks; the next explicit Enter clears it.
 */

import { capturedTelegramInitData } from "./telegramUrl";

const KEY = "matchday.session";
const EPHEMERAL_KEY = "matchday.session.session";
const LOGGED_OUT_KEY = "matchday.loggedOut";
const DEVICE_KEY = "matchday.deviceId";

/**
 * Stable per-device id for silent guest entry: generated once, kept in
 * localStorage forever (even across sign-out, so the same device returns to
 * the same guest account). Used as the credential for /api/auth/guest.
 */
export function getDeviceId(): string {
  let id = safeGet(localStorage, DEVICE_KEY);
  if (!id) {
    id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID().replace(/-/g, "")
        : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    safeSet(localStorage, DEVICE_KEY, id);
  }
  return id;
}

function safeGet(store: Storage, key: string): string | null {
  try {
    return store.getItem(key);
  } catch {
    return null; // private mode / quota
  }
}

function safeSet(store: Storage, key: string, value: string | null): void {
  try {
    if (value === null) store.removeItem(key);
    else store.setItem(key, value);
  } catch {
    /* private mode / quota */
  }
}

/** Remembered token (localStorage slot), if any. */
export function getPersistentToken(): string | null {
  return safeGet(localStorage, KEY);
}

/** This-tab-only token (sessionStorage slot), if any. */
export function getEphemeralToken(): string | null {
  return safeGet(sessionStorage, EPHEMERAL_KEY);
}

/**
 * Store a login session. `remember` decides the slot: localStorage survives
 * restarts, sessionStorage dies with the tab.
 */
export function setSessionToken(token: string, remember: boolean): void {
  if (remember) {
    safeSet(localStorage, KEY, token);
    safeSet(sessionStorage, EPHEMERAL_KEY, null);
  } else {
    safeSet(sessionStorage, EPHEMERAL_KEY, token);
    safeSet(localStorage, KEY, null);
  }
}

export function isSessionToken(token: string | null): boolean {
  return Boolean(token && token.startsWith("mg_"));
}

/** Any stored session, remembered or this-tab-only. */
export function getSessionToken(): string | null {
  return getPersistentToken() ?? getEphemeralToken();
}

/** True when the stored session will survive a browser restart. */
export function isRemembered(): boolean {
  return isSessionToken(getPersistentToken());
}

/**
 * Set after an explicit sign-out: suppresses silent entry and the initData/dev
 * fallbacks so the user actually lands on the entry screen instead of being
 * silently re-authed. Lives in localStorage — a sessionStorage flag died with
 * the tab, and reopening the app then silently signed the user back in, which
 * made sign-out feel impossible. Cleared by the next explicit Enter.
 */
export function markLoggedOut(): void {
  safeSet(localStorage, LOGGED_OUT_KEY, "1");
}

export function isLoggedOut(): boolean {
  return safeGet(localStorage, LOGGED_OUT_KEY) === "1";
}

function clearLoggedOut(): void {
  safeSet(localStorage, LOGGED_OUT_KEY, null);
}

/**
 * The Telegram initData, when the app actually runs inside Telegram.
 *
 * Prefers the SDK's parsed value; falls back to the init data recovered from
 * the launch URL (see lib/telegramUrl) so a Telegram user is still themselves
 * when telegram.org is unreachable and the SDK script never loads — which is
 * exactly the network this app ships to.
 *
 * Debug: log the full picture (SDK global, SDK initData, URL-captured value)
 * so the Telegram auth bug can be traced in the browser console.
 */
export function telegramInitData(): string | null {
  const tg = window.Telegram?.WebApp;
  const sdkInitData = typeof tg?.initData === "string" && tg.initData ? tg.initData : undefined;
  const captured = capturedTelegramInitData();
  console.log("[auth] telegramInitData check:", {
    hasWebApp: !!tg,
    sdkInitData: sdkInitData ?? null,
    captured,
  });
  if (sdkInitData) return sdkInitData;
  return captured;
}

/**
 * Resolve the token for an API call. A stored session always wins so the Login
 * screen result persists even inside Telegram (logout must actually log out).
 * After an explicit sign-out this returns "" — every call 401s and the guard
 * keeps the user on the Login screen.
 *
 * The `dev:<id>` escape hatch is a development convenience only. In production
 * it falls back to `null`, so RequireAuth redirects to /login instead of
 * stalling on a blank screen waiting for a token the server will 401.
 */
export function currentAuthToken(): string | null {
  const session = getSessionToken();
  if (isSessionToken(session)) return session as string;
  if (isLoggedOut()) return "";

  const initData = telegramInitData();
  if (initData) return initData;

  if (typeof process !== "undefined" && process.env?.NODE_ENV === "production") {
    return null;
  }

  const dev = new URLSearchParams(window.location.search).get("devUser");
  return dev ? `dev:${dev}` : `dev:1`;
}

/**
 * True when the URL explicitly asks to be a particular user (`?devUser=<id>`).
 *
 * Auto-entry has to stand down in that case. It exchanges the device id for a
 * `mg_` session, and a stored session outranks every other token family — so
 * without this guard the freshly minted guest account replaced the dev
 * identity on its first request and `?devUser=` did nothing at all, despite
 * being the documented way to preview another account.
 */
export function hasExplicitDevUser(): boolean {
  try {
    return new URLSearchParams(window.location.search).has("devUser");
  } catch {
    return false;
  }
}

/** Clear every client-side credential (remembered + tab + sign-out flag). */
export function clearSession(): void {
  setSessionToken("", false);
  safeSet(localStorage, KEY, null);
  safeSet(sessionStorage, EPHEMERAL_KEY, null);
  markLoggedOut();
}

/** Called on any successful login: forget a previous sign-out. */
export function markSignedIn(): void {
  clearLoggedOut();
}
