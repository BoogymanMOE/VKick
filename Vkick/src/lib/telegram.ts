/**
 * Thin, typed bridge over the Telegram Mini App SDK.
 *
 * The SDK is loaded from telegram.org in index.html. When the app runs in a plain
 * browser (local dev) `window.Telegram` is undefined and every helper degrades to a
 * safe no-op / browser fallback, so the same build serves both clients.
 */

type HapticStyle = "light" | "medium" | "heavy" | "rigid" | "soft";

interface TelegramWebApp {
  ready: () => void;
  expand: () => void;
  close: () => void;
  colorScheme: "light" | "dark";
  version: string;
  initData: string;
  initDataUnsafe: {
    user?: { id: number; first_name?: string; last_name?: string; username?: string };
  };
  themeParams: Record<string, string | undefined>;
  viewportStableHeight?: number;
  setHeaderColor: (color: string) => void;
  setBackgroundColor: (color: string) => void;
  disableVerticalSwipes?: () => void;
  openTelegramLink?: (url: string) => void;
  onEvent: (event: string, cb: () => void) => void;
  offEvent: (event: string, cb: () => void) => void;
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
