import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import { useI18n } from "../i18n/context";
import { AlertIcon, BallIcon, CheckIcon, CloseIcon, RefreshIcon, StarFilledIcon } from "./icons";
import { ToastContext, type ToastItem, type ToastTone } from "./toastContext";

/**
 * Call sites pass a one-character glyph ("★", "✕"); they resolve to the same
 * SVG set as the rest of the app here, so toasts don't drift into system-font
 * symbols sitting next to drawn icons.
 */
const GLYPHS: Record<string, ReactNode> = {
  "★": <StarFilledIcon className="h-4 w-4" />,
  "✕": <CloseIcon className="h-4 w-4" />,
  "↻": <RefreshIcon className="h-4 w-4" />,
  "⚠": <AlertIcon className="h-4 w-4" />,
  "⚽": <BallIcon className="h-4 w-4" />,
  "✓": <CheckIcon className="h-4 w-4" />,
};

/*
 * The tone owns a 4px accent bar on the card's leading edge (`border-s-2`, so
 * it moves to the right in Persian like everything else) over the 1px tone
 * border: success volt, error danger, evaluative gold. It is colour + width
 * only — the toast keeps one tint, one icon and one line of copy.
 */
const toneClass: Record<ToastTone, string> = {
  volt: "border-volt border-s-2 text-volt",
  gold: "border-gold border-s-2 text-gold",
  danger: "border-danger border-s-2 text-danger",
  // "Last sync" / "Updated" reads as a successful sync, so it borrows the
  // success tint: a volt border + wash rather than a grey disabled-looking one.
  muted: "border-volt border-s-2 text-volt",
};

const toneTint: Record<ToastTone, string | undefined> = {
  volt: "color-mix(in srgb, var(--volt) 14%, var(--bg-elevated))",
  gold: "color-mix(in srgb, var(--gold) 14%, var(--bg-elevated))",
  danger: "color-mix(in srgb, var(--danger) 14%, var(--bg-elevated))",
  muted: "color-mix(in srgb, var(--volt) 12%, transparent)",
};

/** How long the copy stays readable before it starts to leave. */
const DWELL_MS = {
  muted: 1500,
  volt: 2500,
  gold: 2500,
  danger: 3000,
} as const;
/** The leave animation's own duration (see `.toast-out` in index.css) — the
 *  reap timer waits it out so the exit is visible. */
const LEAVE_MS = 320;

/** App-wide transient alerts: goals, deadline warnings, saved confirmations. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  // Every toast owns two timers; they are cleared on unmount so a hot reload
  // never sets state on a dead provider.
  const timers = useRef<number[]>([]);
  useEffect(
    () => () => {
      for (const timer of timers.current) window.clearTimeout(timer);
      timers.current = [];
    },
    [],
  );

  const push = useCallback((toast: Omit<ToastItem, "id">) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [...prev.slice(-2), { ...toast, id }]);
    timers.current.push(
      window.setTimeout(() => {
        // Mark leaving rather than remove: the exit animation plays first.
        setToasts((prev) => prev.map((item) => (item.id === id ? { ...item, leaving: true } : item)));
      }, DWELL_MS[toast.tone] ?? 2500),
      // Belt and braces: reap on a timer as well as on `animationend`. The event
      // is not guaranteed — a backgrounded webview, an element whose animation
      // never starts, or a stale class without a keyframes rule all leave the
      // toast on screen permanently, which is exactly the stuck-toast bug.
      window.setTimeout(
        () => setToasts((prev) => prev.filter((item) => item.id !== id)),
        (DWELL_MS[toast.tone] ?? 2500) + LEAVE_MS,
      ),
    );
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        // `auto` (not inherited rtl/ltr): an English "Updated 9:41 PM" inside a
        // Persian app must read LTR, while a Persian message reads RTL.
        dir="auto"
        className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex flex-col items-center gap-2 px-3 pt-[max(var(--safe-top, env(safe-area-inset-top, 0px)),10px)]"
        role="status"
        aria-live="polite"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            onAnimationEnd={() => {
              // Only the leave reaps the toast; the enter animation also ends
              // here and must be ignored.
              if (toast.leaving) setToasts((prev) => prev.filter((item) => item.id !== toast.id));
            }}
            className={cx(
              // A card, not a pill: an accent bar needs a straight leading edge
              // to sit on. Slides in from above the header and leaves upward
              // (.toast-in / .toast-out).
              "flex w-full max-w-[420px] items-center gap-2 rounded-card border px-3 py-2 text-xs font-bold backdrop-blur-md",
              toast.leaving ? "toast-out" : "toast-in",
              toneClass[toast.tone],
            )}
            style={{ backgroundColor: toneTint[toast.tone] ?? "rgba(18,44,37,0.95)" }}
          >
            {toast.icon ? (
              <span aria-hidden="true" className="flex flex-none items-center">
                {typeof toast.icon === "string" ? (GLYPHS[toast.icon] ?? toast.icon) : toast.icon}
              </span>
            ) : null}
            <span className="min-w-0 flex-1 truncate">{toast.text}</span>
            {/* Only errors get an explicit out: a dismissed failure stays in
                the user's memory; the success/muted dwell is short enough not
                to need one. */}
            {toast.tone === "danger" ? (
              <button
                type="button"
                aria-label={t("toast.dismiss")}
                onClick={() =>
                  setToasts((prev) => prev.map((item) => (item.id === toast.id ? { ...item, leaving: true } : item)))
                }
                className="flex-none text-current opacity-70 transition-opacity hover:opacity-100"
              >
                <CloseIcon className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
