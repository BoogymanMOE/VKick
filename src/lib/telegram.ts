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

/** True only when actually running inside a Telegram client. */
export const isTelegram = (): boolean => Boolean(telegram()?.initData !== undefined && telegram());

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

export function haptic(style: HapticStyle = "light"): void {
  telegram()?.HapticFeedback?.impactOccurred(style);
}

export function selectionHaptic(): void {
  telegram()?.HapticFeedback?.selectionChanged();
}

/** Used when an action is rejected — e.g. a third Shot Plotter pin. */
export function notifyHaptic(type: "error" | "success" | "warning"): void {
  telegram()?.HapticFeedback?.notificationOccurred(type);
}
