/**
 * Telegram Mini App URL normalisation.
 *
 * Telegram hands the Mini App its init data by appending it to the launch URL:
 *   https://app/#tgWebAppData=...&tgWebAppVersion=7.0&tgWebAppPlatform=android
 * Older/newer clients differ on WHERE they put it (hash is canonical, but some
 * builds use the query string, and some mangle it straight after the path:
 * `https://app/tgWebAppData=...`).
 *
 * Both shapes break the app:
 *  - the HASH one is fatal: HashRouter reads the whole fragment as the route, so
 *    `tgWebAppData=...` becomes an unknown path and renders the 404 screen.
 *  - the PATH one is fatal server-side: the SPA fallback treats a path with a
 *    dot (e.g. `tgWebAppVersion=7.0`) as a missing file and 404s before the
 *    bundle ever loads.
 *
 * So before React Router is created we lift any `tgWebApp*` params out of the
 * URL (keeping the init data for auth) and rewrite it to a clean `/` (or `#`).
 *
 * ORDERING IS LOAD-BEARING: this must run only AFTER the Telegram SDK has
 * parsed the URL (`tg-sdk-settled`), otherwise we would strip the data before
 * telegram-web-app.js reads it. main.tsx calls it at the top of mount().
 */

/** Every Telegram init param starts with this. */
const TG_PARAM_PREFIX = "tgWebApp";
/** The one param auth actually needs. */
const INIT_DATA_KEY = "tgWebAppData";

export interface NormalizedTelegramUrl {
  /** The URL with any Telegram init params removed. */
  url: string;
  /** SDK-parsed init data when present, else the value recovered from the URL. */
  initData: string | null;
  /** True when Telegram params were present and the URL was rewritten. */
  changed: boolean;
}

/**
 * Pure URL rewrite. `sdkInitData` (from `window.Telegram.WebApp.initData`) wins
 * when non-empty because the SDK is the authoritative parser; otherwise the
 * value is recovered from the URL so auth still works when the SDK script was
 * blocked (e.g. telegram.org unreachable) but Telegram still passed the data.
 */
export function normalizeTelegramUrl(href: string, sdkInitData = ""): NormalizedTelegramUrl {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return { url: href, initData: sdkInitData || null, changed: false };
  }

  let recovered: string | null = null;
  let changed = false;

  // 1) Hash — Telegram's canonical carrier. The whole fragment is Telegram's
  //    params, so drop it entirely; HashRouter then sees "/". Trigger on ANY
  //    `tgWebApp*` key, not just init data, so a launch that only carries
  //    `tgWebAppStartParam` still cannot masquerade as a route.
  const hash = url.hash.replace(/^#/, "");
  if (hash.includes(TG_PARAM_PREFIX)) {
    recovered = new URLSearchParams(hash).get(INIT_DATA_KEY) ?? recovered;
    url.hash = "";
    changed = true;
  }

  // 2) Query string — some clients append `?tgWebAppData=...` instead. Drop
  //    only the Telegram keys so unrelated params (e.g. ?devUser=) survive.
  const searchKeys = [...url.searchParams.keys()];
  if (searchKeys.some((key) => key.startsWith(TG_PARAM_PREFIX))) {
    recovered = recovered ?? url.searchParams.get(INIT_DATA_KEY);
    for (const key of searchKeys) {
      if (key.startsWith(TG_PARAM_PREFIX)) url.searchParams.delete(key);
    }
    changed = true;
  }

  // 3) Path — the mangled form `/<params>` with no `?`. Parse the leading
  //    segment as a query string and reset the path to the app root.
  if (url.pathname.includes(TG_PARAM_PREFIX)) {
    recovered = recovered ?? new URLSearchParams(url.pathname.replace(/^\/+/, "")).get(INIT_DATA_KEY);
    url.pathname = "/";
    changed = true;
  }

  return { url: url.toString(), initData: sdkInitData || recovered, changed };
}

/** The URL-recovered init data, kept so auth survives a blocked SDK script. */
let capturedInitData: string | null = null;

/**
 * Rewrite the live URL once, on boot. Safe to call more than once (a second
 * call is a no-op because the params are already gone). Never throws into the
 * boot path — a malformed URL must not stop the app from mounting.
 */
export function applyTelegramUrlNormalization(): void {
  if (typeof window === "undefined") return;
  try {
    const sdkInitData =
      typeof window.Telegram?.WebApp?.initData === "string" ? window.Telegram.WebApp.initData : "";
    const result = normalizeTelegramUrl(window.location.href, sdkInitData);
    capturedInitData = result.initData;
    if (result.changed) window.history.replaceState(null, "", result.url);
  } catch {
    /* keep booting; the worst case is a 404 screen, not a crash */
  }
}

/** Init data recovered from the URL, for when the SDK global is unavailable. */
export function capturedTelegramInitData(): string | null {
  return capturedInitData;
}
