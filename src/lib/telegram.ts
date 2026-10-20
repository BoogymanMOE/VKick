/**
 * Thin, typed bridge over the Telegram Mini App SDK.
 *
 * The SDK is loaded from telegram.org in index.html. When the app runs in a plain
 * browser (local dev) `window.Telegram` is undefined and every helper degrades to a
 * safe no-op / browser fallback, so the same build serves both clients.
 */

type HapticStyle = "light" | "medium" | "heavy" | "rigid" | "soft";

interface TelegramWebAppUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
}

interface TelegramWebApp {
  ready: () => void;
  expand: () => void;
  close: () => void;
  colorScheme: "light" | "dark";
  version: string;
  initData: string;
  initDataUnsafe: { user?: TelegramWebAppUser };
  themeParams: Record<string, string | undefined>;
  viewportStableHeight?: number;
  setHeaderColor: (color: string) => void;
  setBackgroundColor: (color: string) => void;
  disableVerticalSwipes?: () => void;
  openTelegramLink?: (url: string) => void;
  onEvent: (event: string, cb: () => void) => void;
  offEvent: (event: string, cb: () => void) => void;
  /** Android hardware back: a showable pill that can pop in-app history
      instead of closing the mini app (hooked up in useBackNavigation). */
  BackButton?: {
    isVisible: boolean;
    show: () => void;
    hide: () => void;
    showCloseButton: () => void;
    onClick: (cb: () => void) => void;
    offClick: (cb: () => void) => void;
  };
  HapticFeedback?: {
    impactOccurred: (style: HapticStyle) => void;
    notificationOccurred: (type: "error" | "success" | "warning") => void;
    selectionChanged: () => void;
  };
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export const telegram = (): TelegramWebApp | undefined => window.Telegram?.WebApp;

/**
 * True only when Telegram actually handed us signed init data.
 *
 * `initData` is an empty STRING — not undefined — whenever telegram-web-app.js
 * has loaded outside a real Telegram client, which is every plain-browser
 * visitor (index.html loads the SDK for everyone). Testing `!== undefined`
 * therefore reported "inside Telegram" to web users and switched on the
 * Telegram-only copy on the Login screen. No initData means no identity.
 */
export const isTelegram = (): boolean => Boolean(telegram()?.initData);

/**
 * Wait for the Mini App environment. The official script tag makes initData
 * available synchronously in the webview, but older Telegram clients inject
 * it late, and a plain browser never will — so boot awaits this instead of
 * racing an undefined global.
 */
export function waitForTelegram(timeoutMs = 1500): Promise<TelegramWebApp | null> {
  const existing = telegram();
  if (existing) return Promise.resolve(existing);
  if (typeof document === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const started = Date.now();
    const timer = window.setInterval(() => {
      const app = telegram();
      if (app || Date.now() - started >= timeoutMs) {
        window.clearInterval(timer);
        resolve(app ?? null);
      }
    }, 50);
  });
}

/**
 * The Telegram profile, display-name-shaped, once the SDK is ready. Names
 * here only SEED a fresh account row — the Profile rename is user-owned and
 * the server never overwrites it (upsertUser's DO NOTHING rule).
 */
export async function telegramDisplayName(): Promise<string | null> {
  const app = await waitForTelegram();
  const u = app?.initDataUnsafe?.user;
  if (!u) return null;
  return ([u.first_name, u.last_name].filter(Boolean).join(" ") || u.username || null) as string | null;
}

/** The Telegram user, when available — this is our primary auth identity. */
export function telegramUser() {
  return telegram()?.initDataUnsafe?.user;
}

/**
 * Call once on boot: paint the Telegram header to match --bg-base, disable the
 * vertical swipe gesture that fights in-app scrolling, and expand to full height.
 */
export function initTelegram(): void {
  const app = telegram();
  if (!app) return;

  const base = getComputedStyle(document.documentElement).getPropertyValue("--bg-base").trim();
  app.ready();
  app.expand();
  if (base) {
    app.setHeaderColor(base as string);
    app.setBackgroundColor(base as string);
  }
  // Closing the mini app with a downward swipe is a common accidental-exit during matches.
  try {
    app.disableVerticalSwipes?.();
  } catch {
    /* older Telegram versions don't support this */
  }
}

/**
 * The user's haptics toggle (Profile → Settings) is a device-side concern, so
 * it lives here — at the single choke point every call site already goes
 * through. Stored by useLocalState as JSON ("false" when off); reading errors
 * (private mode) default to buzzing, the old behavior before a choice exists.
 */
function hapticsEnabled(): boolean {
  try {
    const raw = localStorage.getItem("matchday.haptics");
    return raw ? JSON.parse(raw) !== false : true;
  } catch {
    return true;
  }
}

export function haptic(style: HapticStyle = "light"): void {
  if (!hapticsEnabled()) return;
  telegram()?.HapticFeedback?.impactOccurred(style);
}

export function selectionHaptic(): void {
  if (!hapticsEnabled()) return;
  telegram()?.HapticFeedback?.selectionChanged();
}

/** Used when an action is rejected — e.g. a third Shot Plotter pin. */
export function notifyHaptic(type: "error" | "success" | "warning"): void {
  if (!hapticsEnabled()) return;
  telegram()?.HapticFeedback?.notificationOccurred(type);
}

/**
 * Open the Telegram share sheet for a URL + text. Returns false when the SDK
 * is unavailable (plain browser), so the caller can fall back to clipboard.
 */
export function shareToTelegram(url: string, text: string): boolean {
  const app = telegram();
  if (!app?.openTelegramLink) return false;
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
  app.openTelegramLink(shareUrl);
  return true;
}
