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

/** The Telegram initData, when the app actually runs inside Telegram. */
export function telegramInitData(): string | null {
  const tg = (window as any).Telegram?.WebApp;
  return typeof tg?.initData === "string" && tg.initData ? tg.initData : null;
}

/**
 * Resolve the token for an API call. A stored session always wins so the Login
 * screen result persists even inside Telegram (logout must actually log out).
 * After an explicit sign-out this returns "" — every call 401s and the guard
 * keeps the user on the Login screen.
 */
export function currentAuthToken(): string {
  const session = getSessionToken();
  if (isSessionToken(session)) return session as string;
  if (isLoggedOut()) return "";

  const initData = telegramInitData();
  if (initData) return initData;

  const dev = new URLSearchParams(window.location.search).get("devUser");
  return dev ? `dev:${dev}` : "dev:1";
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
